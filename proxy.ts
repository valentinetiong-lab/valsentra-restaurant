import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE_NAME, ROLE_COOKIE_NAME } from "@/app/lib/security/auth";

function roleAllowed(request: NextRequest, allowedRoles: string[]) {
  const hasSession = Boolean(request.cookies.get(AUTH_COOKIE_NAME)?.value);
  const role = request.cookies.get(ROLE_COOKIE_NAME)?.value;
  const internalKey = request.headers.get("x-valsentra-internal-key");
  const expectedInternalKey = process.env.VALSENTRA_INTERNAL_API_KEY;

  return (
    (hasSession && role !== undefined && allowedRoles.includes(role)) ||
    (allowedRoles.includes("internal") &&
      Boolean(expectedInternalKey) &&
      internalKey === expectedInternalKey)
  );
}

function redirectToLogin(request: NextRequest) {
  const url = request.nextUrl.clone();
  const login = new URL("/login", request.url);
  login.searchParams.set("next", `${url.pathname}${url.search}`);
  return NextResponse.redirect(login);
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/restaurant/owner") && !roleAllowed(request, ["owner", "manager", "admin"])) {
    return redirectToLogin(request);
  }

  if (pathname === "/restaurant" && !roleAllowed(request, ["staff", "manager", "owner", "admin"])) {
    return redirectToLogin(request);
  }

  if (
    (pathname === "/api/operational/jobs" || pathname === "/api/operational/health") &&
    request.method === "GET" &&
    !roleAllowed(request, ["owner", "manager", "admin", "internal"])
  ) {
    return NextResponse.json(
      { ok: false, error: "Operational job visibility requires owner, manager, admin, or internal access." },
      { status: 401 }
    );
  }

  if (
    pathname.startsWith("/api/operational") &&
    !((pathname === "/api/operational/jobs" || pathname === "/api/operational/health") && request.method === "GET") &&
    !roleAllowed(request, ["internal"])
  ) {
    return NextResponse.json(
      { ok: false, error: "Operational system route requires admin or internal access." },
      { status: 401 }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/restaurant", "/restaurant/owner/:path*", "/api/operational/:path*"],
};
