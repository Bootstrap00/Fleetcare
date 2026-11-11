import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { subscribe, send } from './socket';

export default function Chat({ requestId, me }) {
  const [msgs, setMsgs] = useState([]), [text, setText] = useState(''), end = useRef();
  useEffect(() => {
    api(`/requests/${requestId}/messages`).then(setMsgs).catch(() => {});
    return subscribe(m => { if (m.type === 'chat' && m.request_id === requestId) setMsgs(x => [...x, m]); });
  }, [requestId]);
  useEffect(() => end.current?.scrollIntoView(), [msgs]);
const go = () => { 
    const trimmed = text.trim();
    if (trimmed) { 
      send({ type: 'chat', requestId, body: trimmed }); 
      setText(''); 
    } 
  };
  return (
    <div className="chat">
      <div className="log">
        {msgs.length === 0 && <small className="muted">No messages yet. Say hello.</small>}
        {msgs.map(m => <div key={m.id} className={'bubble' + (m.sender_id === me ? ' me' : '')}>{m.body}</div>)}
        <div ref={end} />
      </div>
      <div className="compose">
        <input value={text} placeholder="Type a message" onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && go()} />
        <button onClick={go}>Send</button>
      </div>
    </div>);
}
