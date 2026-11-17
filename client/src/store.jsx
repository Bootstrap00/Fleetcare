import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from './api';
import { subscribe } from './socket';
import { go } from './ui';

export const Ctx = createContext();
export const useStore = () => useContext(Ctx);

export function Store({ user, updateUser, children }) {
  const [rows, setRows] = useState([]), [arch, setArch] = useState(false), [fees, setFees] = useState(null);
  const [msg, setMsg] = useState(''), [sel, setSel] = useState(null), [edit, setEdit] = useState(null), [paying, setPaying] = useState(null);
  const load = useCallback(() => api('/requests' + (arch ? '?archived=1' : '')).then(setRows).catch(e => setMsg(e.message)), [arch]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api('/config').then(setFees).catch(() => {});
    const q = new URLSearchParams(location.search);
    if (q.get('paid')) api(`/requests/${q.get('paid')}/confirm`, { method: 'POST', body: { pid: q.get('pid'), session_id: q.get('session_id') } })
      .then(r => setMsg(r.paid ? 'Payment received. Thank you!' : 'Payment is not completed yet. You can reopen it from My requests.')).catch(e => setMsg(e.message))
      .finally(() => { history.replaceState({}, '', '/'); go('/orders'); load(); });
  }, []);
  useEffect(() => subscribe(m => {
    if (m.type === 'new_request') setMsg('New breakdown request. Open Jobs to view it.');
    if (['new_request', 'request_update'].includes(m.type)) load();
  }), [load]);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(''), 5000); return () => clearTimeout(t); }, [msg]);

  const run = fn => async (...a) => { try { await fn(...a); await load(); } catch (e) { setMsg(e.message); } };
  const act = {
    status: run((id, status) => api(`/requests/${id}/status`, { method: 'PATCH', body: { status } })),
    archive: run(id => api('/requests/' + id, { method: 'DELETE' })),
    restore: run(id => api(`/requests/${id}/restore`, { method: 'POST' })),
  };
  return <Ctx.Provider value={{ user, updateUser, paying, setPaying, rows, arch, setArch, fees, msg, setMsg, sel, setSel, edit, setEdit, load, act }}>{children}</Ctx.Provider>;
}
