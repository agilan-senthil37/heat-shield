'use client';

import { useEffect, useState } from 'react';
import EmailEntry, { LocationFields } from './email-entry';
import { live, pilot, type Site } from './data';

type Person = { id: string; zip?: string; name: string; neighborhood: string; friend: number; visible: number };
type Call = { id: string; sender: string; recipient: string; senderName: string; recipientName: string; title: string; sites: string[]; note: string; reply: string };
type Community = { user: Person; nearby: Person[]; requests: Person[]; calls: Call[] };
const endpoint = '/api/community';


export default function LiveCommunity({ title, sites, compose = false }: { title: string; sites: Site[]; compose?: boolean }) {
  const [data, setData] = useState<Community | null>();
  const [auth, setAuth] = useState({ emailRequired: false, emailConfigured: false });
  const [register, setRegister] = useState(false);
  const [recipient, setRecipient] = useState('');
  const [busy, setBusy] = useState(false);
  const [friendsOnly, setFriendsOnly] = useState(false);
  const [status, setStatus] = useState('');
  const [connected, setConnected] = useState(false);

  async function refresh(signal?: AbortSignal) {
    const response = await fetch(endpoint, { cache: 'no-store', signal });
    if (response.status === 401) { const config = await response.json(); if (!signal?.aborted) { setAuth(config); setData(null); } }
    else if (response.ok) {
      const snapshot = await response.json();
      if (!signal?.aborted) setData(snapshot);
    } else throw new Error('Unavailable');
    if (!signal?.aborted) setConnected(true);
  }

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try { await refresh(controller.signal); }
      catch { if (!controller.signal.aborted) setConnected(false); }
      if (!controller.signal.aborted) timer = setTimeout(poll, 2000);
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, []);

  async function mutate(action: string, values: Record<string, unknown> = {}) {
    setBusy(true);
    setStatus('');
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...values }),
      });
      if (!response.ok) throw new Error((await response.json()).error || 'Could not save.');
      await refresh();
      setStatus(action === 'send' ? 'Planting call delivered.' : 'Saved.');
      if (action === 'send') setRecipient('');
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not save.'); }
    finally { setBusy(false); }
  }

  const people = data?.nearby.filter(person => !friendsOnly || person.friend) ?? [];
  const incoming = data?.calls.filter(call => call.recipient === data.user.id) ?? [];
  const outgoing = data?.calls.filter(call => call.sender === data.user.id) ?? [];

  return <section id={compose ? "send-planting-call" : undefined} className="community-panel live-community" aria-label={compose ? 'Send planting call' : 'Live Photosynthesis'}>
    <h2>{compose ? 'Send a planting call' : 'Live Photosynthesis'}</h2>
    <p className="muted">{connected ? 'Inbox and collaborator updates appear automatically.' : 'Account connection unavailable or loading…'}</p>
    {data === null && (compose ? <a href="/#live-photosynthesis">Sign in to send a planting call</a> : auth.emailConfigured ? <EmailEntry onVerified={() => void refresh().catch(()=>setConnected(false))}/> : auth.emailRequired ? <p>Email verification is not configured on this server.</p> :
      <form onSubmit={event => {
        event.preventDefault();
        void mutate(register ? 'register' : 'login', Object.fromEntries(new FormData(event.currentTarget)));
      }}>
        <label>Username<input name="handle" required minLength={3} maxLength={40} autoComplete="username"/></label>
        <label>Password<input name="password" required minLength={10} maxLength={128} type="password" autoComplete={register ? 'new-password' : 'current-password'}/></label>
        {register && <><label>Display name<input name="name" required maxLength={48}/></label><LocationFields/></>}
        <button className="primary" disabled={busy}>{register ? 'Create account' : 'Sign in'}</button>
        <button className="secondary" type="button" onClick={() => setRegister(!register)}>{register ? 'Use an existing account' : 'Create a local preview account'}</button>
      </form>)}
    {data && compose && <form onSubmit={event => {
      event.preventDefault();
      const fields = new FormData(event.currentTarget);
      void mutate('send', { recipient, title, siteIds: sites.map(site => site.id), note: fields.get('note') });
    }}>
      <ul className="send-sites">{sites.map(site=><li key={site.id}>{site.name || site.id} · {site.neighborhood}</li>)}</ul><p>Sending as <strong>{data.user.name}</strong>. {live ? 'Recipients will receive the selected candidate areas in their inbox.' : pilot ? 'Sites are from the city inventory snapshot.' : 'Candidate sites currently use demo map data.'}</p>
      <label className="community-check"><input type="checkbox" checked={friendsOnly} onChange={event => { setFriendsOnly(event.target.checked); setRecipient(''); }}/> Friends only</label>
      <label>Recipient<select required value={recipient} onChange={event => setRecipient(event.target.value)}>
        <option value="">Choose a collaborator</option>
        {people.map(person => <option key={person.id} value={person.id}>{person.name} · {person.neighborhood}</option>)}
      </select></label>
      {!people.length && <p className="muted">No matching collaborators. Ask someone with the same ZIP code to opt in through Photosynthesis.</p>}
      {live && sites.length > 10 && <p role="status">Choose up to 10 candidate areas per call.</p>}
      <label>Invitation note<textarea name="note" maxLength={500} rows={2}/></label>
      <button className="primary" disabled={busy || !title.trim() || !sites.length || (live && sites.length > 10) || !people.some(person => person.id === recipient)}>Send planting call</button>
    </form>}
    {data && !compose && <div className="community-grid">
      <div>
        <h3>Your live profile</h3>
        <form key={data.user.id} onSubmit={event => {
          event.preventDefault();
          const fields = new FormData(event.currentTarget);
          void mutate('profile', { name: fields.get('name'), neighborhood: fields.get('neighborhood'), zip: fields.get('zip'), visible: fields.has('visible') });
        }}>
          <label>Display name<input name="name" required maxLength={48} defaultValue={data.user.name}/></label>
          <LocationFields area={data.user.neighborhood} zip={data.user.zip}/>
          <label className="community-check"><input type="checkbox" name="visible" defaultChecked={!!data.user.visible}/> Let people in my ZIP code and my friends find me</label>
          <button className="primary" disabled={busy}>Save live profile</button>
          <button type="button" className="secondary" disabled={busy} onClick={() => void mutate('logout')}>Sign out</button>
        </form>
      </div>
      <div>
        <h3>Nearby collaborators</h3>
        <label className="community-check"><input type="checkbox" checked={friendsOnly} onChange={event => setFriendsOnly(event.target.checked)}/> Friends only</label>
        {!people.length && <p className="muted">No opted-in collaborators in your ZIP code yet.</p>}
        {people.map(person => <div className="invitation" key={person.id}>
          <strong>{person.name}</strong><p>{person.neighborhood}</p>
          {person.friend ? <small>Friend</small> : <button className="secondary" disabled={busy} onClick={() => void mutate('friend', { recipient: person.id })}>Request friendship</button>}
        </div>)}
        {data.requests.map(person => <div className="invitation" key={person.id}>{person.name} requested friendship. <button className="secondary" disabled={busy} onClick={() => void mutate('acceptFriend', { recipient: person.id })}>Accept</button></div>)}
      </div>
      <div>
        <h3>Live proposal inbox</h3>
        {!incoming.length && <p className="muted">No planting calls received yet.</p>}
        {incoming.map(call => <article className="invitation" key={call.id}>
          <h4>{call.title}</h4><p>From {call.senderName}</p><p>{call.sites.join(', ')}</p>
          {call.note && <p>{call.note}</p>}
          {call.reply === 'pending' ? <div className="mailbox-controls">
            <button className="secondary" disabled={busy} onClick={() => void mutate('reply', { id: call.id, reply: 'interested' })}>I’m interested</button>
            <button className="secondary" disabled={busy} onClick={() => void mutate('reply', { id: call.id, reply: 'declined' })}>Decline</button>
          </div> : <p>Status · {call.reply}</p>}
        </article>)}
        <h3>Sent calls</h3>
        {!outgoing.length && <p className="muted">No planting calls sent yet.</p>}
        {outgoing.map(call => <p key={call.id}>{call.title} · {call.recipientName} · {call.reply}</p>)}
      </div>
    </div>}
    <p role="status">{status}</p>
  </section>;
}
