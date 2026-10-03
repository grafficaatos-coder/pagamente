import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const host = (request.headers.get('host') || '').toLowerCase();
  const pathname = request.nextUrl.pathname;

  const isOfficialHost = host === 'jpsistemadecobranca.com.br';
  const isWwwHost = host === 'www.jpsistemadecobranca.com.br';
  const isVercelHost =
    host === 'pagamente.vercel.app' ||
    host === 'pagamente-iucw.vercel.app' ||
    host.endsWith('.vercel.app');

  if ((isVercelHost || isWwwHost) && !pathname.startsWith('/api/')) {
    const url = request.nextUrl.clone();
    url.protocol = 'https:';
    url.host = 'jpsistemadecobranca.com.br';
    return NextResponse.redirect(url, 308);
  }

  // O domínio principal deve mostrar o site de apresentação,
  // mantendo a URL limpa em jpsistemadecobranca.com.br.
  if (isOfficialHost && pathname === '/') {
    const url = request.nextUrl.clone();
    url.pathname = '/site';
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
