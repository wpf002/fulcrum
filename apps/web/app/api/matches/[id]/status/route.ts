import { NextRequest, NextResponse } from "next/server";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3011";
const TOKEN_COOKIE = "fulcrum_token";

// Same-origin proxy so a client component can act on a match without the
// httpOnly JWT ever reaching the browser: read the cookie here, forward to the
// API with a Bearer token.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const token = req.cookies.get(TOKEN_COOKIE)?.value;
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const upstream = await fetch(`${API}/v1/matches/${encodeURIComponent(id)}/status`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await upstream.json().catch(() => ({}));
  return NextResponse.json(data, { status: upstream.status });
}
