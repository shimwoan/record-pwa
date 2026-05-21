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
