import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const host = (request.headers.get('host') || '').toLowerCase();
  const isVercelHost =
    host === 'pagamente.vercel.app' ||
    host === 'pagamente-iucw.vercel.app' ||
    host.endsWith('.vercel.app');

  if (isVercelHost && !request.nextUrl.pathname.startsWith('/api/')) {
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
