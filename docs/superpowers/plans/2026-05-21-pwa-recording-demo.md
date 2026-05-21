# PWA 녹음 안정성 테스트 데모앱 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** iPhone PWA에서 장시간 녹음 안정성을 측정하는 데모앱 — Wake Lock + MediaRecorder(5초 chunk) + IndexedDB 저장 + 비프음 경고

**Architecture:** Vite + React SPA. App 컴포넌트가 모든 상태를 소유하고 RecordingControls / StatusDashboard / EventLog 세 자식 컴포넌트에 props로 전달. 오디오 로직(MediaRecorder, Wake Lock, IndexedDB, AudioContext)은 `src/recorder.js` 단일 모듈로 분리해 React 외부에서 관리.

**Tech Stack:** Vite 5, React 18, vite-plugin-pwa, native IndexedDB, Web Audio API, MediaRecorder API

---

## 파일 구조

```
record-test/
├── index.html
├── vite.config.js
├── public/
│   ├── manifest.json
│   └── icons/
│       ├── icon-192.png        (placeholder PNG)
│       └── icon-512.png        (placeholder PNG)
├── src/
│   ├── main.jsx
│   ├── App.jsx                 — 상태 소유, 이벤트 핸들러
│   ├── recorder.js             — MediaRecorder / Wake Lock / IndexedDB / AudioContext 로직
│   ├── components/
│   │   ├── RecordingControls.jsx  — 시작/중지 버튼, 경과 시간
│   │   ├── StatusDashboard.jsx    — Wake Lock / chunk / 용량 / visibility 상태
│   │   └── EventLog.jsx           — 타임스탬프 이벤트 로그
│   └── App.css
```

---

## Task 1: 프로젝트 초기화

**Files:**
- Create: `package.json`, `vite.config.js`, `index.html`, `src/main.jsx`, `src/App.jsx`, `src/App.css`

- [ ] **Step 1: Vite + React 프로젝트 생성**

```bash
cd /Users/jaemu/workspace/record-test
npm create vite@latest . -- --template react
```

프롬프트에서 "Current directory is not empty. Remove existing files and continue?" → y 선택.

- [ ] **Step 2: 의존성 설치**

```bash
npm install
npm install -D vite-plugin-pwa
```

- [ ] **Step 3: vite.config.js 작성**

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: false,
      devOptions: { enabled: true },
    }),
  ],
})
```

- [ ] **Step 4: public/manifest.json 생성**

```bash
mkdir -p public/icons
```

```json
{
  "name": "PWA 녹음 테스트",
  "short_name": "RecTest",
  "display": "standalone",
  "start_url": "/",
  "background_color": "#111111",
  "theme_color": "#111111",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

- [ ] **Step 5: 아이콘 placeholder 생성**

아이콘 없으면 PWA 설치가 안 됨. 간단한 PNG 생성:

```bash
# node로 1x1 빨간 PNG 생성 (192, 512 둘 다)
node -e "
const { createCanvas } = require('canvas');
" 2>/dev/null || true

# canvas 없으면 curl로 placeholder 다운로드
curl -s -o public/icons/icon-192.png \
  'https://via.placeholder.com/192/ff4444/ffffff.png?text=REC' 2>/dev/null || \
  node -e "
    // 최소 PNG 바이너리 (빨간 1x1 픽셀)
    const fs = require('fs');
    const buf = Buffer.from('89504e470d0a1a0a0000000d49484452000000c0000000c00802000000e9a2f3970000000c4944415478016360f8cf00000002000173c1cfce0000000049454e44ae426082','hex');
    fs.writeFileSync('public/icons/icon-192.png', buf);
    fs.writeFileSync('public/icons/icon-512.png', buf);
  "
```

실제로는 192x192, 512x512 PNG가 필요하나 테스트 목적이므로 아무 PNG 파일이면 됨. Finder에서 임의 PNG를 복사해도 OK.

- [ ] **Step 6: index.html 수정 — manifest 링크 추가**

생성된 `index.html`에서 `<head>` 안에 아래 줄이 없으면 추가:

```html
<link rel="manifest" href="/manifest.json" />
<meta name="theme-color" content="#111111" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
```

- [ ] **Step 7: 개발 서버 확인**

```bash
npm run dev
```

브라우저에서 `http://localhost:5173` 열려 Vite 기본 화면 나오면 OK.

- [ ] **Step 8: 커밋**

```bash
git add -A
git commit -m "feat: init Vite+React PWA project"
```

---

## Task 2: recorder.js — 핵심 오디오 모듈

**Files:**
- Create: `src/recorder.js`

이 모듈은 MediaRecorder, Wake Lock, IndexedDB, AudioContext를 모두 담당. React 외부 순수 JS 모듈.

- [ ] **Step 1: IndexedDB 헬퍼 함수 작성**

`src/recorder.js` 파일 생성:

```js
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
```

- [ ] **Step 2: AudioContext 비프음 함수 추가**

같은 파일에 이어서:

```js
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
```

- [ ] **Step 3: Recorder 클래스 작성**

같은 파일에 이어서:

```js
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
      this.wakeLock.release();
      this.wakeLock = null;
    }
    if (this.mediaRecorder?.stream) {
      this.mediaRecorder.stream.getTracks().forEach((t) => t.stop());
    }
  }
}
```

- [ ] **Step 4: 개발 서버 재시작 후 import 오류 없는지 확인**

```bash
npm run dev
```

콘솔에 에러 없으면 OK.

- [ ] **Step 5: 커밋**

```bash
git add src/recorder.js
git commit -m "feat: add recorder module (MediaRecorder, WakeLock, IndexedDB, AudioContext)"
```

---

## Task 3: EventLog 컴포넌트

**Files:**
- Create: `src/components/EventLog.jsx`

- [ ] **Step 1: EventLog.jsx 작성**

```jsx
export default function EventLog({ events }) {
  return (
    <div style={{
      background: '#1a1a1a',
      color: '#00ff00',
      fontFamily: 'monospace',
      fontSize: '12px',
      padding: '10px',
      borderRadius: '8px',
      height: '200px',
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column-reverse',
    }}>
      {[...events].reverse().map((e, i) => (
        <div key={i} style={{ color: e.error ? '#ff4444' : '#00ff00', marginBottom: '2px' }}>
          {e.text}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/components/EventLog.jsx
git commit -m "feat: add EventLog component"
```

---

## Task 4: StatusDashboard 컴포넌트

**Files:**
- Create: `src/components/StatusDashboard.jsx`

- [ ] **Step 1: StatusDashboard.jsx 작성**

```jsx
export default function StatusDashboard({ status }) {
  const { wakeLockSupported, wakeLockActive, chunkCount, totalBytes, visibility } = status;

  const mb = (totalBytes / (1024 * 1024)).toFixed(2);

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '8px',
      margin: '12px 0',
    }}>
      <Tile label="Wake Lock" value={
        !wakeLockSupported ? '미지원' :
        wakeLockActive ? '✓ 활성' : '✗ 해제됨'
      } color={wakeLockActive ? '#00cc66' : '#ff4444'} />
      <Tile label="Chunks" value={`${chunkCount}개 저장`} />
      <Tile label="가시성" value={visibility === 'hidden' ? '백그라운드' : 'foreground'} color={visibility === 'hidden' ? '#ff9900' : '#00cc66'} />
      <Tile label="용량" value={`${mb} MB`} />
    </div>
  );
}

function Tile({ label, value, color }) {
  return (
    <div style={{
      background: '#222',
      borderRadius: '8px',
      padding: '10px',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>{label}</div>
      <div style={{ fontSize: '14px', fontWeight: 'bold', color: color || '#fff' }}>{value}</div>
    </div>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/components/StatusDashboard.jsx
git commit -m "feat: add StatusDashboard component"
```

---

## Task 5: RecordingControls 컴포넌트

**Files:**
- Create: `src/components/RecordingControls.jsx`

- [ ] **Step 1: RecordingControls.jsx 작성**

```jsx
import { useEffect, useRef, useState } from 'react';

export default function RecordingControls({ isRecording, onStart, onStop }) {
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (isRecording) {
      setElapsed(0);
      intervalRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [isRecording]);

  const fmt = (s) => {
    const h = String(Math.floor(s / 3600)).padStart(2, '0');
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const sec = String(s % 60).padStart(2, '0');
    return `${h}:${m}:${sec}`;
  };

  return (
    <div style={{ textAlign: 'center', padding: '16px 0' }}>
      <div style={{
        fontSize: '48px',
        fontWeight: 'bold',
        color: isRecording ? '#ff4444' : '#888',
        marginBottom: '8px',
        fontFamily: 'monospace',
      }}>
        {isRecording ? `● ${fmt(elapsed)}` : '○ 대기중'}
      </div>
      <button
        onClick={isRecording ? onStop : onStart}
        style={{
          padding: '14px 40px',
          fontSize: '18px',
          borderRadius: '50px',
          border: 'none',
          background: isRecording ? '#444' : '#ff4444',
          color: '#fff',
          cursor: 'pointer',
          marginTop: '8px',
        }}
      >
        {isRecording ? '녹음 중지' : '녹음 시작'}
      </button>
      {isRecording && (
        <p style={{ color: '#ff9900', fontSize: '13px', marginTop: '12px' }}>
          ⚠️ 화면을 끄거나 다른 앱으로 전환하지 마세요
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 커밋**

```bash
git add src/components/RecordingControls.jsx
git commit -m "feat: add RecordingControls component"
```

---

## Task 6: App.jsx — 상태 조립 및 이벤트 핸들링

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/App.css`

- [ ] **Step 1: App.jsx 전체 작성**

```jsx
import { useState, useRef, useCallback } from 'react';
import { Recorder, playBeep } from './recorder';
import RecordingControls from './components/RecordingControls';
import StatusDashboard from './components/StatusDashboard';
import EventLog from './components/EventLog';
import './App.css';

const fmtTime = () => {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
};

const fmtBytes = (b) => {
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)}kB`;
  return `${(b / (1024 * 1024)).toFixed(2)}MB`;
};

export default function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState({
    wakeLockSupported: true,
    wakeLockActive: false,
    chunkCount: 0,
    totalBytes: 0,
    visibility: 'visible',
  });
  const recorderRef = useRef(null);

  const addEvent = useCallback((text, error = false) => {
    setEvents((prev) => [...prev, { text: `[${fmtTime()}] ${text}`, error }]);
  }, []);

  const handleEvent = useCallback((type, payload) => {
    switch (type) {
      case 'start':
        addEvent('녹음 시작');
        break;
      case 'chunk':
        setStatus((s) => ({ ...s, chunkCount: payload.count, totalBytes: payload.totalBytes }));
        addEvent(`chunk #${payload.count} 저장 (${fmtBytes(payload.totalBytes)})`);
        break;
      case 'wakeLock':
        setStatus((s) => ({
          ...s,
          wakeLockSupported: payload.supported,
          wakeLockActive: payload.active,
        }));
        if (!payload.supported) addEvent('Wake Lock 미지원');
        else if (payload.active) addEvent('Wake Lock 획득');
        else addEvent('Wake Lock 획득 실패: ' + (payload.error || ''), true);
        break;
      case 'wakeLockReleased':
        setStatus((s) => ({ ...s, wakeLockActive: false }));
        addEvent('Wake Lock 해제됨 ⚠️', true);
        break;
      case 'wakeLockReacquired':
        setStatus((s) => ({ ...s, wakeLockActive: true }));
        addEvent('Wake Lock 재획득');
        break;
      case 'visibility':
        setStatus((s) => ({ ...s, visibility: payload.state }));
        addEvent(payload.state === 'hidden' ? '화면 백그라운드 진입 ⚠️' : '화면 복귀', payload.state === 'hidden');
        break;
      case 'stop':
        addEvent(`녹음 중지 — 총 ${payload.chunkCount}개 chunk, ${fmtBytes(payload.totalBytes)}`);
        break;
      case 'error':
        addEvent(payload.message, true);
        break;
    }
  }, [addEvent]);

  const handleStart = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      addEvent('이 브라우저는 MediaRecorder를 지원하지 않습니다', true);
      return;
    }
    try {
      const recorder = new Recorder(handleEvent);
      recorderRef.current = recorder;
      await recorder.start();
      setIsRecording(true);
      setStatus((s) => ({ ...s, chunkCount: 0, totalBytes: 0 }));
      setEvents([]);
    } catch (err) {
      addEvent('시작 실패: ' + err.message, true);
    }
  };

  const handleStop = async () => {
    if (!recorderRef.current) return;
    try {
      const blob = await recorderRef.current.stop();
      setIsRecording(false);
      // 다운로드
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `recording-${Date.now()}.webm`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      addEvent('중지 실패: ' + err.message, true);
    }
    recorderRef.current = null;
  };

  return (
    <div className="app">
      <h1>PWA 녹음 테스트</h1>
      <RecordingControls
        isRecording={isRecording}
        onStart={handleStart}
        onStop={handleStop}
      />
      <StatusDashboard status={status} />
      <h2>이벤트 로그</h2>
      <EventLog events={events} />
    </div>
  );
}
```

- [ ] **Step 2: App.css 작성**

기존 내용을 전부 교체:

```css
* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  background: #111;
  color: #fff;
  font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  min-height: 100vh;
}

.app {
  max-width: 480px;
  margin: 0 auto;
  padding: 20px 16px 40px;
}

h1 {
  text-align: center;
  font-size: 20px;
  color: #ccc;
  margin-bottom: 4px;
}

h2 {
  font-size: 13px;
  color: #555;
  margin: 16px 0 6px;
  text-transform: uppercase;
  letter-spacing: 1px;
}
```

- [ ] **Step 3: src/main.jsx 확인 — App 임포트 경로**

```jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

- [ ] **Step 4: 개발 서버에서 동작 확인**

```bash
npm run dev
```

`http://localhost:5173` 에서:
1. "녹음 시작" 버튼 클릭 → 마이크 권한 요청 뜨는지 확인
2. 권한 허용 후 타이머 시작, EventLog에 "녹음 시작" 표시 확인
3. 5초 후 "chunk #1 저장" 이벤트 확인
4. "녹음 중지" → webm 다운로드 팝업 확인

- [ ] **Step 5: 커밋**

```bash
git add src/App.jsx src/App.css src/main.jsx
git commit -m "feat: assemble App with RecordingControls, StatusDashboard, EventLog"
```

---

## Task 7: PWA 빌드 및 iPhone 배포

**Files:**
- Modify: `vite.config.js` (필요 시)

- [ ] **Step 1: 프로덕션 빌드**

```bash
npm run build
```

`dist/` 폴더 생성 확인. `dist/sw.js` 존재 여부 확인 (Service Worker).

- [ ] **Step 2: 로컬 HTTPS 서버 실행**

iPhone에서 PWA로 설치하려면 HTTPS 또는 localhost 필요. 같은 Wi-Fi 네트워크에서 접근하려면 HTTPS가 필요함.

```bash
# npx serve로 빠른 로컬 서버
npx serve dist
```

또는 개발 서버로 테스트:

```bash
npm run dev -- --host
```

출력된 `Network: http://192.168.x.x:5173` 주소를 iPhone Safari에서 열기.

- [ ] **Step 3: iPhone Safari에서 PWA 설치**

1. iPhone Safari에서 위 IP 주소 접속
2. 하단 공유 버튼(□↑) 탭
3. "홈 화면에 추가" 탭
4. 앱 이름 확인 후 "추가"
5. 홈 화면에서 앱 아이콘으로 실행

- [ ] **Step 4: 테스트 시나리오 실행**

아래 순서로 테스트하고 EventLog 스크린샷 촬영:

| 시나리오 | 기대 결과 |
|---|---|
| 화면 켜둔 채 10분 녹음 | chunk 계속 저장, Wake Lock 활성 유지 |
| 홈버튼 누름 | "백그라운드 진입 ⚠️" 이벤트 + 비프음 |
| 앱 복귀 | "화면 복귀" + "Wake Lock 재획득" 이벤트 |
| 전원버튼 잠금 | "Wake Lock 해제됨 ⚠️" + 비프음 (가능한 경우) |
| 녹음 중지 | webm 파일 다운로드 |

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "feat: complete PWA recording demo app"
```
