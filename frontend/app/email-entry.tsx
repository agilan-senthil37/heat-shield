'use client';

import { useState } from 'react';

export function LocationFields({ area, zip }: { area?: string; zip?: string }) {
  return <div className="location-fields">
    <label>City or neighborhood<input name="neighborhood" required minLength={2} maxLength={80} defaultValue={area} autoComplete="address-level2" placeholder="e.g. Mountain House"/></label>
    <label>State<select name="state" autoComplete="address-level1" defaultValue="CA" required><option value="CA">California</option></select></label>
    <label>ZIP code<input name="zip" required inputMode="numeric" pattern="[0-9]{5}" maxLength={5} defaultValue={zip} autoComplete="postal-code"/></label>
  </div>;
}

export default function EmailEntry({ onVerified, needsProfile = false }: { onVerified: () => void; needsProfile?: boolean }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [profile, setProfile] = useState(needsProfile);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setStatus('');
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const response = await fetch('/api/community', { method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ ...fields, email, action: profile ? 'completeProfile' : sent ? 'verifyCode' : 'sendCode' }) });
      if (!response.ok) throw new Error((await response.json()).error || 'Could not sign in.');
      if (profile) onVerified();
      else if (sent) {
        if ((await response.json()).profileRequired) setProfile(true);
        else onVerified();
      }
      else { setSent(true); setStatus('Check your inbox for a six-digit code.'); }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not sign in.');
    } finally { setBusy(false); }
  }
  return <form onSubmit={submit} key={profile ? 'profile' : sent ? 'verify' : 'email'}>
    {!profile && <label>Email<input autoComplete="email" type="email" value={email} maxLength={254} required readOnly={sent} onChange={e=>setEmail(e.target.value)}/></label>}
    {sent && !profile &&
      <label>Verification code<input name="code" required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6}/></label>}
    {profile && <>
      <p className="muted">Finish setting up your profile. HeatShield asks for these details once. People in your area can find you by your exact email if you opt in. Your email and ZIP are hidden in search results.</p>
      <label>Display name<input name="name" required maxLength={48} autoComplete="nickname"/></label>
      <LocationFields/>
    </>}
    <button className="primary" disabled={busy}>{profile ? 'Create profile' : sent ? 'Verify and continue' : 'Email me a code'}</button>
    {sent && !profile && <button type="button" className="secondary" disabled={busy} onClick={()=>{setSent(false);setStatus('');}}>Change email or request another code</button>}
    <p role="status">{status}</p>
  </form>;
}
