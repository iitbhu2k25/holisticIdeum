// Token storage + an authenticated fetch that refreshes the access token once on 401.
import { BACKEND_URL } from "../config";

export type AuthUser = {
  id: number;
  email: string;
  full_name: string | null;
  role: "superuser" | "user";
};

type StoredAuth = {
  access_token: string;
  refresh_token: string;
  user: AuthUser;
};

const STORAGE_KEY = "dss_auth";
// Read by middleware.ts to guard pages; the backend still checks the token on every call.
const ROLE_COOKIE = "dss_role";
const AUTH_EVENT = "dss-auth-change";

function read(): StoredAuth | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredAuth) : null;
  } catch {
    return null;
  }
}

function write(auth: StoredAuth | null) {
  if (auth) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
    document.cookie = `${ROLE_COOKIE}=${auth.user.role}; path=/; max-age=${60 * 60 * 24}; SameSite=Lax`;
  } else {
    localStorage.removeItem(STORAGE_KEY);
    document.cookie = `${ROLE_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
  }
  window.dispatchEvent(new Event(AUTH_EVENT));
}

export function getUser(): AuthUser | null {
  return read()?.user ?? null;
}

export function getAccessToken(): string | null {
  return read()?.access_token ?? null;
}

export function onAuthChange(listener: () => void): () => void {
  window.addEventListener(AUTH_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(AUTH_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

export async function errorMessage(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => null);
  return (data && (data.detail || data.error)) || `${fallback} (${res.status})`;
}

/** portal "admin" is the superuser page (/admin/login); "user" is everyone else. The backend refuses a mismatch. */
export async function login(email: string, password: string, portal: "user" | "admin" = "user"): Promise<AuthUser> {
  const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, portal }),
  });
  if (!res.ok) throw new Error(await errorMessage(res, "Login failed"));
  const data = await res.json();
  write({ access_token: data.access_token, refresh_token: data.refresh_token, user: data.user });
  return data.user;
}

export function logout(redirect = true) {
  write(null);
  if (redirect) window.location.replace("/homepage");
}

let refreshing: Promise<boolean> | null = null;

async function refresh(): Promise<boolean> {
  const current = read();
  if (!current?.refresh_token) return false;
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: current.refresh_token }),
      });
      if (!res.ok) return false;
      const data = await res.json();
      write({ access_token: data.access_token, refresh_token: data.refresh_token, user: data.user });
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

function withAuth(init: RequestInit = {}): RequestInit {
  const token = getAccessToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return { ...init, headers };
}

/**
 * fetch() against the backend with the bearer token when signed in; a path starting with "/" is
 * joined to BACKEND_URL. An expired session is refreshed once; if that fails the user is signed out
 * locally and the 401 is returned to the caller (public pages keep working anonymously).
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = path.startsWith("http") ? path : `${BACKEND_URL}${path}`;
  const hadToken = !!getAccessToken();
  let res = await fetch(url, withAuth(init));
  if (res.status === 401 && hadToken) {
    if (await refresh()) res = await fetch(url, withAuth(init));
    else logout(false);
  }
  return res;
}

/** XHR upload so the page can show progress for files up to 1 GB. */
export function apiUpload(
  path: string,
  form: FormData,
  onProgress: (fraction: number) => void,
): { promise: Promise<{ status: number; body: any }>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const send = () =>
    new Promise<{ status: number; body: any }>((resolve, reject) => {
      xhr.open("POST", `${BACKEND_URL}${path}`);
      const token = getAccessToken();
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      xhr.onload = () => {
        let body: any = null;
        try { body = JSON.parse(xhr.responseText); } catch { body = { detail: xhr.responseText }; }
        resolve({ status: xhr.status, body });
      };
      xhr.onerror = () => reject(new Error("Network error during upload"));
      xhr.onabort = () => reject(new Error("Upload cancelled"));
      xhr.send(form);
    });
  const promise = (async () => {
    // make sure the (short-lived) access token is fresh before a long upload starts
    await apiFetch("/api/auth/me");
    return send();
  })();
  return { promise, abort: () => xhr.abort() };
}
