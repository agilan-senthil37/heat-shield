'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { initial, people, storageKey, type Workspace } from './community';
import { live, pilot } from './data';
import HeatShieldBrand from './heatshield-brand';
import EmailEntry from './email-entry';

const entryKey = 'heat-shield-entered';


export default function AccountGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'loading' | 'welcome' | 'ready'>('loading');
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [needsProfile, setNeedsProfile] = useState(false);
  const [account, setAccount] = useState(initial.account);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    if (sessionStorage.getItem('heat-shield-browse') === 'yes' || new URLSearchParams(window.location.search).has('browse')) { setState('ready'); return; }
    fetch('/api/community', { cache:'no-store', signal:controller.signal }).then(async response => {
      if (controller.signal.aborted) return;
      if (response.ok) { setState('ready'); return; }
      if (response.status !== 401) throw new Error();
      const config = await response.json();
      if (controller.signal.aborted) return;
      setEmailConfigured(config.emailConfigured);
      setNeedsProfile(config.profileRequired === true);
      setState(!config.emailRequired && localStorage.getItem(entryKey) === 'yes' ? 'ready' : 'welcome');
    }).catch(() => {
      if (controller.signal.aborted) return;
      setError('The account service is unavailable. You can still browse the atlas.');
      setState('welcome');
    });
    return () => controller.abort();
  }, []);

  function enterDemo(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const raw = localStorage.getItem(storageKey);
      const stored: Workspace = raw ? JSON.parse(raw) : initial;
      localStorage.setItem(storageKey, JSON.stringify({ ...stored, account }));
      localStorage.setItem(entryKey, 'yes');
      setState('ready');
    } catch {
      setError('Couldn’t open the demo profile. Check that browser storage is available.');
    }
  }

  useEffect(() => {
    if (state !== 'ready' || live || window.location.pathname !== '/') return;
    const target = window.location.hash.slice(1) || 'community';
    document.getElementById(target)?.scrollIntoView({ behavior: 'instant' });
  }, [state]);

  if (state === 'ready') return children;

  return <main className="account-entry">
    <div className="entry-intro">
      <div className="account-brand"><HeatShieldBrand/></div>
      <p className="eyebrow">Community tree planting · Northern California</p>
      <h1>More shade for the streets we share.</h1>
      <p>Find blocks where trees could make a difference, walk the site with a neighbor, and make a plan together.</p>
      <ol><li>Find a candidate in Pinpoint</li><li>Start a planting call</li><li>Hear back in Photosynthesis</li></ol>
    </div>
    <section className="account-card" aria-labelledby="account-title">
      <h2 id="account-title">{emailConfigured ? 'Sign in or create an account' : 'Open the field atlas'}</h2>
      {state === 'loading' ? <p role="status">Checking your account…</p> : <>
        {emailConfigured ? <EmailEntry needsProfile={needsProfile} onVerified={()=>setState('ready')}/> :
          <p>{live ? 'Email verification is unavailable. Sign-in is required to send planting calls.' : pilot ? 'This preview uses San José city inventory. You can create a local account in Photosynthesis to try planting calls.' : 'Try the workflow with sample locations.'}</p>}
        {live || pilot || emailConfigured ? <button type="button" className={emailConfigured ? 'secondary' : 'primary'} onClick={()=>{sessionStorage.setItem('heat-shield-browse','yes'); if (window.location.pathname === '/') window.location.assign('/explore'); else setState('ready');}}>Browse Pinpoint <ArrowRight size={17}/></button>
        : <form onSubmit={enterDemo}>
          <label htmlFor="entry-account">Try a demo profile</label>
          <select id="entry-account" value={account} onChange={event => setAccount(event.target.value)}>
            {people.map(person => <option value={person.id} key={person.id}>{person.name} · {person.neighborhood}</option>)}
          </select>
          <button className="primary">Open demo workspace <ArrowRight size={17}/></button>
        </form>}
      </>}
      {error && <p role="alert">{error}</p>}
    </section>
  </main>;
}
