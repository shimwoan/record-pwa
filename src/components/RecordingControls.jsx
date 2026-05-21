import { useEffect, useRef, useState } from 'react';

export default function RecordingControls({ isRecording, disabled, onStart, onStop }) {
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
        disabled={disabled && !isRecording}
        style={{
          padding: '14px 40px',
          fontSize: '18px',
          borderRadius: '50px',
          border: 'none',
          background: isRecording ? '#444' : (disabled ? '#666' : '#ff4444'),
          color: '#fff',
          cursor: disabled && !isRecording ? 'not-allowed' : 'pointer',
          marginTop: '8px',
          opacity: disabled && !isRecording ? 0.5 : 1,
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
