import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { NextRequest, NextResponse } from 'next/server';
import { demoSites, live, pilot, pilotSites } from '../../data';

import { containsPoint, readMeeting, type MeetingPoint } from '../../meeting-point';
import { notifyInvite } from './invitation-email';
import { emailAuth, emailConfigured, emailRequired } from './auth';

export const runtime = 'nodejs';

function database() {
  const db = new DatabaseSync(process.env.HEAT_SHIELD_DB || '.heat-shield.sqlite');
  db.exec(`
    PRAGMA busy_timeout=3000;
    CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, handle TEXT UNIQUE, name TEXT, neighborhood TEXT, visible INTEGER, secret TEXT);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, member TEXT, expires INTEGER);
    CREATE TABLE IF NOT EXISTS calls (id TEXT PRIMARY KEY, sender TEXT, recipient TEXT, title TEXT, sites TEXT, note TEXT, reply TEXT, created TEXT);
    CREATE TABLE IF NOT EXISTS proposal_messages (
      id INTEGER PRIMARY KEY, call_id TEXT NOT NULL REFERENCES calls(id),
      sender TEXT NOT NULL REFERENCES members(id), body TEXT NOT NULL, created TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS proposal_messages_call ON proposal_messages(call_id, id);
    CREATE TABLE IF NOT EXISTS site_completions (
      site_id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL REFERENCES calls(id),
      reported_by TEXT NOT NULL REFERENCES members(id), completed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS friends (sender TEXT, recipient TEXT, accepted INTEGER, PRIMARY KEY(sender,recipient));
  `);
  const callColumns = db.prepare('PRAGMA table_info(calls)').all();
  if (!callColumns.some(column => column.name === 'site_ids')) db.exec('ALTER TABLE calls ADD COLUMN site_ids TEXT');
  if (!callColumns.some(column => column.name === 'meeting')) db.exec('ALTER TABLE calls ADD COLUMN meeting TEXT');
  if (!callColumns.some(column => column.name === 'proposal')) db.exec('ALTER TABLE calls ADD COLUMN proposal TEXT');
  if (!callColumns.some(column => column.name === 'email_status')) db.exec('ALTER TABLE calls ADD COLUMN email_status TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS calls_proposal_recipient ON calls(proposal,recipient) WHERE proposal IS NOT NULL');
  const columns = new Set(db.prepare('PRAGMA table_info(members)').all().map(column => column.name));
  if (!columns.has('zip')) db.exec("ALTER TABLE members ADD COLUMN zip TEXT NOT NULL DEFAULT ''");
  if (!columns.has('state')) db.exec("ALTER TABLE members ADD COLUMN state TEXT NOT NULL DEFAULT 'CA'");
  if (!columns.has('email')) db.exec('ALTER TABLE members ADD COLUMN email TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS members_verified_email ON members(email) WHERE email IS NOT NULL');
  return db;
}
const cookie = 'heat_shield_session';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const location = (body: Record<string, unknown>) => {
  const neighborhood = clean(body.neighborhood, 80).normalize('NFC').replace(/\s+/g,' ');
  const zip = clean(body.zip, 16);
  const state = body.state ?? 'CA';
  return state === 'CA' && neighborhood.length >= 2 && /^\d{5}$/.test(zip) ? { neighborhood, zip, state } : null;
};
const clean = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0,max) : '';
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });
function member(db: DatabaseSync, request: NextRequest) {
  const token = request.cookies.get(cookie)?.value;
  if (!token) return undefined;
  return db.prepare(`SELECT m.id,m.name,m.neighborhood,m.zip,m.state,m.visible FROM sessions s JOIN members m ON m.id=s.member WHERE s.token=? AND s.expires>? AND (?=0 OR m.handle LIKE 'supabase:%')`).get(digest(token),Date.now(),Number(emailRequired));
}
function snapshot(db: DatabaseSync, user: Record<string, unknown>) {
  const id = String(user.id);
  return {
    user,
    nearby: db.prepare(`SELECT m.id,m.name,m.neighborhood,
      EXISTS(SELECT 1 FROM friends f WHERE f.accepted=1 AND ((f.sender=m.id AND f.recipient=?) OR (f.sender=? AND f.recipient=m.id))) AS friend
      FROM members m WHERE m.id<>? AND ((m.visible=1 AND m.state=? AND ((m.zip<>'' AND m.zip=?) OR
        (lower(trim(m.neighborhood)) IN ('tracy','mountain house') AND ? IN ('tracy','mountain house')))) OR EXISTS(
        SELECT 1 FROM friends f WHERE f.accepted=1 AND ((f.sender=m.id AND f.recipient=?) OR (f.sender=? AND f.recipient=m.id))
      )) ORDER BY m.name`).all(id,id,id,String(user.state),String(user.zip),String(user.neighborhood).trim().toLowerCase(),id,id),
    requests: db.prepare('SELECT f.sender AS id,m.name FROM friends f JOIN members m ON m.id=f.sender WHERE f.recipient=? AND f.accepted=0').all(id),
    calls: db.prepare(`SELECT c.*, s.name AS senderName, r.name AS recipientName,
      EXISTS(SELECT 1 FROM calls accepted WHERE COALESCE(accepted.proposal,accepted.id)=COALESCE(c.proposal,c.id)
        AND accepted.reply='interested' AND (accepted.sender=? OR accepted.recipient=?)) AS canReport
      FROM calls c JOIN members s ON s.id=c.sender JOIN members r ON r.id=c.recipient
      WHERE c.sender=? OR c.recipient=? OR EXISTS(
        SELECT 1 FROM calls root WHERE root.id=COALESCE(c.proposal,c.id) AND root.sender=?
      ) ORDER BY c.created DESC`).all(id,id,id,id,id).map(row => {
      const sites: string[] = JSON.parse(String(row.sites));
      const meeting = row.meeting ? readMeeting(JSON.parse(String(row.meeting))) : null;
      const siteIds: string[] = row.site_ids ? JSON.parse(String(row.site_ids)) : sites.length === 1 && meeting ? [meeting.siteId] : [];
      const completion = db.prepare('SELECT completed_at FROM site_completions WHERE site_id=?');
      return { ...row, sites, meeting, workSites: siteIds.map((siteId, index) => ({
        id: siteId, name: sites[index], completedAt: completion.get(siteId)?.completed_at ?? null,
      })) };
    }),
  };
}

function canMessage(db: DatabaseSync, call: string, user: string) {
  return Boolean(db.prepare(`SELECT 1 FROM calls
    WHERE id=? AND reply='interested' AND (sender=? OR recipient=?)`).get(call,user,user));
}

export function GET(request: NextRequest) {
  const db = database();
  try {
    if (request.nextUrl.searchParams.has('completedSites')) {
      const sites = db.prepare('SELECT site_id FROM site_completions').all().map(row => row.site_id);
      return NextResponse.json({ sites }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const user = member(db,request);
    if (!user) return NextResponse.json({ emailRequired, emailConfigured }, { status:401, headers:{'Cache-Control':'no-store'} });
    if (!user.name) return NextResponse.json({ emailRequired, emailConfigured, profileRequired: true }, { status:401, headers:{'Cache-Control':'no-store'} });
    const call = request.nextUrl.searchParams.get('chat');
    if (call !== null) {
      if (!canMessage(db,call,String(user.id))) return fail('This conversation is private to the accepted collaborators.',404);
      const messages = db.prepare(`SELECT id,sender,body,created FROM proposal_messages
        WHERE call_id=? ORDER BY id DESC LIMIT 100`).all(call).reverse();
      return NextResponse.json({ messages }, { headers: { 'Cache-Control':'no-store' } });
    }
    return NextResponse.json(snapshot(db,user), { headers: { 'Cache-Control':'no-store' } });
  } finally { db.close(); }
}

export async function POST(request: NextRequest) {
  const host = request.headers.get('host');
  if (!host || request.headers.get('origin') !== (secure(request) ? 'https://' : 'http://') + host) return fail('Invalid origin.',403);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return fail('Invalid request.');
  if (body.action === 'sendCode' || body.action === 'verifyCode') {
    if (!emailConfigured) return fail('Email verification is unavailable.',503);
    const email = clean(body.email,254).toLowerCase();
    const code = clean(body.code,16);
    const isVerify = body.action === 'verifyCode';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || (isVerify && !/^\d{6}$/.test(code))) return fail('Enter a valid email address and six-digit code.');
    const provider = await emailAuth(isVerify ? 'verify' : 'otp',email,code).catch(() => null);
    if (!provider || provider.status >= 500) return fail('Email verification is temporarily unavailable.',503);
    if (provider.status === 429) return fail('Too many attempts. Wait before trying again.',429);
    if (!provider.ok) return fail(isVerify ? 'That code is invalid or expired.' : 'Could not send the code.',400);
    if (!isVerify) return NextResponse.json({ok:true});
    const verified = await provider.json();
    const id = verified.user?.id;
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id) || !verified.user.email_confirmed_at || typeof verified.access_token !== 'string') return fail('Could not verify this account.',401);
    const verifiedEmail = clean(verified.user.email, 254).toLowerCase();
    if (verifiedEmail !== email) return fail('Could not verify this email address.', 401);
    const db = database();
    try {
      db.prepare(`INSERT INTO members (id,handle,name,neighborhood,visible,secret,zip,state,email)
        VALUES (?,?,?,?,0,?,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email`)
        .run(id,'supabase:'+id,'','','','','CA',verifiedEmail);
      const profileRequired = !db.prepare('SELECT name FROM members WHERE id=?').get(id)?.name;
      const maxAge = Math.min(3600, Number(verified.expires_in));
      if (!Number.isFinite(maxAge) || maxAge <= 0) return fail('Could not start an account session.',401);
      const response = openSession(db,request,id,maxAge,profileRequired);
      response.cookies.set('heat_shield_access',verified.access_token,{httpOnly:true,sameSite:'lax',secure:secure(request),path:'/',maxAge});
      return response;
    } finally { db.close(); }
  }
  const db = database();
  try {
    if (body.action === 'register' || body.action === 'login') {
      if (emailRequired) return fail('Sign in with a verified email code.',403);
      const handle = clean(body.handle, 40).toLowerCase();
      const password = typeof body.password === 'string' ? body.password : '';
      if (!/^[a-z0-9_.-]{3,40}$/.test(handle) || password.length < 10 || password.length > 128) return fail('Use a 3–40 character username and a password of 10–128 characters.');
      let id: string;
      if (body.action === 'register') {
        const name = clean(body.name,48);
        const place = location(body);
        if (!name || !place) return fail('Enter your name, area and five-digit ZIP code.');
        id = crypto.randomUUID();
        const salt = randomBytes(16).toString('hex');
        const secret = salt + ':' + scryptSync(password,salt,64).toString('hex');
        try { db.prepare('INSERT INTO members (id,handle,name,neighborhood,visible,secret,zip) VALUES (?,?,?,?,?,?,?)').run(id,handle,name,place.neighborhood,0,secret,place.zip); }
        catch (error) {
          if (String(error).includes('UNIQUE constraint failed')) return fail('That username is already in use.',409);
          throw error;
        }
      } else {
        const row = db.prepare('SELECT id,secret FROM members WHERE handle=?').get(handle);
        const [salt, hash] = String(row?.secret ?? '00000000000000000000000000000000:' + '0'.repeat(128)).split(':');
        const matches = timingSafeEqual(Buffer.from(hash,'hex'), scryptSync(password,salt,64));
        if (!row || !matches) return fail('Username or password is incorrect.',401);
        id = String(row.id);
      }
      return openSession(db,request,id,7 * 86400);
    }
    const user = member(db,request);
    if (!user) return fail('Sign in to Photosynthesis.',401);
    const id = String(user.id);
    if (body.action === 'logout') {
      db.prepare('DELETE FROM sessions WHERE token=?').run(digest(request.cookies.get(cookie)!.value));
      const response = NextResponse.json({ok:true});
      response.cookies.delete(cookie);
      response.cookies.delete('heat_shield_access');
      return response;
    }
    if (body.action === 'completeProfile') {
      if (!user.name) {
        const place = location(body);
        const name = clean(body.name,48);
        if (!place || !name) return fail('Enter your name, area and five-digit ZIP code.');
        db.prepare("UPDATE members SET name=?,neighborhood=?,zip=?,state=? WHERE id=? AND name=''").run(name,place.neighborhood,place.zip,place.state,id);
      }
      return NextResponse.json({ok:true});
    }
    if (!user.name) return fail('Complete your profile to continue.',403);
    if (body.action === 'completeSite') {
      if (!live) return fail('Completion reporting is available for live planting sites.',403);
      const invite = db.prepare('SELECT * FROM calls WHERE id=? AND (sender=? OR recipient=?)')
        .get(clean(body.id,64),id,id);
      if (!invite) return fail('This proposal is unavailable.',404);
      const proposalId = String(invite.proposal ?? invite.id);
      const accepted = db.prepare(`SELECT 1 FROM calls WHERE COALESCE(proposal,id)=?
        AND reply='interested' AND (sender=? OR recipient=?)`).get(proposalId,id,id);
      if (!accepted) return fail('Join an accepted planting proposal before reporting work.',403);
      const siteId = clean(body.siteId,80);
      const meeting = invite.meeting ? readMeeting(JSON.parse(String(invite.meeting))) : null;
      const siteIds: string[] = invite.site_ids ? JSON.parse(String(invite.site_ids))
        : JSON.parse(String(invite.sites)).length === 1 && meeting ? [meeting.siteId] : [];
      if (!siteIds.includes(siteId)) return fail('Choose a site in this proposal.');
      db.prepare(`INSERT INTO site_completions (site_id,proposal_id,reported_by,completed_at)
        VALUES (?,?,?,?) ON CONFLICT(site_id) DO NOTHING`).run(siteId,proposalId,id,new Date().toISOString());
      return NextResponse.json({ ok: true });
    }
    if (body.action === 'message') {
      const call = clean(body.id,64);
      const message = typeof body.message === 'string' ? body.message.trim() : '';
      if (!message || message.length > 2000) return fail('Write a message between 1 and 2,000 characters.');
      if (!canMessage(db,call,id)) return fail('This conversation is private to the accepted collaborators.',404);
      const created = new Date().toISOString();
      const entry = db.prepare('INSERT INTO proposal_messages (call_id,sender,body,created) VALUES (?,?,?,?)')
        .run(call,id,message,created);
      return NextResponse.json({ message: { id: Number(entry.lastInsertRowid), sender: id, body: message, created } }, { status:201 });
    }
    if (body.action === 'lookup') {
      const query = clean(body.query,254).normalize('NFC').toLowerCase();
      if (query.length < 2) return fail('Enter at least two characters.');
      const allowed = snapshot(db,user).nearby;
      if (query.includes('@')) {
        const match = db.prepare('SELECT id FROM members WHERE email=?').get(query);
        return NextResponse.json({ people: allowed.filter(person => person.id === match?.id) });
      }
      return NextResponse.json({ people: allowed.filter(person => String(person.name).normalize('NFC').toLowerCase().includes(query)).slice(0,15) });
    }
    const target = clean(body.recipient, 64);
    if (body.action === 'profile') {
      const name = clean(body.name,48);
      const place = location(body);
      if (!name || !place) return fail('Enter your name, area and five-digit ZIP code.');
      db.prepare('UPDATE members SET name=?,neighborhood=?,zip=?,state=?,visible=? WHERE id=?').run(name,place.neighborhood,place.zip,place.state,body.visible === true ? 1 : 0,id);
    } else if (['friend', 'send', 'forward'].includes(body.action)) {
      const eligible = snapshot(db,user).nearby.some(person => person.id === target);
      if (!eligible) return fail('Choose an opted-in collaborator in your area or an existing friend.');
      if (body.action === 'friend') {
        db.prepare('INSERT OR IGNORE INTO friends VALUES (?,?,0)').run(id,target);
      } else {
        let title: string, sites: string[], siteIds: unknown[] | null, meeting: MeetingPoint | null, note: string;
        const inviteId = crypto.randomUUID();
        let proposal = inviteId;
        if (body.action === 'forward') {
          const original = db.prepare(`SELECT * FROM calls WHERE id=? AND
            (sender=? OR (recipient=? AND reply='interested'))`).get(clean(body.id,64),id,id);
          if (!original) return fail('Accept the invitation before inviting another collaborator.',403);
          proposal = String(original.proposal ?? original.id);
          title = String(original.title);
          sites = JSON.parse(String(original.sites));
          siteIds = original.site_ids ? JSON.parse(String(original.site_ids)) : null;
          meeting = original.meeting ? readMeeting(JSON.parse(String(original.meeting))) : null;
          note = clean(body.note,500);
        } else {
          title = clean(body.title,100);
          const ids = Array.isArray(body.siteIds) ? body.siteIds : [];
          siteIds = ids;
          if (new Set(ids).size !== ids.length) return fail('Choose distinct candidate areas.');
          meeting = readMeeting(body.meeting);
          if (body.meeting != null && (!live || !meeting || !ids.includes(meeting.siteId))) return fail('Choose a valid meeting point in a shortlisted area.');
          sites = live ? await verifiedSites(ids,request,meeting) : (pilot ? pilotSites : demoSites).filter(site => ids.includes(site.id)).map(site => site.name ?? site.id);
          if (!title || !sites.length || sites.length !== ids.length) return fail('Choose candidate sites and name your planting call.');
          note = clean(body.note,500);
        }
        const recipient = db.prepare('SELECT email FROM members WHERE id=?').get(target);
        const inserted = db.prepare(`INSERT OR IGNORE INTO calls
          (id,sender,recipient,title,sites,note,reply,created,meeting,proposal,email_status,site_ids)
          SELECT ?,?,?,?,?,?,'pending',?,?,?,'pending',?
          WHERE NOT EXISTS (
            SELECT 1 FROM calls WHERE COALESCE(proposal,id)=? AND (recipient=? OR sender=?)
          )`).run(inviteId,id,target,title,JSON.stringify(sites),note,new Date().toISOString(),
            meeting ? JSON.stringify(meeting) : null,proposal,siteIds ? JSON.stringify(siteIds) : null,proposal,target,target);
        if (!inserted.changes) return fail('That person is already part of this proposal.',409);
        const emailStatus = await notifyInvite({ id: inviteId, email: String(recipient?.email ?? ''),
          sender: String(user.name), title, sites, meeting });
        db.prepare('UPDATE calls SET email_status=? WHERE id=?').run(emailStatus,inviteId);
        return NextResponse.json({ emailStatus });
      }
    } else if (body.action === 'acceptFriend') {
      db.prepare('UPDATE friends SET accepted=1 WHERE sender=? AND recipient=?').run(target,id);
    } else if (body.action === 'reply') {
      if (!['interested','declined'].includes(body.reply)) return fail('Choose a response.');
      const result = db.prepare("UPDATE calls SET reply=? WHERE id=? AND recipient=? AND reply='pending'").run(body.reply,clean(body.id,64),id);
      if (!result.changes) return fail('This invitation is no longer pending.',409);
    } else return fail('Unknown action.');
    return NextResponse.json(snapshot(db,member(db,request)!));
  } finally { db.close(); }
}

function secure(request: NextRequest) {
  return request.nextUrl.protocol === 'https:' || (process.env.HEAT_SHIELD_HTTPS === 'true');
}

function openSession(db: DatabaseSync, request: NextRequest, id: string, maxAge: number, profileRequired = false) {
  const token = randomBytes(32).toString('hex');
  db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());
  db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(digest(token),id,Date.now()+maxAge*1000);
  const response = NextResponse.json({ok:true,profileRequired});
  response.cookies.set(cookie,token,{httpOnly:true,sameSite:'lax',secure:secure(request),path:'/',maxAge});
  return response;
}

async function verifiedSites(ids: unknown[], request: NextRequest, meeting: MeetingPoint | null) {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '');
  const token = request.cookies.get('heat_shield_access')?.value;
  if (!base || !token || ids.length > 10 || !ids.every(id => typeof id === 'string' && /^[a-zA-Z0-9_:-]{1,80}$/.test(id))) return [];
  const signal = AbortSignal.timeout(10000);
  try {
    return await Promise.all(ids.map(async id => {
      const res = await fetch(base + '/api/sites/' + encodeURIComponent(String(id)), {
        headers:{Authorization:'Bearer '+token}, signal, cache:'no-store', redirect:'error',
      });
      const { data } = res.ok ? await res.json() : {};
      if (data?.id !== id || typeof data.name !== 'string') throw new Error('Unknown site');
      if (meeting?.siteId === id) {
        const geometry = data.geometry;
        const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
        if (!containsPoint(polygons, meeting.latitude, meeting.longitude)) throw new Error('Meeting point outside candidate area');
      }
      return typeof data.study_area === 'string' ? data.name + ' · ' + data.study_area : data.name;
    }));
  } catch { return []; }
}
