'use client';

import Link from 'next/link';
import ActionPlan, { type Activity, type Review, type Visit } from './action-plan';
import { useEffect, useState } from 'react';
import { ArrowUpRight, CalendarDays, FileText, Inbox, Leaf, Mail, MapPin, Send, UserRound, Users } from 'lucide-react';
import { label, live, type Site } from './data';

export const people = [
  { id: 'jordan', name: 'Jordan Lee', neighborhood: 'Mayfair', role: 'Tree planting volunteer' },
  { id: 'maya', name: 'Maya Rivera', neighborhood: 'Five Wounds', role: 'Community garden organizer' },
  { id: 'eli', name: 'Eli Chen', neighborhood: 'Northside', role: 'Neighborhood volunteer' },
];
type Person = (typeof people)[number];
type Profile = { name: string; neighborhood: string; discoverable: boolean };
type FieldNote = { id: string; siteId: string; author: string; text: string; createdAt: string };
type Draft = { id: string; title: string; siteIds: string[] };

type Invitation = {
  id: string;
  from: string;
  to: string[];
  title: string;
  note: string;
  sites: { id: string; name: string; score: number; heat?: number | null; canopy?: number | null }[];
  visits?: Visit[];
  reviews?: Review[];
  activity?: Activity[];
  fieldNotes?: FieldNote[];
  replies: Record<string, 'interested' | 'declined'>;
};
export type Workspace = { account: string; profiles: Record<string, Profile>; invitations: Invitation[]; drafts?: Record<string, Draft[]> };
export const initial: Workspace = { account: people[0].id, profiles: {}, invitations: [] };
export const storageKey = 'heat-shield-community-v1';

function defaultProfile(person: Person): Profile {
  return { name: person.name, neighborhood: person.neighborhood, discoverable: true };
}

export default function Community({ title, sites, onLoadDraft, onAccountChange }: {
  title: string;
  sites: Site[];
  onLoadDraft: (draft: Draft) => void;
  onAccountChange: (id: string) => void;
}) {
  const [workspace, setWorkspace] = useState(initial);
  const [ready, setReady] = useState(false);
  const [friendsOnly, setFriendsOnly] = useState(false);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [status, setStatus] = useState('');
  const [preview, setPreview] = useState(false);
  const [mailbox, setMailbox] = useState<'received' | 'sent'>('received');

  useEffect(() => {
    if (live) return;
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const saved = JSON.parse(stored) as Workspace;
        if (people.some(person => person.id === saved.account) && saved.profiles && Array.isArray(saved.invitations)) {
          setWorkspace(saved);
        }
      }
    } catch {
      setStatus('Saved demo data could not be loaded.');
    }
    setReady(true);
  }, []);

  if (live) return <section id="community" className="community" aria-labelledby="community-title">
    <h2 id="community-title">Community workspace</h2>
    <p>Profiles and proposal invitations will be available when account services are connected.</p>
  </section>;

  const { account, profiles, invitations } = workspace;
  const current = people.find(person => person.id === account) ?? people[0];
  const profile = profiles[account] ?? defaultProfile(current);
  const profileFor = (person: Person) => profiles[person.id] ?? defaultProfile(person);
  const displayName = (id: string) => {
    const person = people.find(member => member.id === id);
    return person ? profileFor(person).name : id;
  };
  const isFriend = (id: string) => id !== account && id !== 'eli' && account !== 'eli';
  const nearby = people.filter(person => person.id !== account && profileFor(person).discoverable);
  const visiblePeople = nearby.filter(person => !friendsOnly || isFriend(person.id));
  const eligibleRecipients = nearby.filter(person => recipients.includes(person.id)).map(person => person.id);
  const incoming = invitations.filter(invitation => invitation.to.includes(account));
  const outgoing = invitations.filter(invitation => invitation.from === account);
  const pending = incoming.filter(invitation => !invitation.replies[account]).length;

  function save(next: Workspace) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setWorkspace(next);
      return true;
    } catch {
      setStatus('This browser could not save the change.');
      return false;
    }
  }

  const drafts = workspace.drafts?.[account] ?? [];

  function saveDraft() {
    if (!title.trim() || !sites.length) return;
    const existing = drafts.find(draft => draft.title === title.trim());
    const draft = { id: existing?.id ?? crypto.randomUUID(), title: title.trim(), siteIds: sites.map(site => site.id) };
    const updated = [draft, ...drafts.filter(item => item.id !== draft.id)];
    if (save({ ...workspace, drafts: { ...workspace.drafts, [account]: updated } })) {
      setStatus('Proposal draft saved.');
    }
  }

  function updatePlan(invitation: Invitation, changes: Partial<Invitation>, event: string) {
    const activity = { id: crypto.randomUUID(), author: account, text: event, at: new Date().toISOString() };
    const updated = { ...invitation, ...changes, activity: [...(invitation.activity ?? []), activity] };
    return save({ ...workspace, invitations: invitations.map(item => item.id === updated.id ? updated : item) });
  }

  function saveFieldNote(event: React.FormEvent<HTMLFormElement>, invitation: Invitation) {
    event.preventDefault();
    if (invitation.from !== account && invitation.replies[account] !== 'interested') return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const siteId = String(fields.get('siteId') ?? '');
    const text = String(fields.get('fieldNote') ?? '').trim();
    if (!text || !invitation.sites.some(site => site.id === siteId)) return;
    const note = { id: crypto.randomUUID(), siteId, author: account, text, createdAt: new Date().toISOString() };
    if (updatePlan(invitation, { fieldNotes: [...(invitation.fieldNotes ?? []), note] }, 'added a field note.')) {
      form.reset();
      setStatus('Field note saved.');
    }
  }

  function switchAccount(id: string) {
    if (!save({ ...workspace, account: id })) return;
    setPreview(false);
    setRecipients([]);
    setNote('');
    setStatus('');
    setMailbox('received');
    setFriendsOnly(false);
    onAccountChange(id);
  }

  function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const name = String(fields.get('displayName') ?? '').trim();
    const neighborhood = String(fields.get('neighborhood') ?? '');
    if (!name) {
      setStatus('Enter a display name.');
      return;
    }
    const updated = { name, neighborhood, discoverable: fields.has('discoverable') };
    if (save({ ...workspace, profiles: { ...profiles, [account]: updated } })) setStatus('Profile saved.');
  }

  function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || !sites.length || !eligibleRecipients.length || !preview) return;
    const invitation: Invitation = {
      id: crypto.randomUUID(),
      from: account,
      to: eligibleRecipients,
      title: title.trim(),
      note: note.trim(),
      sites: sites.map(site => ({ id: site.id, name: label(site), score: site.priority_score, heat: site.heat_score, canopy: site.canopy_coverage })),
      replies: {},
    };
    if (!save({ ...workspace, invitations: [invitation, ...invitations] })) return;
    setStatus('Demo invitation saved in the selected collaborators’ inboxes.');
    setPreview(false);
    setRecipients([]);
    setNote('');
    setMailbox('sent');
  }

  function reply(invitation: Invitation, answer: 'interested' | 'declined') {
    if (!invitation.to.includes(account) || invitation.replies[account]) return;
    if (updatePlan(invitation, { replies: { ...invitation.replies, [account]: answer } }, answer === 'interested' ? 'accepted the invitation.' : 'declined the invitation.')) {
      setStatus(answer === 'interested' ? 'Interest recorded.' : 'Invitation declined.');
    }
  }

  const myVisits = [...incoming.filter(item => item.replies[account] === 'interested'), ...outgoing]
    .flatMap(item => (item.visits ?? []).filter(visit => visit.assignee === account && visit.status === 'planned')
      .map(visit => ({ ...visit, invitation: item, site: item.sites.find(site => site.id === visit.siteId)?.name })))
    .sort((a, b) => a.date.localeCompare(b.date));

  return <section id="community" className="community" aria-labelledby="community-title">
    <div className="planning-banner">
      <div>
        <p className="eyebrow"><Users size={16}/> Photosynthesis · San José</p>
        <h2 id="community-title">Welcome, {profile.name}</h2>
        <p>Pick up your proposal, check invitations, or plan your next site visit.</p>
      </div>
      <Link className="banner-action" href="/explore">Open Pinpoint <ArrowUpRight size={16}/></Link>
    </div>
    <section className="community-panel personal-dashboard" aria-labelledby="dashboard-title">
      <h3 id="dashboard-title"><Leaf size={20}/> My proposals</h3>
      <div className="workspace-stats">
        <a href="#proposal-drafts"><span className="stat-icons"><FileText size={19}/><ArrowUpRight size={15}/></span><strong>{drafts.length}</strong><span>Saved drafts</span></a>
        <a href="#inbox-title" onClick={() => setMailbox('received')}><span className="stat-icons"><Inbox size={19}/><ArrowUpRight size={15}/></span><strong>{pending}</strong><span>Pending invites</span></a>
        <a href="#inbox-title" onClick={() => setMailbox('sent')}><span className="stat-icons"><Send size={19}/><ArrowUpRight size={15}/></span><strong>{outgoing.length}</strong><span>Sent proposals</span></a>
        <a href="#planned-visits"><span className="stat-icons"><CalendarDays size={19}/><ArrowUpRight size={15}/></span><strong>{myVisits.length}</strong><span>Planned visits</span></a>
      </div>
      <h4 id="planned-visits">My planned visits</h4>
      {myVisits.length ? <ul>{myVisits.map(visit => <li key={visit.invitation.id + '/' + visit.siteId}>
        <a href={'#proposal-invite-' + visit.invitation.id} onClick={() => setMailbox(visit.invitation.from === account ? 'sent' : 'received')}>{visit.site}</a> · <time dateTime={visit.date}>{visit.date}</time>
      </li>)}</ul> : <p className="muted">You have no planned field visits.</p>}
    </section>
    <nav className="workspace-links" aria-label="Workspace sections">
      <a href="#profile-title">Demo profile</a>
      <a href="#collaborators-title">Find collaborators</a>
      <a href="#inbox-title" onClick={() => setMailbox('received')}>Open inbox</a>
    </nav>
    <div className="community-grid">
      <section className="community-panel profile-panel" aria-labelledby="profile-title">
        <h3 id="profile-title"><UserRound size={19}/> Your profile</h3>
        <label>Demo account<select disabled={!ready} value={account} onChange={event => switchAccount(event.target.value)}>
          {people.map(person => <option value={person.id} key={person.id}>{profileFor(person).name}</option>)}
        </select></label>
        <form key={account} onSubmit={saveProfile}>
          <label>Display name<input name="displayName" required maxLength={48} defaultValue={profile.name}/></label>
          <label>Neighborhood<select name="neighborhood" defaultValue={profile.neighborhood}>
            {people.map(person => <option key={person.neighborhood}>{person.neighborhood}</option>)}
          </select></label>
          <label className="community-check"><input type="checkbox" name="discoverable" defaultChecked={profile.discoverable}/> Show me to nearby collaborators</label>
          <button className="secondary" disabled={!ready}>Save profile</button>
        </form>
        <h4 id="proposal-drafts">My proposal drafts</h4>
        <button type="button" className="secondary" disabled={!ready || !title.trim() || !sites.length} onClick={saveDraft}>Save current draft</button>
        {drafts.length ? <ul className="draft-list">{drafts.map(draft => <li key={draft.id}>
          <button type="button" className="secondary" onClick={() => {
            onLoadDraft(draft);
            setPreview(false);
            setStatus('Proposal draft loaded.');
          }}>Open {draft.title}</button>
        </li>)}</ul> : <p className="muted">No saved drafts yet.</p>}
      </section>

      <form className="community-panel collaborators-panel" onSubmit={preview ? send : event => { event.preventDefault(); setPreview(true); }} aria-labelledby="collaborators-title">
        <h3 id="collaborators-title"><Users size={19}/> Nearby collaborators</h3>
        <label className="community-check"><input type="checkbox" checked={friendsOnly} onChange={event => {
          setPreview(false);
          setFriendsOnly(event.target.checked);
          if (event.target.checked) setRecipients(previous => previous.filter(isFriend));
        }}/> Friends only</label>
        <fieldset onChange={() => setPreview(false)}>
          <legend>Choose recipients</legend>
          {visiblePeople.length ? visiblePeople.map(person => <label className="person-row" key={person.id}>
            <input type="checkbox" checked={recipients.includes(person.id)} onChange={event => {
              const checked = event.target.checked;
              setRecipients(previous => checked ? [...previous, person.id] : previous.filter(id => id !== person.id));
            }}/>
            <span className="person-initials" aria-hidden="true">{profileFor(person).name.slice(0, 1).toUpperCase()}</span>
            <span><strong>{profileFor(person).name}{isFriend(person.id) && <small> · Friend</small>}</strong>
              <small><MapPin size={12}/> {profileFor(person).neighborhood} · {person.role}</small>
            </span>
          </label>) : <p className="muted">No opted-in collaborators match this view.</p>}
        </fieldset>
        <p className="muted">{title.trim() && sites.length ? `${title.trim()} · ${sites.length} candidate ${sites.length === 1 ? 'site' : 'sites'}` : <>Choose sites and name your project in <Link href="/proposal">Planting proposal</Link>.</>}</p>
        <label>Invitation note <small>(optional)</small><textarea value={note} maxLength={500} rows={2} onChange={event => { setNote(event.target.value); setPreview(false); }} placeholder="Would you help review these sites?"/></label>
        {preview && <div className="invite-preview"><strong>{title.trim()}</strong>
          <p>To {eligibleRecipients.map(displayName).join(', ')}</p>
          <ul>{sites.map(site => <li key={site.id}>{label(site)}</li>)}</ul>
          {note.trim() && <p>{note.trim()}</p>}
        </div>}
        <button className="primary" disabled={!ready || !title.trim() || !sites.length || !eligibleRecipients.length}><Send size={16}/> {preview ? 'Send demo invitation' : 'Preview invitation'}</button>
      </form>

      <section className="community-panel inbox-panel" aria-labelledby="inbox-title">
        <h3 id="inbox-title"><Mail size={19}/> Proposal inbox</h3>
        <div className="mailbox-controls" aria-label="Proposal folders">
          <button className="secondary" aria-pressed={mailbox === 'received'} onClick={() => setMailbox('received')}>Received ({pending} pending)</button>
          <button className="secondary" aria-pressed={mailbox === 'sent'} onClick={() => setMailbox('sent')}>Sent ({outgoing.length})</button>
        </div>
        {(mailbox === 'received' ? incoming : outgoing).map(invitation => <article className="invitation" id={'proposal-invite-' + invitation.id} key={invitation.id}>
          <h4>{invitation.title}</h4>
          <p className="muted">{mailbox === 'received' ? `From ${displayName(invitation.from)}` : `To ${invitation.to.map(displayName).join(', ')}`}</p>
          {invitation.note && <p>{invitation.note}</p>}
          <details><summary>Review {invitation.sites.length} candidate {invitation.sites.length === 1 ? 'site' : 'sites'}</summary>
            <ul>{invitation.sites.map(site => <li key={site.id}>{site.name} · Priority {site.score}/100{site.heat != null && ` · Heat ${site.heat}/100`}{site.canopy != null && ` · Canopy ${site.canopy}%`}</li>)}</ul>
          </details>
          {mailbox === 'sent' ? <ul>{invitation.to.map(id => <li key={id}>{displayName(id)} · {invitation.replies[id] ?? 'pending'}</li>)}</ul>
            : invitation.replies[account] ? <p>Response · {invitation.replies[account]}</p>
            : <div className="mailbox-controls"><button className="primary" onClick={() => reply(invitation, 'interested')}>I’m interested</button><button className="secondary" onClick={() => reply(invitation, 'declined')}>Decline</button></div>}
          {(invitation.from === account || invitation.replies[account] === 'interested') && invitation.sites.length > 0 &&
            <ActionPlan key={account} sites={invitation.sites} visits={invitation.visits ?? []}
              reviews={invitation.reviews ?? []} activity={invitation.activity ?? []}
              account={account} owner={invitation.from === account} displayName={displayName}
              onVisit={visit => {
                const site = invitation.sites.find(item => item.id === visit.siteId);
                const previous = invitation.visits?.find(item => item.siteId === visit.siteId);
                if (!site || (previous && invitation.from !== account && previous.assignee !== account)) return;
                if (updatePlan(invitation, { visits: [...(invitation.visits ?? []).filter(item => item.siteId !== visit.siteId), visit] },
                  previous ? `updated the visit for ${site.name}.` : `volunteered to visit ${site.name}.`)) setStatus('Field visit saved.');
              }}
              onReview={review => {
                const site = invitation.sites.find(item => item.id === review.siteId);
                if (!site) return;
                const reviews = (invitation.reviews ?? []).filter(item => item.siteId !== review.siteId || item.taskId !== review.taskId);
                if (updatePlan(invitation, { reviews: [...reviews, review] }, `updated the checklist for ${site.name}.`)) setStatus('Checklist saved.');
              }}/>}
          {(invitation.from === account || invitation.replies[account] === 'interested') && <details className="field-notes">
            <summary>Field visit notes ({invitation.fieldNotes?.length ?? 0})</summary>
            <p className="muted">Share observations or a plan to visit. Official verification is recorded separately.</p>
            {invitation.fieldNotes?.map(note => <div className="field-note" key={note.id}>
              <strong>{invitation.sites.find(site => site.id === note.siteId)?.name}</strong>
              <p>{note.text}</p>
              <small>{displayName(note.author)} · <time dateTime={note.createdAt}>{note.createdAt.slice(0, 10)}</time></small>
            </div>)}
            <form onSubmit={event => saveFieldNote(event, invitation)}>
              <label>Site to review<select name="siteId">{invitation.sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
              <label>Field note<textarea name="fieldNote" required maxLength={500} rows={2} placeholder="For example, I can check for overhead lines on Saturday."/></label>
              <button type="submit" className="secondary">Add field note</button>
            </form>
          </details>}
        </article>)}
        {!(mailbox === 'received' ? incoming : outgoing).length && <p className="muted">{mailbox === 'received' ? 'No invitations received yet.' : 'No invitations sent yet.'}</p>}
      </section>
    </div>
    <p className="community-status" role="status">{status}</p>
  </section>;
}
