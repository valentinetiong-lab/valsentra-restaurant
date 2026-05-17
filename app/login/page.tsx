"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/app/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const result = await supabase.auth.signInWithPassword({ email, password });
    const accessToken = result.data.session?.access_token;

    if (result.error || !accessToken) {
      setLoading(false);
      setError(result.error?.message ?? "Unable to sign in.");
      return;
    }

    const sessionResult = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken }),
    });
    const sessionData = await sessionResult.json().catch(() => ({}));

    if (!sessionResult.ok) {
      setLoading(false);
      setError(sessionData.error ?? "Session could not be established.");
      return;
    }

    const next = new URLSearchParams(window.location.search).get("next");
    router.replace(next ?? sessionData.redirectTo ?? "/restaurant");
  }

  return (
    <main className="min-h-screen bg-[#f7f5f0] px-6 py-12 text-neutral-950">
      <section className="mx-auto max-w-sm rounded-[28px] border border-neutral-200 bg-white p-7 shadow-[0_18px_60px_rgba(15,23,42,0.08)]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
          Valsentra Access
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">
          Sign in to continue
        </h1>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            required
            placeholder="Email"
            className="w-full rounded-2xl border border-neutral-200 px-4 py-3 text-sm outline-none focus:border-neutral-500"
          />
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            required
            placeholder="Password"
            className="w-full rounded-2xl border border-neutral-200 px-4 py-3 text-sm outline-none focus:border-neutral-500"
          />
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <button
            disabled={loading}
            className="w-full rounded-2xl bg-neutral-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
        <p className="mt-5 text-center text-sm text-neutral-500">
          New owner?{" "}
          <Link href="/signup" className="font-semibold text-neutral-950">
            Create organization
          </Link>
        </p>
      </section>
    </main>
  );
}
