import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { setTimeout } from 'node:timers/promises';

const { HEAT_SHIELD_DB, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, RENDER_EXTERNAL_URL } = process.env;
const publicUrl = process.env.HEAT_SHIELD_PUBLIC_URL || RENDER_EXTERNAL_URL;
if (!HEAT_SHIELD_DB || !isAbsolute(HEAT_SHIELD_DB) || !SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !publicUrl) {
  throw new Error('Set an absolute HEAT_SHIELD_DB path on a persistent volume, Supabase settings, and HEAT_SHIELD_PUBLIC_URL.');
}
if (new URL(publicUrl).protocol !== 'https:') {
  throw new Error('HEAT_SHIELD_PUBLIC_URL must use HTTPS.');
}
await mkdir(dirname(HEAT_SHIELD_DB), { recursive: true });

const backendPort = '4185';
const backendUrl = 'http://127.0.0.1:' + backendPort;
const children = [];
let stopping = false;

function stop(exitCode) {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;
  for (const child of children) child.kill('SIGTERM');
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

function start(cwd, host, port, settings) {
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', host, '-p', port], {
    cwd, env: { ...process.env, ...settings }, stdio: 'inherit',
  });
  children.push(child);
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', () => stop(1));
  return child;
}

start('.', '127.0.0.1', backendPort, { DATA_MODE: 'supabase' });
try {
  let ready = false;
  for (let attempt = 0; attempt < 60 && !stopping; attempt++) {
    const response = await fetch(backendUrl + '/api/health', { signal: AbortSignal.timeout(1500) }).catch(() => null);
    if (response?.ok) {
      await response.body?.cancel();
      ready = true;
      break;
    }
    await setTimeout(500);
  }
  if (!ready && !stopping) throw new Error('HeatShield API did not start.');
  if (!stopping) {
    const frontend = start('frontend', '0.0.0.0', process.env.PORT || '10000', {
      NEXT_PUBLIC_DATA_MODE: 'live',
      NEXT_PUBLIC_API_BASE_URL: backendUrl,
      HEAT_SHIELD_HTTPS: 'true',
      HEAT_SHIELD_PUBLIC_URL: publicUrl,
    });
    await once(frontend, 'exit');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  stop(1);
}
