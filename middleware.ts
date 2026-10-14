import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const host = (request.headers.get('host') || '').toLowerCase();
  const pathname = request.nextUrl.pathname;
  const params = request.nextUrl.searchParams;

  const isAgendaHost =
    host === 'agenda-pro-iucw.vercel.app' ||
    host.startsWith('agenda-nails-') && host.endsWith('.vercel.app');

  const isRecoveryRequest =
    pathname === '/' &&
    (
      params.get('type') === 'recovery' ||
      params.has('token_hash') ||
      params.has('code')
    );

  if (isRecoveryRequest && !isAgendaHost) {
    const agendaUrl = new URL('https://agenda-pro-iucw.vercel.app/');
    request.nextUrl.searchParams.forEach((value, key) => agendaUrl.searchParams.set(key, value));
    return NextResponse.redirect(agendaUrl, 307);
  }

  const isWwwHost = host === 'www.jpsistemadecobranca.com.br';
  const isVercelHost = host.endsWith('.vercel.app');

  // Agenda Pro and the billing platform share a repository, but must not
  // redirect their public domains to one another.
  if (((isVercelHost && !isAgendaHost) || isWwwHost) && !pathname.startsWith('/api/')) {
    const url = request.nextUrl.clone();
    url.protocol = 'https:';
    url.host = 'jpsistemadecobranca.com.br';
    return NextResponse.redirect(url, 308);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
