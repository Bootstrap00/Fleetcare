import { token } from './api';
let ws; const listeners = new Set();
export function connect() {
  const t = token();
  if (!t || (ws && ws.readyState < 2)) return;
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?token=${t}`);
  ws.onmessage = e => listeners.forEach(f => f(JSON.parse(e.data)));
  ws.onclose = () => { if (token()) setTimeout(connect, 2000); };
}
export const send = m => ws?.readyState === 1 && ws.send(JSON.stringify(m));
export const subscribe = f => { listeners.add(f); return () => listeners.delete(f); };
export const disconnect = () => { const w = ws; ws = null; w?.close(); };
