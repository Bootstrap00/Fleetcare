import { Component } from 'react';

// Catches render errors so one broken component shows a message instead of turning the whole site black.
export default class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('FleetCare error:', error, info?.componentStack); }
  render() {
    const { error } = this.state, msg = String(error?.message || error || '');
    if (!error) return this.props.children;
    if (this.props.inline) return <div className="nomap"><b>{this.props.label || 'This part failed to load.'}</b><small>{msg}</small></div>;
    return (
      <div className="page narrow"><div className="card stack">
        <h3>Something went wrong on this page</h3><p className="error">{msg}</p>
        <div className="actions"><button className="btn" onClick={() => location.reload()}>Reload</button><a className="btn ghost" href="#/">Go home</a></div>
      </div></div>);
  }
}
