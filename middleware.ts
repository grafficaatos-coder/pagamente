import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const host = (request.headers.get('host') || '').toLowerCase();
  const pathname = request.nextUrl.pathname;
  const params = request.nextUrl.searchParams;

  const isRecoveryRequest =
    pathname === '/' &&
    (
      params.get('type') === 'recovery' ||
      params.has('token_hash') ||
      params.has('code')
    );

  if (isRecoveryRequest) {
    const agendaUrl = new URL('https://agenda-pro-iucw.vercel.app/');
    request.nextUrl.searchParams.forEach((value, key) => agendaUrl.searchParams.set(key, value));
    return NextResponse.redirect(agendaUrl, 307);
  }

  const isWwwHost = host === 'www.jpsistemadecobranca.com.br';
  const isVercelHost = host.endsWith('.vercel.app');

  if ((isVercelHost || isWwwHost) && !pathname.startsWith('/api/')) {
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
