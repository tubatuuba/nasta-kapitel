import { NextResponse } from "next/server";

// Edge runtime: verify the cookie shape only. The API routes re-verify the
// signature in Node, where crypto is available.
export function middleware(request) {
  const { pathname } = request.nextUrl;
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/login") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname === "/icon.svg"
  ) {
    return NextResponse.next();
  }
  const token = request.cookies.get("nk_auth")?.value;
  if (token && /^\d+\.[a-f0-9]{32}$/.test(token)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"]
};
