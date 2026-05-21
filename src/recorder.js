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
    req.onsuccess = () => resolve(req.result); // key
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

export function initAudioContext() {
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  // iOS 허용 등록용 무음 재생
  const buf = audioCtx.createBuffer(1, 1, 22050);
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  src.connect(audioCtx.destination);
  src.start(0);
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
    // onEvent(type, payload) — App에서 상태 업데이트에 사용
    this.onEvent = onEvent;
    this.db = null;
    this.mediaRecorder = null;
    this.wakeLock = null;
    this.chunkCount = 0;
    this.totalBytes = 0;
    this._visibilityHandler = null;
    this._wakeLockReleaseHandler = null;
  }

  async start() {
    this.db = await openDB();
    await clearChunks(this.db);
    this.chunkCount = 0;
    this.totalBytes = 0;

    initAudioContext();

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.mediaRecorder = new MediaRecorder(stream);

    this.mediaRecorder.ondataavailable = async (e) => {
      if (e.data.size === 0) return;
      try {
        await saveChunk(this.db, e.data);
        this.chunkCount++;
        this.totalBytes += e.data.size;
        this.onEvent('chunk', { count: this.chunkCount, totalBytes: this.totalBytes });
      } catch (err) {
        this.onEvent('error', { message: 'IndexedDB 저장 실패: ' + err.message });
        playBeep();
      }
    };

    this.mediaRecorder.onerror = (e) => {
      this.onEvent('error', { message: '녹음 오류: ' + e.error?.message });
      playBeep();
    };

    this.mediaRecorder.start(5000);
    this.onEvent('start', {});

    await this._acquireWakeLock();
    this._setupVisibilityHandler();
  }

  async stop() {
    this._teardown();
    return new Promise((resolve) => {
      this.mediaRecorder.onstop = async () => {
        const chunks = await getAllChunks(this.db);
        const blob = new Blob(chunks.map((c) => c.blob), { type: 'audio/webm' });
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
        // Wake Lock 재획득
        if (!this.wakeLock && 'wakeLock' in navigator) {
          await this._acquireWakeLock();
          this.onEvent('wakeLockReacquired', {});
        }
      }
    };
    document.addEventListener('visibilitychange', this._visibilityHandler);
  }

  _teardown() {
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
    if (this.mediaRecorder?.stream) {
      this.mediaRecorder.stream.getTracks().forEach((t) => t.stop());
    }
  }
}
