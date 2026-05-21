// IndexedDB
const DB_NAME = 'recording-chunks';
const STORE = 'chunks';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(STORE, { autoIncrement: true });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveChunk(db, blob) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.add({ blob, timestamp: Date.now(), size: blob.size });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAllChunks(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function clearChunks(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// AudioContext — iOS는 사용자 탭 시점에 생성해야 함
let audioCtx = null;

// [Critical Fix #3] AudioContext는 user gesture frame 안에서 생성/resume해야 함.
// await 이후에는 iOS 제스처 타이머가 만료되므로 App.jsx handleStart에서 직접 호출.
export function initAudioContext() {
  if (audioCtx && audioCtx.state !== 'closed') return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  // iOS 허용 등록용 무음 재생
  const buf = audioCtx.createBuffer(1, 1, 22050);
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  src.connect(audioCtx.destination);
  src.start(0);
  // resume()도 gesture frame 안에서 동기적으로 호출
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

export function playBeep() {
  if (!audioCtx) return;
  const gain = audioCtx.createGain();
  gain.gain.value = 0.8;
  gain.connect(audioCtx.destination);

  [880, 1760].forEach((freq) => {
    const osc = audioCtx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;
    osc.connect(gain);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.5);
  });
}

export class Recorder {
  constructor(onEvent) {
    this.onEvent = onEvent ?? (() => {});
    this.db = null;
    this.mediaRecorder = null;
    this.mimeType = null;
    this.wakeLock = null;
    this.chunkCount = 0;
    this.totalBytes = 0;
    this._lastSave = Promise.resolve();
    this._visibilityHandler = null;
    this._wakeLockReleaseHandler = null;
  }

  async start() {
    if (this.mediaRecorder) throw new Error('Already recording');

    // [Critical Fix #3] initAudioContext()는 App.jsx에서 gesture frame 안에서 이미 호출됨.
    // 여기서 중복 호출 제거.

    this.db = await openDB();
    await clearChunks(this.db);
    this.chunkCount = 0;
    this.totalBytes = 0;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/mp4';
    this.mediaRecorder = new MediaRecorder(stream, { mimeType: this.mimeType });

    // [Critical Fix #2] _lastSave를 체인으로 직렬화하여 concurrent chunk 저장 경쟁 방지
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size === 0) return;
      this._lastSave = this._lastSave.then(async () => {
        try {
          await saveChunk(this.db, e.data);
          this.chunkCount++;
          this.totalBytes += e.data.size;
          this.onEvent('chunk', { count: this.chunkCount, totalBytes: this.totalBytes });
        } catch (err) {
          this.onEvent('error', { message: 'IndexedDB 저장 실패: ' + err.message });
          playBeep();
        }
      });
    };

    this.mediaRecorder.onerror = (e) => {
      this.onEvent('error', { message: '녹음 오류: ' + (e.error?.message ?? 'unknown') });
      playBeep();
    };

    this.mediaRecorder.start(5000);
    this.onEvent('start', {});

    await this._acquireWakeLock();
    this._setupVisibilityHandler();
  }

  async stop() {
    if (!this.mediaRecorder) return Promise.resolve(null);

    // [Critical Fix #1] 트랙 중단 전에 mediaRecorder.stop() 먼저 호출해야
    // 마지막 ondataavailable이 정상 발생함. 트랙을 먼저 죽이면 마지막 청크 유실 위험.
    // 순서: listener 해제 → wakelock 해제 → mediaRecorder.stop() → (onstop 내에서) 트랙 중단

    if (this._visibilityHandler) {
      document.removeEventListener('visibilitychange', this._visibilityHandler);
      this._visibilityHandler = null;
    }
    if (this.wakeLock) {
      this.wakeLock.removeEventListener('release', this._wakeLockReleaseHandler);
      this._wakeLockReleaseHandler = null;
      this.wakeLock.release();
      this.wakeLock = null;
    }

    const stream = this.mediaRecorder.stream;
    const mimeType = this.mimeType;

    return new Promise((resolve) => {
      this.mediaRecorder.onstop = async () => {
        // 모든 청크 저장이 완료될 때까지 대기
        await this._lastSave;
        // 이제 트랙 중단 (마지막 청크 flush 완료 후)
        stream.getTracks().forEach((t) => t.stop());
        const chunks = await getAllChunks(this.db);
        const blob = new Blob(chunks.map((c) => c.blob), { type: mimeType });
        this.onEvent('stop', { totalBytes: this.totalBytes, chunkCount: this.chunkCount });
        resolve(blob);
      };
      this.mediaRecorder.stop();
    });
  }

  async _acquireWakeLock() {
    if (!('wakeLock' in navigator)) {
      this.onEvent('wakeLock', { supported: false, active: false });
      return;
    }
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
      this.onEvent('wakeLock', { supported: true, active: true });
      this._wakeLockReleaseHandler = () => {
        this.onEvent('wakeLockReleased', {});
        playBeep();
        this.wakeLock = null;
      };
      this.wakeLock.addEventListener('release', this._wakeLockReleaseHandler);
    } catch (err) {
      this.onEvent('wakeLock', { supported: true, active: false, error: err.message });
    }
  }

  _setupVisibilityHandler() {
    this._visibilityHandler = async () => {
      if (document.hidden) {
        this.onEvent('visibility', { state: 'hidden' });
        playBeep();
      } else {
        this.onEvent('visibility', { state: 'visible' });
        // [Important Fix #4] Wake Lock 재획득 성공 여부 확인 후에만 이벤트 발생
        if (!this.wakeLock && 'wakeLock' in navigator) {
          await this._acquireWakeLock();
          if (this.wakeLock) {
            this.onEvent('wakeLockReacquired', {});
          }
        }
      }
    };
    document.addEventListener('visibilitychange', this._visibilityHandler);
  }
}
