import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Only the data-upload pages need a login, and only a superuser one (signed in at /admin/login).
// Holistic and Split are open and ask a user to sign in when a session is saved.
// The cookie only steers navigation — the backend checks the token.
const SUPERUSER_ONLY = ['/admin']
const ADMIN_LOGIN = '/admin/login'

const matches = (path: string, prefixes: string[]) =>
  prefixes.some((p) => path === p || path.startsWith(`${p}/`))

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  const role = request.cookies.get('dss_role')?.value

  // the administrator sign-in page itself is open; an already signed-in superuser goes straight in
  if (pathname === ADMIN_LOGIN) {
    if (role !== 'superuser') return NextResponse.next()
    const url = request.nextUrl.clone()
    url.pathname = '/admin/datasets'
    url.search = ''
    return NextResponse.redirect(url)
  }

  if (matches(pathname, SUPERUSER_ONLY) && role !== 'superuser') {
    const url = request.nextUrl.clone()
    url.pathname = ADMIN_LOGIN
    url.search = `?next=${encodeURIComponent(pathname + search)}`
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
}
