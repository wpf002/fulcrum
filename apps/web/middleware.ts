import { NextRequest, NextResponse } from "next/server";

const TOKEN_COOKIE = "fulcrum_token";

// Gate the dashboard behind a session. Unauthenticated → /login; already
// logged in and visiting /login → dashboard.
export function middleware(req: NextRequest) {
  const token = req.cookies.get(TOKEN_COOKIE)?.value;
  const { pathname } = req.nextUrl;
  const isLogin = pathname === "/login";

  if (!token && !isLogin) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  if (token && isLogin) {
    return NextResponse.redirect(new URL("/", req.url));
  }
  return NextResponse.next();
}

// Skip Next internals + all route handlers (they enforce their own auth).
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api).*)"],
};
