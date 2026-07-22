import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3011";
export const TOKEN_COOKIE = "fulcrum_token";

export async function getToken(): Promise<string | null> {
  return (await cookies()).get(TOKEN_COOKIE)?.value ?? null;
}

/** Authenticated GET from a server component. Redirects to /login on 401. */
export async function apiGet<T>(path: string): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${API}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    cache: "no-store",
  });
  if (res.status === 401) redirect("/login");
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export interface Me {
  id: string;
  name: string;
  email: string;
  territories: { zips?: string[] };
  subscriptionTier: string;
}

export function getMe(): Promise<Me> {
  return apiGet<Me>("/v1/me");
}
