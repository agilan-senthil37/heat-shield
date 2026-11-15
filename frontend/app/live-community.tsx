'use client';

import { useEffect, useState } from 'react';
import { meetingDirections, type MeetingPoint } from './meeting-point';
import ProposalChat from './proposal-chat';
import EmailEntry, { LocationFields } from './email-entry';
import { live, pilot, type Site } from './data';

type Person = { id: string; zip?: string; name: string; neighborhood: string; friend: number; visible: number };
type Call = { canReport: number; workSites: { id: string; name: string; completedAt: string | null }[]; id: string; sender: string; recipient: string; senderName: string; recipientName: string; title: string; sites: string[]; note: string; reply: string; proposal?: string; email_status?: string; meeting?: MeetingPoint | null };
type Community = { user: Person; nearby: Person[]; requests: Person[]; calls: Call[] };
const endpoint = '/api/community';


export default function LiveCommunity({ title, sites, meeting, compose = false }: { title: string; sites: Site[]; meeting?: MeetingPoint; compose?: boolean }) {
  const [data, setData] = useState<Community | null>();
  const [auth, setAuth] = useState({ emailRequired: false, emailConfigured: false, profileRequired: false });
  const [register, setRegister] = useState(false);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<string[] | null>(null);
  const [searchStatus, setSearchStatus] = useState('');
  const [searching, setSearching] = useState(false);
  const [forwardId, setForwardId] = useState('');
  const [recipient, setRecipient] = useState('');
  const [busy, setBusy] = useState(false);
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
      if (action === 'logout') {
        try {
          sessionStorage.removeItem('heat-shield-browse');
          localStorage.removeItem('heat-shield-entered');
        } finally {
          window.location.replace('/');
        }
        return;
      }
      const result = await response.json();
      const invitation = action === 'send' || action === 'forward';
      if (invitation) {
        setRecipient('');
        setForwardId('');
        setStatus(result.emailStatus === 'accepted'
          ? 'Invitation posted in HeatShield and accepted by the email service.'
          : 'Invitation posted in HeatShield. Email was not sent.');
        await refresh().catch(() => setConnected(false));
      } else {
        await refresh();
        setStatus(action === 'completeSite' ? 'Work reported in Photosynthesis and Pinpoint.' : 'Saved.');
      }
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not save.'); }
    finally { setBusy(false); }
  }

  async function lookup() {
    setSearching(true);
    setSearchStatus('');
    setRecipient('');
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'lookup', query: query.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not search.');
      setMatches(result.people.map((person: Person) => person.id));
    } catch (error) {
      setMatches([]);
      setSearchStatus(error instanceof Error ? error.message : 'Could not search.');
    } finally { setSearching(false); }
  }

  function siteProgress(call: Call) {
    if (!live || !call.workSites.some(site => site.completedAt || call.canReport)) return null;
    const canReport = call.canReport && (call.sender === data?.user.id || call.recipient === data?.user.id);
    return <ul>
      {call.workSites.map(site => <li key={site.id}>
        {site.completedAt ? <p><strong>Work reported complete</strong> · {site.name} · {new Date(site.completedAt).toLocaleDateString()}</p>
          : Boolean(canReport) && <button type="button" className="secondary" disabled={busy} onClick={() => {
            if (window.confirm('Report finished planting work at ' + site.name + '? This lowers the site’s planning score.')) {
              void mutate('completeSite', { id: call.id, siteId: site.id });
            }
          }}>Report work complete · {site.name}</button>}
      </li>)}
    </ul>;
  }

  const people = data?.nearby.filter(person => !matches || matches.includes(person.id)) ?? [];
  const collaborators = [
    { label: 'Friends', people: people.filter(person => person.friend) },
    { label: 'Nearby people', people: people.filter(person => !person.friend) },
  ];
  const search = <div>
    <label>Find by display name or exact email<input type="search" value={query} maxLength={254} disabled={searching}
      placeholder="e.g. Maya or maya@example.com"
      onChange={event => { setQuery(event.target.value); setMatches(null); setSearchStatus(''); setRecipient(''); }}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); if (!searching && query.trim().length >= 2) void lookup(); } }}/></label>
    <button type="button" className="secondary" onClick={() => void lookup()} disabled={searching || query.trim().length < 2}>{searching ? 'Searching…' : 'Search collaborators'}</button>
    <p role="status" className="muted">{searchStatus || (matches ? (people.length ? `${people.length} matching profiles.` : 'No matching profiles among your eligible collaborators.') : '')}</p>
  </div>;
  const incoming = data?.calls.filter(call => call.recipient === data.user.id) ?? [];
  const ownedProposals = new Set(data?.calls.filter(call => call.sender === data.user.id && (!call.proposal || call.proposal === call.id)).map(call => call.id));
  const outgoing = data?.calls.filter(call => call.sender === data.user.id || ownedProposals.has(call.proposal ?? call.id)) ?? [];
  function inviteMore(call: Call) {
    const group = call.proposal ?? call.id;
    const invited = new Set(data?.calls.filter(other => (other.proposal ?? other.id) === group)
      .flatMap(other => [other.sender, other.recipient]));
    const available = data?.nearby.filter(person => !invited.has(person.id)) ?? [];
    if (forwardId !== call.id) return <button type="button" className="secondary" disabled={busy} onClick={() => {
      setForwardId(call.id); setRecipient('');
    }}>Invite another collaborator</button>;
    return <form onSubmit={event => {
      event.preventDefault();
      void mutate('forward', { id: call.id, recipient });
    }}>
      <label>Collaborator<select value={recipient} required onChange={event => setRecipient(event.target.value)}>
        <option value="">Choose a collaborator</option>
        {available.map(person => <option value={person.id} key={person.id}>{person.name} · {person.neighborhood}</option>)}
      </select></label>
      {!available.length && <p className="muted">No other eligible collaborators are available.</p>}
      <button className="primary" disabled={busy || !recipient}>Send invitation</button>
      <button type="button" className="secondary" disabled={busy} onClick={() => { setForwardId(''); setRecipient(''); }}>Cancel</button>
    </form>;
  }

  return <section id={compose ? "send-planting-call" : undefined} className="community-panel live-community" aria-label={compose ? 'Send planting call' : 'Live Photosynthesis'}>
    <h2>{compose ? 'Send a planting call' : 'Live Photosynthesis'}</h2>
    <p className="muted">{connected ? 'Inbox and collaborator updates appear automatically.' : 'Account connection unavailable or loading…'}</p>
    {data === null && (compose ? <a href="/#live-photosynthesis">Sign in to send a planting call</a> : auth.emailConfigured ? <EmailEntry needsProfile={auth.profileRequired} onVerified={() => void refresh().catch(()=>setConnected(false))}/> : auth.emailRequired ? <p>Email verification is not configured on this server.</p> :
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
      void mutate('send', { recipient, title, siteIds: sites.map(site => site.id), meeting: sites.some(site => site.id === meeting?.siteId) ? meeting : undefined, note: fields.get('note') });
    }}>
      <ul className="send-sites">{sites.map(site=><li key={site.id}>{site.name || site.id} · {site.neighborhood}</li>)}</ul><p>Sending as <strong>{data.user.name}</strong>. {live ? 'Recipients get the selected areas and any saved meeting point in their HeatShield inbox. Email is sent when a sender is configured.' : pilot ? 'Sites are from the city inventory snapshot.' : 'Candidate sites currently use demo map data.'}</p>
      {search}
      <label>Recipient<select required value={recipient} onChange={event => setRecipient(event.target.value)}>
        <option value="">Choose a collaborator</option>
        {collaborators.map(group => group.people.length > 0 && <optgroup label={group.label} key={group.label}>
          {group.people.map(person => <option key={person.id} value={person.id}>{person.name} · {person.neighborhood}</option>)}
        </optgroup>)}
      </select></label>
      {!people.length && <p className="muted">No matching collaborators. Ask your collaborator to opt in through Photosynthesis.</p>}
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
          void mutate('profile', { name: fields.get('name'), neighborhood: fields.get('neighborhood'), zip: fields.get('zip'), state: fields.get('state'), visible: fields.has('visible') });
        }}>
          <label>Display name<input name="name" required maxLength={48} defaultValue={data.user.name}/></label>
          <LocationFields area={data.user.neighborhood} zip={data.user.zip}/>
          <label className="community-check"><input type="checkbox" name="visible" defaultChecked={!!data.user.visible}/> Let nearby collaborators find me by name or exact email</label>
          <button className="primary" disabled={busy}>Save live profile</button>
          <button type="button" className="secondary" disabled={busy} onClick={() => void mutate('logout')}>Sign out</button>
        </form>
      </div>
      <div>
        <h3>Friends and nearby collaborators</h3>
        {search}
        {collaborators.map(group => <section key={group.label} aria-label={group.label}>
          <h4>{group.label}</h4>
          {!group.people.length && <p className="muted">{matches ? 'No matches.' : group.label === 'Friends' ? 'No accepted friends yet.' : 'No opted-in collaborators in your area yet.'}</p>}
          {group.people.map(person => <div className="invitation" key={person.id}>
            <strong>{person.name}</strong><p>{person.neighborhood}</p>
            {!person.friend && <button className="secondary" disabled={busy} onClick={() => void mutate('friend', { recipient: person.id })}>Request friendship</button>}
          </div>)}
        </section>)}
        {data.requests.map(person => <div className="invitation" key={person.id}>{person.name} requested friendship. <button className="secondary" disabled={busy} onClick={() => void mutate('acceptFriend', { recipient: person.id })}>Accept</button></div>)}
      </div>
      <div>
        <h3>Live proposal inbox</h3>
        {!incoming.length && <p className="muted">No planting calls received yet.</p>}
        {incoming.map(call => <article className="invitation" key={call.id}>
          <h4>{call.title}</h4><p>From {call.senderName}</p><p>{call.sites.join(', ')}</p>
          {siteProgress(call)}
          {call.note && <p>{call.note}</p>}
          {call.meeting && <p><strong>Meet at {call.meeting.name}</strong> · <a href={meetingDirections(call.meeting)} target="_blank" rel="noreferrer">Get directions</a></p>}
          {call.reply === 'pending' ? <div className="mailbox-controls">
            <button className="secondary" disabled={busy} onClick={() => void mutate('reply', { id: call.id, reply: 'interested' })}>Accept invitation</button>
            <button className="secondary" disabled={busy} onClick={() => void mutate('reply', { id: call.id, reply: 'declined' })}>Decline</button>
          </div> : <p>Status · {call.reply === 'interested' ? 'Accepted' : call.reply}</p>}
          {call.reply === 'interested' && <>
            <ProposalChat callId={call.id} viewer={data.user.id} partner={call.senderName}/>
            {inviteMore(call)}
          </>}
        </article>)}
        <h3>Sent calls</h3>
        {!outgoing.length && <p className="muted">No planting calls sent yet.</p>}
        {outgoing.map(call => <article className="invitation" key={call.id}>
          <h4>{call.title}</h4><p>To {call.recipientName} · {call.reply === 'interested' ? 'Accepted' : call.reply}</p>
          {siteProgress(call)}
          {call.sender !== data.user.id && <p>Invited by {call.senderName}</p>}
          {call.meeting && <p>Meet at <a href={meetingDirections(call.meeting)} target="_blank" rel="noreferrer">{call.meeting.name}</a></p>}
          <p className="muted">{call.email_status === 'accepted' ? 'Email accepted by the mail service' : call.email_status === 'pending' ? 'Email pending' : 'In-app invitation only'}</p>
          {call.sender === data.user.id && call.reply === 'interested' &&
            <ProposalChat callId={call.id} viewer={data.user.id} partner={call.recipientName}/>}
          {call.sender === data.user.id && (!call.proposal || call.proposal === call.id) && inviteMore(call)}
        </article>)}
      </div>
    </div>}
    <p role="status">{status}</p>
  </section>;
}
