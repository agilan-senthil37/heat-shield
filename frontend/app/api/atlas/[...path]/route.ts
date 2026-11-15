import { NextRequest } from 'next/server';

async function forward(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const path = (await context.params).path.join('/');
  const writing = request.method === 'POST';
  const allowed = writing ? /^(explain|proposals)$/ : /^(sites|proposals\/[\w-]+\/pdf)$/;
  if (!allowed.test(path)) return new Response(null, {status:404});
  if (writing && request.headers.get('origin') !== (process.env.HEAT_SHIELD_HTTPS === 'true' ? 'https:' : request.nextUrl.protocol) + '//' + request.headers.get('host')) return new Response(null,{status:403});
  const base = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '');
  if (!base) return new Response(null, {status:503});
  const token = request.cookies.get('heat_shield_access')?.value;
  if (path.startsWith('proposals') && !token) return new Response(null,{status:401});
  const headers = new Headers();
  if (token) headers.set('Authorization','Bearer '+token);
  if (writing) headers.set('Content-Type','application/json');
  try {
    const response = await fetch(base+'/api/'+path+request.nextUrl.search, {
      method:request.method, headers, body:writing ? await request.text() : undefined,
      cache:'no-store', signal:AbortSignal.timeout(15000), redirect:'error',
    });
    return new Response(response.body, {status:response.status, headers:{
      'Content-Type':response.headers.get('content-type') || 'application/octet-stream',
      'Cache-Control':'no-store',
    }});
  } catch { return new Response(null, {status:502}); }
}
export { forward as GET, forward as POST };
