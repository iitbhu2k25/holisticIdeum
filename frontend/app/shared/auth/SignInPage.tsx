"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Lock, Mail, ShieldCheck, Waves } from "lucide-react";
import { login } from "./authClient";

type Props = {
  portal: "user" | "admin";
  title: string;
  subtitle: string;
  defaultNext: string;
  note: string;
};

function SignInForm({ portal, title, subtitle, defaultNext, note }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(email, password, portal);
      const next = params.get("next");
      const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : null;
      router.replace(safeNext ?? defaultNext);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[calc(100vh-220px)] items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className={`mb-3 flex h-12 w-12 items-center justify-center rounded-xl text-white shadow ${portal === "admin" ? "bg-slate-800" : "bg-sky-700"}`}>
            {portal === "admin" ? <ShieldCheck className="h-6 w-6" /> : <Waves className="h-6 w-6" />}
          </div>
          <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
        </div>

        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Email</span>
            <div className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 focus-within:border-sky-600 focus-within:ring-2 focus-within:ring-sky-100">
              <Mail className="h-4 w-4 text-slate-400" />
              <input
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full py-2.5 text-sm outline-none"
                placeholder="name@example.com"
              />
            </div>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Password</span>
            <div className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 focus-within:border-sky-600 focus-within:ring-2 focus-within:ring-sky-100">
              <Lock className="h-4 w-4 text-slate-400" />
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full py-2.5 text-sm outline-none"
              />
            </div>
          </label>

          {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-sky-700 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-800 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Sign in
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-slate-500">
          {note}
        </p>
      </div>
    </div>
  );
}

/** Sign-in page shared by /login (users) and /admin/login (superusers). */
export default function SignInPage(props: Props) {
  return (
    <Suspense>
      <SignInForm {...props} />
    </Suspense>
  );
}
