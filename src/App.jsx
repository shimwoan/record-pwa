import { useState, useRef, useCallback } from 'react';
import { Recorder, initAudioContext } from './recorder';
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
  // [Important Fix #8] HTTPS 또는 localhost가 아니면 getUserMedia/WakeLock 동작 안 함
  const insecureContext = typeof window !== 'undefined' && !window.isSecureContext;
  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState({
    wakeLockSupported: true,
    wakeLockActive: false,
    chunkCount: 0,
    totalBytes: 0,
    visibility: 'visible',
  });
  const recorderRef = useRef(null);
  const eventIdRef = useRef(0);

  const addEvent = useCallback((text, error = false) => {
    const id = ++eventIdRef.current;
    setEvents((prev) => [...prev, { id, text: `[${fmtTime()}] ${text}`, error }]);
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
    // [Critical Fix #3] iOS: AudioContext는 user gesture frame 안에서 동기적으로 생성해야 함.
    // await 이전에 호출해야 gesture 타이머 만료 전에 unlock됨.
    // gesture frame 안에서 동기 호출 (iOS AudioContext unlock)
    initAudioContext();

    // gesture frame 안에서 첫 번째 await — transient activation 소진 전에 권한 팝업 띄움
    // 획득한 stream을 recorder에 그대로 넘겨 AVAudioSession 이중 초기화 방지
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        addEvent('마이크 권한이 거부되었습니다', true);
        if (window.matchMedia('(display-mode: standalone)').matches) {
          addEvent('iPhone 설정 → 앱 이름 → 마이크 → 허용 후 다시 시도', true);
        } else {
          addEvent('iPhone 설정 → Safari → 마이크 → 허용 후 다시 시도', true);
        }
      } else if (err.name === 'SecurityError') {
        addEvent('보안 오류: HTTPS에서 실행해야 마이크를 사용할 수 있습니다', true);
      } else if (err.name === 'NotReadableError') {
        addEvent('마이크가 다른 앱에서 사용 중입니다. 다른 앱 종료 후 다시 시도하세요', true);
      } else if (err.name === 'AbortError') {
        addEvent('마이크 접근이 중단되었습니다. 다시 시도하세요', true);
      } else if (err.name === 'NotFoundError') {
        addEvent('마이크를 찾을 수 없습니다', true);
      } else {
        addEvent('마이크 오류: ' + err.message, true);
      }
      return;
    }

    try {
      setEvents([]);
      setStatus((s) => ({ ...s, chunkCount: 0, totalBytes: 0 }));
      const recorder = new Recorder(handleEvent);
      recorderRef.current = recorder;
      await recorder.start(stream);
      setIsRecording(true);
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      addEvent('시작 실패: ' + err.message, true);
    }
  };

  const handleStop = async () => {
    if (!recorderRef.current) return;
    try {
      const blob = await recorderRef.current.stop();
      setIsRecording(false);
      if (blob && blob.size > 0) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const ext = (recorderRef.current?.mimeType || blob.type).includes('mp4') ? 'mp4' : 'webm';
        a.download = `recording-${Date.now()}.${ext}`;
        // iOS Safari는 DOM에 append해야 download 속성이 동작함
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // iOS는 파일 저장 다이얼로그가 비동기 — URL을 5초간 유지
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
    } catch (err) {
      addEvent('중지 실패: ' + err.message, true);
    }
    recorderRef.current = null;
  };

  return (
    <div className="app">
      <h1>PWA 녹음 테스트</h1>
      {insecureContext && (
        <p style={{ color: '#ff4444', fontSize: '0.85rem', margin: '0 0 1rem' }}>
          ⚠️ HTTPS 또는 localhost에서 실행해야 마이크 및 Wake Lock이 동작합니다.
        </p>
      )}
      <RecordingControls
        isRecording={isRecording}
        disabled={insecureContext}
        onStart={handleStart}
        onStop={handleStop}
      />
      <StatusDashboard status={status} />
      <h2>이벤트 로그</h2>
      <EventLog events={events} />
    </div>
  );
}
