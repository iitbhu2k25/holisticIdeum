"use client";

import { useCallback, useRef, useState } from "react";
import { Loader2, Lock, X } from "lucide-react";
import { getUser, login } from "./authClient";

/**
 * In-page sign-in, so work on an open page (e.g. an unsaved Split session) is not lost.
 *
 *   const { requireLogin, dialog } = useLoginPrompt();
 *   if (await requireLogin("Sign in to save this session")) save();
 *   ...render {dialog}
 */
export function useLoginPrompt() {
  const [reason, setReason] = useState<string | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const requireLogin = useCallback((why: string): Promise<boolean> => {
    if (getUser()) return Promise.resolve(true);
    setReason(why);
    return new Promise((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (ok: boolean) => {
    setReason(null);
    resolver.current?.(ok);
    resolver.current = null;
  };

  const dialog = reason ? <LoginDialog reason={reason} onDone={close} /> : null;
  return { requireLogin, dialog };
}

function LoginDialog({ reason, onDone }: { reason: string; onDone: (ok: boolean) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(email, password);
      onDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[5000] flex items-center justify-center bg-slate-900/50 p-4" onClick={() => onDone(false)}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-100 text-sky-700"><Lock className="h-5 w-5" /></span>
            <div>
              <p className="font-bold text-slate-900">Sign in</p>
              <p className="text-xs text-slate-500">{reason}</p>
            </div>
          </div>
          <button type="button" onClick={() => onDone(false)} className="rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <input
          type="email"
          required
          autoFocus
          autoComplete="username"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100"
        />
        <input
          type="password"
          required
          autoComplete="current-password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-100"
        />
        {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        <button
          type="submit"
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-sky-700 py-2.5 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Sign in
        </button>
        <p className="text-center text-[11px] text-slate-400">Accounts are issued by the administrator.</p>
      </form>
    </div>
  );
}
