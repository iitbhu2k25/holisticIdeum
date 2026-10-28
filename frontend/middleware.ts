import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Only the data-upload pages need a login; Holistic and Split are open and ask for a
// login when a session is saved. The cookie only steers navigation — the backend checks the token.
const PROTECTED = ['/admin']
const SUPERUSER_ONLY = ['/admin']

const matches = (path: string, prefixes: string[]) =>
  prefixes.some((p) => path === p || path.startsWith(`${p}/`))

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  const role = request.cookies.get('dss_role')?.value

  if (matches(pathname, PROTECTED) && !role) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = `?next=${encodeURIComponent(pathname + search)}`
    return NextResponse.redirect(url)
  }

  if (matches(pathname, SUPERUSER_ONLY) && role !== 'superuser') {
    const url = request.nextUrl.clone()
    url.pathname = '/homepage'
    url.search = ''
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
}
