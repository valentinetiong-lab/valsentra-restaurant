"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/app/lib/supabase";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [locationName, setLocationName] = useState("Primary Location");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setLoading(true);

    const result = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          role: "owner",
        },
      },
    });
    const accessToken = result.data.session?.access_token;

    if (result.error) {
      setLoading(false);
      setError(result.error.message);
      return;
    }

    if (!accessToken) {
      setLoading(false);
      setNotice("Account created. Confirm your email, then sign in to finish organization setup.");
      return;
    }

    const bootstrap = await fetch("/api/auth/bootstrap-owner", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accessToken,
        organizationName,
        locationName,
      }),
    });
    const bootstrapData = await bootstrap.json().catch(() => ({}));

    if (!bootstrap.ok) {
      setLoading(false);
      setError(bootstrapData.error ?? "Organization setup failed.");
      return;
    }

    const session = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken }),
    });
    const sessionData = await session.json().catch(() => ({}));

    if (!session.ok) {
      setLoading(false);
      setError(sessionData.error ?? "Session could not be established.");
      return;
    }

    router.replace("/restaurant/owner");
  }

  return (
    <main className="min-h-screen bg-[#f7f5f0] px-6 py-12 text-neutral-950">
      <section className="mx-auto max-w-md rounded-[28px] border border-neutral-200 bg-white p-7 shadow-[0_18px_60px_rgba(15,23,42,0.08)]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
          Valsentra Owner Setup
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">
          Create organization
        </h1>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <input
            value={organizationName}
            onChange={(event) => setOrganizationName(event.target.value)}
            required
            placeholder="Organization name"
            className="w-full rounded-2xl border border-neutral-200 px-4 py-3 text-sm outline-none focus:border-neutral-500"
          />
          <input
            value={locationName}
            onChange={(event) => setLocationName(event.target.value)}
            required
            placeholder="Default location"
            className="w-full rounded-2xl border border-neutral-200 px-4 py-3 text-sm outline-none focus:border-neutral-500"
          />
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            required
            placeholder="Owner email"
            className="w-full rounded-2xl border border-neutral-200 px-4 py-3 text-sm outline-none focus:border-neutral-500"
          />
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            required
            minLength={8}
            placeholder="Password"
            className="w-full rounded-2xl border border-neutral-200 px-4 py-3 text-sm outline-none focus:border-neutral-500"
          />
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          {notice ? <p className="text-sm text-amber-700">{notice}</p> : null}
          <button
            disabled={loading}
            className="w-full rounded-2xl bg-neutral-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {loading ? "Creating..." : "Create owner account"}
          </button>
        </form>
        <p className="mt-5 text-center text-sm text-neutral-500">
          Already have access?{" "}
          <Link href="/login" className="font-semibold text-neutral-950">
            Sign in
          </Link>
        </p>
      </section>
    </main>
  );
}
