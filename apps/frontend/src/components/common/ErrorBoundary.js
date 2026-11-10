// Fängt Abstürze beim Rendern ab: statt eines weißen Bildschirms eine Meldung mit „Neu laden“.
// Die Offline-Warteschlange liegt im localStorage und bleibt dabei erhalten.
import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Unerwarteter Fehler in der Oberfläche:', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, textAlign: 'center', background: '#121212', color: '#fff', fontFamily: 'Roboto, Arial, sans-serif' }}>
        <h1 style={{ fontSize: 24, margin: 0 }}>Da ist etwas schiefgelaufen</h1>
        <p style={{ margin: 0, maxWidth: 420, opacity: 0.8 }}>
          Die Seite konnte nicht angezeigt werden. Bereits gebuchte Verkäufe sind gespeichert, offline erfasste bleiben in der Warteschlange.
        </p>
        <button type="button" onClick={() => window.location.reload()} style={{ minHeight: 48, padding: '0 28px', fontSize: 16, fontWeight: 700, border: 0, borderRadius: 12, background: '#00e676', color: '#000', cursor: 'pointer' }}>
          Neu laden
        </button>
        <button type="button" onClick={() => { window.location.href = '/'; }} style={{ minHeight: 44, padding: '0 20px', fontSize: 14, border: '1px solid #666', borderRadius: 12, background: 'transparent', color: '#fff', cursor: 'pointer' }}>
          Zur Startseite
        </button>
      </div>
    );
  }
}
