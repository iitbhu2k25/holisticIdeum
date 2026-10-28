'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, LogIn, LogOut, Upload } from 'lucide-react';
import { useAuth } from '../shared/auth/useAuth';
import { logout } from '../shared/auth/authClient';

export default function UserMenu({ onNavigate }: { onNavigate?: () => void }) {
  const { user, ready } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (!ready) return <div className="h-8 w-20" />;

  if (!user) {
    return (
      <Link
        href="/login"
        onClick={onNavigate}
        className="inline-flex items-center gap-1.5 rounded-full bg-sky-700 px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-sky-800"
      >
        <LogIn className="h-4 w-4" /> Sign in
      </Link>
    );
  }

  const initial = (user.full_name || user.email).charAt(0).toUpperCase();
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white py-1 pl-1 pr-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-700 text-xs font-bold text-white">{initial}</span>
        <span className="max-w-[140px] truncate">{user.full_name || user.email}</span>
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-[1200] mt-2 w-60 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
          <div className="border-b border-slate-100 px-3 py-2">
            <p className="truncate text-sm font-semibold text-slate-800">{user.email}</p>
            <p className="text-xs capitalize text-slate-500">{user.role}</p>
          </div>
          {user.role === 'superuser' ? (
            <Link
              href="/admin/datasets"
              onClick={() => { setOpen(false); onNavigate?.(); }}
              className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              <Upload className="h-4 w-4" /> Data upload
            </Link>
          ) : null}
          <button
            type="button"
            onClick={() => logout()}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
