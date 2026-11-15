'use client';

import { useEffect, useRef, useState } from 'react';

type Message = { id: number; sender: string; body: string; created: string };
const endpoint = '/api/community';

export default function ProposalChat({ callId, viewer, partner }: { callId: string; viewer: string; partner: string }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState(false);
  const log = useRef<HTMLOListElement>(null);
  const lastId = messages[messages.length - 1]?.id;

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const res = await fetch(endpoint + '?chat=' + encodeURIComponent(callId), { signal: controller.signal, cache: 'no-store' });
        if (!res.ok) throw new Error();
        const { messages: history } = await res.json() as { messages: Message[] };
        if (!controller.signal.aborted) {
          // A poll started before a send can return an older copy of the thread.
          setMessages(current => (current[current.length - 1]?.id ?? 0) > (history[history.length - 1]?.id ?? 0) ? current : history);
          setReady(true);
          setConnectionError(false);
        }
      } catch { if (!controller.signal.aborted) setConnectionError(true); }
      if (!controller.signal.aborted) timer = setTimeout(poll, 2000);
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [callId, open]);

  useEffect(() => {
    if (open && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [lastId, open]);

  async function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.trim() || sending) return;
    setSending(true);
    setError('');
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'message', id: callId, message: draft }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Message could not be sent.');
      const message: Message = result.message;
      setMessages(current => current.some(item => item.id === message.id) ? current : [...current, message].sort((a, b) => a.id - b.id).slice(-100));
      setDraft('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Message could not be sent.'); }
    finally { setSending(false); }
  }

  return <details className="proposal-chat" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Message {partner}</summary>
    {open && <>
      <p className="muted">Private to you and {partner}. Share meetup updates here.</p>
      {!ready && !connectionError && <p role="status">Loading conversation…</p>}
      {connectionError && <p role="status">Conversation connection interrupted. Reconnecting…</p>}
      {ready && !messages.length && <p className="muted">No messages yet.</p>}
      <ol ref={log} className="proposal-chat-log" role="log" aria-label={`Messages with ${partner}`}>
        {messages.map(message => <li key={message.id}>
          <strong>{message.sender === viewer ? 'You' : partner}</strong>{' '}
          <time dateTime={message.created}>{new Date(message.created).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time>
          <p>{message.body}</p>
        </li>)}
      </ol>
      <form onSubmit={send}>
        <label>Message<textarea rows={2} required maxLength={2000} value={draft} disabled={sending}
          onChange={event => setDraft(event.target.value)} placeholder="I’m at the park entrance." /></label>
        <button className="primary" disabled={sending || !draft.trim()}>{sending ? 'Sending…' : 'Send message'}</button>
        {error && <p role="alert">{error}</p>}
      </form>
    </>}
  </details>;
}
