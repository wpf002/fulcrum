import { NextRequest, NextResponse } from "next/server";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3011";
const TOKEN_COOKIE = "fulcrum_token";
const WEEK = 60 * 60 * 24 * 7;

// Proxies auth to the API and manages the httpOnly session cookie so the JWT
// never touches client-side JS.
export async function POST(req: NextRequest, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;

  if (action === "logout") {
    const res = NextResponse.json({ ok: true });
    res.cookies.delete(TOKEN_COOKIE);
    return res;
  }

  if (action !== "login" && action !== "signup") {
    return NextResponse.json({ error: "unknown action" }, { status: 404 });
  }

  const body = await req.json();
  const upstream = await fetch(`${API}/v1/auth/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await upstream.json();
  if (!upstream.ok) return NextResponse.json(data, { status: upstream.status });

  const res = NextResponse.json({ ok: true, agent: data.agent });
  res.cookies.set(TOKEN_COOKIE, data.token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: WEEK,
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}
