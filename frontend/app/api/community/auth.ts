const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
const key = process.env.SUPABASE_PUBLISHABLE_KEY;
export const emailRequired = process.env.NEXT_PUBLIC_DATA_MODE === 'live' || Boolean(url && key);
export const emailConfigured = Boolean(url && key);

export async function emailAuth(action: 'otp' | 'verify', email: string, token?: string) {
  return fetch(url + '/auth/v1/' + action, {
    method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(10000),
    headers: { apikey: key!, 'Content-Type': 'application/json' },
    body: JSON.stringify(action === 'otp' ? { email, create_user: true } : { email, token, type: 'email' }),
  });
}
