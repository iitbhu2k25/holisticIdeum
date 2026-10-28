"use client";

import { useEffect, useState } from "react";
import { AuthUser, getUser, onAuthChange } from "./authClient";

/** Current user from local storage; re-renders on login / logout in any tab. */
export function useAuth(): { user: AuthUser | null; ready: boolean } {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sync = () => setUser(getUser());
    sync();
    setReady(true);
    return onAuthChange(sync);
  }, []);

  return { user, ready };
}
