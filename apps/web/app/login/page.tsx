"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Login() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [zips, setZips] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const body =
      mode === "signup"
        ? { name, email, password, territories: { zips: zips.split(",").map((z) => z.trim()).filter(Boolean) } }
        : { email, password };
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(typeof d.error === "string" ? d.error : "Check your details and try again.");
        setBusy(false);
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Network error — is the API running?");
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          Fulcrum<span className="brand-dot">.</span>
        </div>
        <div className="auth-sub">Seller intelligence for real estate agents</div>

        <form onSubmit={submit} className="auth-form">
          {mode === "signup" && (
            <label className="auth-field">
              <span>Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
          )}
          <label className="auth-field">
            <span>Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className="auth-field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={mode === "signup" ? 8 : 1}
            />
          </label>
          {mode === "signup" && (
            <label className="auth-field">
              <span>Territory zips (comma-separated)</span>
              <input value={zips} onChange={(e) => setZips(e.target.value)} placeholder="78704, 78745" />
            </label>
          )}

          {error && <div className="auth-error">{error}</div>}

          <button className="auth-btn" disabled={busy}>
            {busy ? "…" : mode === "login" ? "Log in" : "Create account"}
          </button>
        </form>

        <button
          className="auth-toggle"
          onClick={() => {
            setMode(mode === "login" ? "signup" : "login");
            setError("");
          }}
        >
          {mode === "login" ? "Need an account? Sign up" : "Have an account? Log in"}
        </button>

        {mode === "login" && (
          <div className="auth-demo">demo: demo@fulcrum.dev / fulcrum-demo</div>
        )}
      </div>
    </div>
  );
}
