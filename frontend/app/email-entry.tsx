'use client';

import { useState } from 'react';

export function LocationFields({ area, zip }: { area?: string; zip?: string }) {
  return <div className="location-fields">
    <label>City or neighborhood<input name="neighborhood" required minLength={2} maxLength={80} defaultValue={area} autoComplete="address-level2" placeholder="e.g. Mountain House"/></label>
    <label>ZIP code<input name="zip" required inputMode="numeric" pattern="[0-9]{5}" maxLength={5} defaultValue={zip} autoComplete="postal-code"/></label>
  </div>;
}

export default function EmailEntry({ onVerified }: { onVerified: () => void }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setStatus('');
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const response = await fetch('/api/community', { method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ ...fields, email, action: sent ? 'verifyCode' : 'sendCode' }) });
      if (!response.ok) throw new Error((await response.json()).error || 'Could not sign in.');
      if (sent) onVerified();
      else { setSent(true); setStatus('Check your inbox for a six-digit code.'); }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not sign in.');
    } finally { setBusy(false); }
  }
  return <form onSubmit={submit} key={sent ? 'verify' : 'email'}>
    <label>Email<input autoComplete="email" type="email" value={email} maxLength={254} required readOnly={sent} onChange={e=>setEmail(e.target.value)}/></label>
    {sent && <>
      <label>Verification code<input name="code" required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6}/></label>
      <p className="muted">These details create your profile the first time you sign in. Your email and ZIP stay private.</p>
      <label>Display name<input name="name" required maxLength={48} autoComplete="nickname"/></label>
      <LocationFields/>
    </>}
    <button className="primary" disabled={busy}>{sent ? 'Verify and continue' : 'Email me a code'}</button>
    {sent && <button type="button" className="secondary" disabled={busy} onClick={()=>{setSent(false);setStatus('');}}>Change email or request another code</button>}
    <p role="status">{status}</p>
  </form>;
}
