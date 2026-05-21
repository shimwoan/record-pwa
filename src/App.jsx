import { useState, useRef, useCallback } from 'react';
import { Recorder } from './recorder';
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
      setEvents([]);
      setStatus((s) => ({ ...s, chunkCount: 0, totalBytes: 0 }));
      const recorder = new Recorder(handleEvent);
      recorderRef.current = recorder;
      await recorder.start();
      setIsRecording(true);
    } catch (err) {
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
        a.download = `recording-${Date.now()}.webm`;
        a.click();
        URL.revokeObjectURL(url);
      }
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
