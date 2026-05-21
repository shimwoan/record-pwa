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
      {[...events].reverse().map((e) => (
        <div key={e.id} style={{ color: e.error ? '#ff4444' : '#00ff00', marginBottom: '2px' }}>
          {e.text}
        </div>
      ))}
    </div>
  );
}
