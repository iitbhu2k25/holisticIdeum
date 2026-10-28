"use client";

import { ReactNode, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  CheckCircle2, CloudOff, Expand, Home, Layers, Loader2, LogIn, LogOut, Pentagon, Plus, Save, ScanSearch, Square, Trash2,
} from "lucide-react";
import SessionHistory from "../../shared/components/SessionHistory";
import { useAuth } from "../../shared/auth/useAuth";
import { logout } from "../../shared/auth/authClient";
import type { DrawMode } from "../../shared/map/DrawLayer";
import type { MapControls } from "../../shared/map/MapShell";

export type SaveState = "idle" | "unsaved" | "saving" | "saved" | "error";

const BTN = "flex h-7 shrink-0 items-center whitespace-nowrap justify-center gap-1 rounded-lg px-2 text-[11px] font-semibold transition disabled:opacity-35";
const IDLE = "text-blue-100/80 hover:bg-white/10 hover:text-white";
const ACTIVE = "bg-blue-500/30 text-white ring-1 ring-blue-300/60";

function ToolButton({ title, active, disabled, onClick, children }: {
  title: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode;
}) {
  return (
    <button type="button" title={title} aria-label={title} aria-pressed={active} disabled={disabled} onClick={onClick} className={`${BTN} ${active ? ACTIVE : IDLE}`}>
      {children}
    </button>
  );
}

const Divider = () => <span className="mx-0.5 h-5 w-px bg-white/15" />;

/**
 * Session and map controls for the Split screen, shown as the first row inside the
 * master panel so nothing floats over the map.
 */
export default function SplitMasterToolbar({
  saveState, savedAt, onSave, onNewSession,
  layersPanel,
  drawMode, onDrawModeChange, hasDrawing, onClearDrawing,
  controls,
}: {
  saveState: SaveState;
  savedAt: number | null;
  onSave: () => void;
  onNewSession: () => void;
  layersPanel: ReactNode;
  drawMode: DrawMode;
  onDrawModeChange: (mode: DrawMode) => void;
  hasDrawing: boolean;
  onClearDrawing: () => void;
  controls: MapControls | null;
}) {
  const { user } = useAuth();
  const [layersOpen, setLayersOpen] = useState(false);
  const layersButton = useRef<HTMLSpanElement>(null);
  // the panel body clips overflow, so the pop-over is portalled and placed above the button
  const anchor = layersOpen ? layersButton.current?.getBoundingClientRect() : null;

  const saveLabel = !user
    ? (saveState === "unsaved" ? "Not saved" : "Save")
    : saveState === "saving" ? "Saving…"
    : saveState === "saved" && savedAt ? `Saved ${new Date(savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : saveState === "error" ? "Retry save"
    : "Save";
  const SaveIcon = saveState === "saving" ? Loader2 : user && saveState === "saved" ? CheckCircle2 : saveState === "error" ? CloudOff : Save;

  return (
    <div>
      <div className="flex flex-nowrap items-center justify-between gap-0.5">
        <Link href="/homepage" title="Home" className={`${BTN} ${IDLE}`}><Home className="h-3.5 w-3.5" /></Link>
        <Divider />

        <button
          type="button"
          onClick={onSave}
          title={user ? "Sessions also save automatically while you work" : "Sign in to keep this session in your history"}
          className={`${BTN} ${!user ? "bg-amber-400 text-slate-900 hover:bg-amber-300" : saveState === "error" ? "text-red-300 hover:bg-white/10" : IDLE}`}
        >
          <SaveIcon className={`h-3.5 w-3.5 ${saveState === "saving" ? "animate-spin" : user && saveState === "saved" ? "text-emerald-400" : ""}`} />
          {saveLabel}
        </button>
        <SessionHistory buttonClassName={`${BTN} ${IDLE}`} />
        <ToolButton title="Start a new, empty session" onClick={onNewSession}><Plus className="h-3.5 w-3.5" />New</ToolButton>
        <Divider />

        <span ref={layersButton}>
          <ToolButton title="Layers" active={layersOpen} onClick={() => setLayersOpen((v) => !v)}><Layers className="h-3.5 w-3.5" /></ToolButton>
        </span>
        <ToolButton title="Fit to area" disabled={!controls} onClick={() => controls?.fitHome()}><ScanSearch className="h-3.5 w-3.5" /></ToolButton>
        <ToolButton title="Full screen" disabled={!controls} onClick={() => controls?.toggleFullscreen()}><Expand className="h-3.5 w-3.5" /></ToolButton>
        <ToolButton title="Draw polygon (double-click to finish)" active={drawMode === "polygon"} onClick={() => onDrawModeChange(drawMode === "polygon" ? null : "polygon")}>
          <Pentagon className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton title="Draw rectangle (drag)" active={drawMode === "rectangle"} onClick={() => onDrawModeChange(drawMode === "rectangle" ? null : "rectangle")}>
          <Square className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton title="Clear drawing" disabled={!hasDrawing} onClick={onClearDrawing}><Trash2 className="h-3.5 w-3.5" /></ToolButton>
        <Divider />

        {user ? (
          <ToolButton title={`Sign out ${user.email}`} onClick={() => logout(false)}>
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-500 text-[10px] font-bold text-white">
              {(user.full_name || user.email).charAt(0).toUpperCase()}
            </span>
            <LogOut className="h-3.5 w-3.5" />
          </ToolButton>
        ) : (
          <Link href="/login?next=/split" title="Sign in" className={`${BTN} ${IDLE}`}><LogIn className="h-3.5 w-3.5" />Sign in</Link>
        )}
      </div>

      {layersOpen && anchor ? createPortal(
        <div
          className="fixed z-[3000] w-72 max-w-[80vw] -translate-x-1/2 overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-slate-200"
          style={{ left: anchor.left + anchor.width / 2, bottom: window.innerHeight - anchor.top + 8 }}
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Layers</span>
            <button type="button" onClick={() => setLayersOpen(false)} className="text-xs text-slate-400 hover:text-slate-700" aria-label="Close">✕</button>
          </div>
          <div className="max-h-[50vh] overflow-y-auto p-3">{layersPanel}</div>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
