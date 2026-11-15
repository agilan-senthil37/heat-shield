import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { NextRequest, NextResponse } from 'next/server';
import { demoSites, live, pilot, pilotSites } from '../../data';

import { emailAuth, emailConfigured, emailRequired } from './auth';

export const runtime = 'nodejs';

function database() {
  const db = new DatabaseSync(process.env.HEAT_SHIELD_DB || '.heat-shield.sqlite');
  db.exec(`
    PRAGMA busy_timeout=3000;
    CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, handle TEXT UNIQUE, name TEXT, neighborhood TEXT, visible INTEGER, secret TEXT);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, member TEXT, expires INTEGER);
    CREATE TABLE IF NOT EXISTS calls (id TEXT PRIMARY KEY, sender TEXT, recipient TEXT, title TEXT, sites TEXT, note TEXT, reply TEXT, created TEXT);
    CREATE TABLE IF NOT EXISTS friends (sender TEXT, recipient TEXT, accepted INTEGER, PRIMARY KEY(sender,recipient));
  `);
  if (!db.prepare("PRAGMA table_info(members)").all().some(col => col.name === 'zip')) {
    db.exec("ALTER TABLE members ADD COLUMN zip TEXT NOT NULL DEFAULT ''");
  }
  return db;
}
const cookie = 'heat_shield_session';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const location = (body: Record<string, unknown>) => {
  const neighborhood = clean(body.neighborhood, 80).normalize('NFC').replace(/\s+/g,' ');
  const zip = clean(body.zip, 16);
  return neighborhood.length >= 2 && /^\d{5}$/.test(zip) ? { neighborhood, zip } : null;
};
const clean = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0,max) : '';
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });
function member(db: DatabaseSync, request: NextRequest) {
  const token = request.cookies.get(cookie)?.value;
  if (!token) return undefined;
  return db.prepare(`SELECT m.id,m.name,m.neighborhood,m.zip,m.visible FROM sessions s JOIN members m ON m.id=s.member WHERE s.token=? AND s.expires>? AND (?=0 OR m.handle LIKE 'supabase:%')`).get(digest(token),Date.now(),Number(emailRequired));
}
function snapshot(db: DatabaseSync, user: Record<string, unknown>) {
  const id = String(user.id);
  return {
    user,
    nearby: db.prepare(`SELECT m.id,m.name,m.neighborhood,
      EXISTS(SELECT 1 FROM friends f WHERE f.accepted=1 AND ((f.sender=m.id AND f.recipient=?) OR (f.sender=? AND f.recipient=m.id))) AS friend
      FROM members m WHERE m.id<>? AND m.visible=1 AND ((m.zip<>'' AND m.zip=?) OR EXISTS(
        SELECT 1 FROM friends f WHERE f.accepted=1 AND ((f.sender=m.id AND f.recipient=?) OR (f.sender=? AND f.recipient=m.id))
      )) ORDER BY m.name`).all(id,id,id,String(user.zip),id,id),
    requests: db.prepare('SELECT f.sender AS id,m.name FROM friends f JOIN members m ON m.id=f.sender WHERE f.recipient=? AND f.accepted=0').all(id),
    calls: db.prepare(`SELECT c.*, s.name AS senderName, r.name AS recipientName FROM calls c JOIN members s ON s.id=c.sender JOIN members r ON r.id=c.recipient
      WHERE c.sender=? OR c.recipient=? ORDER BY c.created DESC`).all(id,id).map(row => ({...row, sites: JSON.parse(String(row.sites))})),
  };
}

export function GET(request: NextRequest) {
  const db = database();
  try {
    const user = member(db,request);
    if (!user) return NextResponse.json({ emailRequired, emailConfigured }, { status:401, headers:{'Cache-Control':'no-store'} });
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
    const place = location(body);
    const name = clean(body.name,48);
    if (isVerify && (!place || !name)) return fail('Enter your name, area and five-digit ZIP code.');
    const provider = await emailAuth(isVerify ? 'verify' : 'otp',email,code).catch(() => null);
    if (!provider || provider.status >= 500) return fail('Email verification is temporarily unavailable.',503);
    if (provider.status === 429) return fail('Too many attempts. Wait before trying again.',429);
    if (!provider.ok) return fail(isVerify ? 'That code is invalid or expired.' : 'Could not send the code.',400);
    if (!isVerify) return NextResponse.json({ok:true});
    const verified = await provider.json();
    const id = verified.user?.id;
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id) || !verified.user.email_confirmed_at || typeof verified.access_token !== 'string') return fail('Could not verify this account.',401);
    const db = database();
    try {
      db.prepare('INSERT OR IGNORE INTO members (id,handle,name,neighborhood,visible,secret,zip) VALUES (?,?,?,?,0,?,?)').run(id,'supabase:'+id,name,place!.neighborhood,'',place!.zip);
      const maxAge = Math.min(3600, Number(verified.expires_in));
      if (!Number.isFinite(maxAge) || maxAge <= 0) return fail('Could not start an account session.',401);
      const response = openSession(db,request,id,maxAge);
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
    const target = clean(body.recipient, 64);
    if (body.action === 'profile') {
      const name = clean(body.name,48);
      const place = location(body);
      if (!name || !place) return fail('Enter your name, area and five-digit ZIP code.');
      db.prepare('UPDATE members SET name=?,neighborhood=?,zip=?,visible=? WHERE id=?').run(name,place.neighborhood,place.zip,body.visible === true ? 1 : 0,id);
    } else if (body.action === 'friend' || body.action === 'send') {
      const eligible = db.prepare('SELECT id FROM members WHERE id=? AND id<>? AND visible=1 AND ((length(zip)>0 AND zip=?) OR EXISTS(SELECT 1 FROM friends WHERE accepted=1 AND ((sender=? AND recipient=?) OR (sender=? AND recipient=?))))').get(target,id,String(user.zip),target,id,id,target);
      if (!eligible) return fail('Choose an opted-in collaborator in your ZIP code or an existing friend.');
      if (body.action === 'friend') {
        db.prepare('INSERT OR IGNORE INTO friends VALUES (?,?,0)').run(id,target);
      } else {
        const title = clean(body.title,100);
        const ids = Array.isArray(body.siteIds) ? body.siteIds : [];
        if (new Set(ids).size !== ids.length) return fail('Choose distinct candidate areas.');
        const sites = live ? await verifiedSites(ids, request) : (pilot ? pilotSites : demoSites).filter(site => ids.includes(site.id)).map(site => site.name);
        if (!title || !sites.length || sites.length !== ids.length) return fail('Choose candidate sites and name your planting call.');
        db.prepare('INSERT INTO calls VALUES (?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),id,target,title,JSON.stringify(sites),clean(body.note,500),'pending',new Date().toISOString());
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

function openSession(db: DatabaseSync, request: NextRequest, id: string, maxAge: number) {
  const token = randomBytes(32).toString('hex');
  db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());
  db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(digest(token),id,Date.now()+maxAge*1000);
  const response = NextResponse.json({ok:true});
  response.cookies.set(cookie,token,{httpOnly:true,sameSite:'lax',secure:secure(request),path:'/',maxAge});
  return response;
}

async function verifiedSites(ids: unknown[], request: NextRequest) {
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
      return typeof data.study_area === 'string' ? data.name + ' · ' + data.study_area : data.name;
    }));
  } catch { return []; }
}
