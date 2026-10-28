"use client";

import "leaflet/dist/leaflet.css";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocationSelection } from "../shared/hooks/useLocationSelection";
import type { BasemapType, StickyNote, ViewerMessage } from "../shared/types";
import SplitMasterPanel from "./components/SplitMasterPanel";
import SplitViewerWindow from "./components/SplitViewerWindow";
import type { STPWmsLayer } from "./components/STPSuitabilityPanel";
import SplitMasterToolbar, { SaveState } from "./components/SplitMasterToolbar";
import { useDatasets } from "../shared/components/DatasetCatalog";
import MapLayersPanel from "../shared/components/MapLayersPanel";
import { apiFetch, getUser } from "../shared/auth/authClient";
import { useLoginPrompt } from "../shared/auth/LoginDialog";
import type { Dataset } from "../shared/services/datasetService";
import type { DrawMode, DrawnShape } from "../shared/map/DrawLayer";
import type { MapControls } from "../shared/map/MapShell";
import { withDrawnArea } from "../shared/drawnArea";
import { DATASET_CATEGORIES } from "../shared/config";

const AdminMap = dynamic(
  () => import("../shared/map/AdminMap"),
  { ssr: false },
);

export type SplitMark = {
  id: string;
  timestamp: number;
  viewerSide: string;
  viewerTitle: string;
  tool: string;
  color: string;
  text: string;
  lat: number;
  lng: number;
  shape?: string;
};

export type SplitSession = {
  sessionId: string;
  startedAt: number;
  lastActivityAt: number;
  marks: SplitMark[];
  zones: string[];
  activeZones: string[];
  criteria: string[];
  activeCriteria: string[];
  basemap: string;
  stickyNotes: StickyNote[];
  messages: ViewerMessage[];
  screenNames?: Record<string, string>;
  // Full restore fields
  visibleScreens?: Record<string, boolean>;
  activeModule?: string;
  viewerScale?: number;
  mapView?: { center: [number, number]; zoom: number } | null;
  nirmalCriteria?: string[];
  janCriteria?: string[];
  arthCriteria?: string[];
  gyanCriteria?: string[];
  jeevantCriteria?: string[];
  masterCollapsed?: boolean;
  drawnPolygon?: DrawnShape | null;
  visibleDatasetIds?: number[];
};

const SAVE_DEBOUNCE_MS = 1500;
const newSessionId = () => `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const getZoneName = (feature: any) => {
  const props = feature?.properties || {};
  return String(
    props.id_ ??
      props.ID_ ??
      props.zone ??
      props.Zone ??
      props.ZONE ??
      props.area_name ??
      props.Area ??
      props.NAME ??
      "",
  )
    .trim()
    .toUpperCase();
};

export default function SplitModule() {
  const backendBase = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:9000";
  const { areaGeojson, riversGeojson, basinGeojson } = useLocationSelection();

  const [layerState, setLayerState] = useState({ basin: true, rivers: true, area: true });

  // Uploaded data and the user's own clip area
  const { datasets } = useDatasets();
  const [visibleDatasetIds, setVisibleDatasetIds] = useState<number[]>([]);
  const [drawnShape, setDrawnShape] = useState<DrawnShape | null>(null);
  const [drawMode, setDrawMode] = useState<DrawMode>(null);
  const [mapControls, setMapControls] = useState<MapControls | null>(null);
  const visibleDatasets = useMemo(() => datasets.filter((d) => visibleDatasetIds.includes(d.id)), [datasets, visibleDatasetIds]);
  const toggleDataset = useCallback((ds: Dataset) => {
    setVisibleDatasetIds((ids) => (ids.includes(ds.id) ? ids.filter((i) => i !== ds.id) : [...ids, ds.id]));
  }, []);

  // Saving: automatic for signed-in users, a sign-in prompt otherwise
  const { requireLogin, dialog: loginDialog } = useLoginPrompt();
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [visibleScreens, setVisibleScreens] = useState<Record<string, boolean>>({
    top: false, topSecondary: false, left: false, right: false, bottom: false,
  });
  const handleToggleScreen = useCallback((side: string) => {
    setVisibleScreens(prev => ({ ...prev, [side]: !prev[side] }));
  }, []);
  const handleSetAllScreens = useCallback((visible: boolean) => {
    setVisibleScreens({ top: visible, topSecondary: visible, left: visible, right: visible, bottom: visible });
  }, []);
  const [basemap, setBasemap] = useState<BasemapType>("terrain");
  const [showBasemap, setShowBasemap] = useState(true);
  const [masterCollapsed, setMasterCollapsed] = useState(false);
  const [viewerScale, setViewerScale] = useState(0.75);
  const [mapView, setMapView] = useState<{ center: [number, number]; zoom: number } | null>(null);
  const [selectedZones, setSelectedZones] = useState<string[]>([]);
  // zones sent to every layer / analysis: the selected zones plus the drawn area, if any
  const analysisZones = useMemo(() => withDrawnArea(selectedZones, drawnShape), [selectedZones, drawnShape]);
  const [stickyNotes, setStickyNotes] = useState<StickyNote[]>([]);
  const [activeEditors, setActiveEditors] = useState<Record<string, string>>({});
  const [masterStickyMode, setMasterStickyMode] = useState(false);
  const [masterNoteColor, setMasterNoteColor] = useState("#fde047");
  const [masterNoteShape, setMasterNoteShape] = useState<StickyNote["shape"]>("sticky");
  const [viewerMessages, setViewerMessages] = useState<ViewerMessage[]>([]);
  const [aviralCriteria, setAviralCriteria] = useState<string[]>([]);
  const [combinedTiff, setCombinedTiff] = useState<ArrayBuffer | null>(null);
  const [nirmalCriteria, setNirmalCriteria] = useState<string[]>([]);
  const [nirmalCombinedTiff, setNirmalCombinedTiff] = useState<ArrayBuffer | null>(null);
  const [janCriteria, setJanCriteria] = useState<string[]>([]);
  const [janCombinedTiff, setJanCombinedTiff] = useState<ArrayBuffer | null>(null);
  const [arthCriteria, setArthCriteria] = useState<string[]>([]);
  const [arthCombinedTiff, setArthCombinedTiff] = useState<ArrayBuffer | null>(null);
  const [gyanCriteria, setGyanCriteria] = useState<string[]>([]);
  const [gyanCombinedTiff, setGyanCombinedTiff] = useState<ArrayBuffer | null>(null);
  const [jeevantCriteria, setJeevantCriteria] = useState<string[]>([]);
  const [jeevantCombinedTiff, setJeevantCombinedTiff] = useState<ArrayBuffer | null>(null);
  const [activeModule, setActiveModule] = useState<"Aviral Ganga" | "Nirmal Ganga" | "Jan Ganga" | "Arth Ganga" | "Gyan Ganga" | "Jeevant Ganga" | "STP Suitability">("Aviral Ganga");
  const [activeCombinedMeta, setActiveCombinedMeta] = useState<{ stage_name: string; criteria: string[]; weights: Record<string, number>; generated_at: number } | null>(null);
  const [mainStpLayers,     setMainStpLayers]     = useState<Record<string, STPWmsLayer | null>>({});
  const [mainStpAreaLayers, setMainStpAreaLayers] = useState<Record<string, STPWmsLayer | null>>({});
  const [stpResetKey, setStpResetKey] = useState(0);

  const handleResetAllSTP = useCallback(() => {
    setStpResetKey(k => k + 1);
    setMainStpLayers({});
    setMainStpAreaLayers({});
  }, []);
  const [screenNames, setScreenNames] = useState<Record<string, string>>({
    top: "Screen 1",
    topSecondary: "Screen 2",
    left: "Screen 3",
    right: "Screen 4",
    bottom: "Main Screen",
  });
/** noteId → viewer sides that have clicked "Reveal" for that note */
  const [revealedNotes, setRevealedNotes] = useState<Record<string, string[]>>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const mainMapRef = useRef<HTMLDivElement>(null);

  const handleRevealNote = useCallback((noteId: string, side: string) => {
    setRevealedNotes((prev) => ({
      ...prev,
      [noteId]: [...new Set([...(prev[noteId] ?? []), side])],
    }));
  }, []);

  const handleHideNote = useCallback((noteId: string, side: string) => {
    setRevealedNotes((prev) => ({
      ...prev,
      [noteId]: (prev[noteId] ?? []).filter((s) => s !== side),
    }));
  }, []);

  const handleSendMessage = useCallback((fromSide: string, fromTitle: string, text: string) => {
    const to: "all" | "main" = fromSide === "bottom" ? "all" : "main";
    setViewerMessages((prev) => [
      ...prev,
      { id: `${Date.now()}-${Math.random()}`, text, fromSide, fromTitle, to, timestamp: Date.now() },
    ]);
  }, []);

  // Zone names derived from areaGeojson
  const availableZones = useMemo(() => {
    if (!areaGeojson?.features) return [];
    return Array.from(new Set(
      areaGeojson.features.map(getZoneName).filter(Boolean)
    )).sort();
  }, [areaGeojson]);

  const handleZoneClick = useCallback((zoneName: string) => {
    setSelectedZones((prev) => (prev[0] === zoneName ? [] : [zoneName]));
  }, []);

  const handleMasterZoneToggle = useCallback((zone: string) => {
    setSelectedZones((prev) =>
      prev.includes(zone) ? prev.filter((z) => z !== zone) : [...prev, zone]
    );
  }, []);

  const handleSelectAllZones = useCallback(() => {
    setSelectedZones(availableZones);
  }, [availableZones]);

  const handleClearZones = useCallback(() => {
    setSelectedZones([]);
  }, []);

  const selectedZoneGeojson = useMemo(() => {
    if (!areaGeojson?.features?.length || selectedZones.length === 0) return null;

    const features = areaGeojson.features.filter((feature) => selectedZones.includes(getZoneName(feature)));
    if (!features.length) return null;

    return {
      type: "FeatureCollection" as const,
      features,
    };
  }, [areaGeojson, selectedZones]);

  const handleCreateStickyNote = useCallback((note: Omit<StickyNote, "id">) => {
    const id = `${Date.now()}-${Math.random()}`;
    setStickyNotes((prev) => [
      ...prev,
      { id, ...note },
    ]);
    setActiveEditors((prev) => ({ ...prev, [id]: note.author }));
  }, []);

  const handleUpdateStickyNote = useCallback((id: string, text: string) => {
    setStickyNotes((prev) =>
      prev.map((note) => (note.id === id ? { ...note, text } : note)),
    );
  }, []);

  const handleMasterToolSelect = useCallback((color: string, shape: StickyNote["shape"]) => {
    setMasterNoteColor(color);
    setMasterNoteShape(shape);
    setMasterStickyMode(true);
  }, []);

  // ── Session tracking ──────────────────────────────────────────────────────
  const sessionRef = useRef<SplitSession>({
    sessionId: newSessionId(),
    startedAt: Date.now(),
    lastActivityAt: Date.now(),
    marks: [],
    zones: [],
    activeZones: [],
    criteria: [],
    activeCriteria: [],
    basemap: "terrain",
    stickyNotes: [],
    messages: [],
    visibleScreens: { top: false, topSecondary: false, left: false, right: false, bottom: false },
    activeModule: "Aviral Ganga",
    viewerScale: 0.75,
    mapView: null,
    nirmalCriteria: [],
    janCriteria: [],
    arthCriteria: [],
    gyanCriteria: [],
    jeevantCriteria: [],
    masterCollapsed: false,
  });

  const mountedRef = useRef(false);

  async function pushSession() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState("saving");
    try {
      const res = await apiFetch("/sessions/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sessionRef.current),
      });
      if (res.status === 401) return setSaveState("unsaved");
      if (!res.ok) return setSaveState("error");
      setSaveState("saved");
      setSavedAt(Date.now());
    } catch {
      setSaveState("error");
    }
  }

  function saveSession(_s: SplitSession) {
    if (!getUser()) {
      setSaveState("unsaved");
      return;
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void pushSession(), SAVE_DEBOUNCE_MS);
  }

  const handleSaveClick = async () => {
    if (!(await requireLogin("Sign in to save this Split session to your history"))) return;
    await pushSession();
  };

  const handleNewSession = () => {
    // ?new skips restoring the last session on load
    window.location.href = "/split?new=1";
  };

  function hasActivity(s: SplitSession) {
    return (
      s.marks.length > 0 || s.stickyNotes.length > 0 || s.zones.length > 0 || s.criteria.length > 0 ||
      !!s.drawnPolygon || (s.visibleDatasetIds?.length ?? 0) > 0
    );
  }

  function persistIfActive(s: SplitSession) {
    if (hasActivity(s)) saveSession(s);
  }

  useEffect(() => {
    if (!mountedRef.current) return;
    const s = sessionRef.current;
    const merged = Array.from(new Set([...s.zones, ...selectedZones]));
    sessionRef.current = { ...s, zones: merged, activeZones: selectedZones, lastActivityAt: Date.now() };
    persistIfActive(sessionRef.current);
  }, [selectedZones]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!mountedRef.current) return;
    const s = sessionRef.current;
    const merged = Array.from(new Set([...s.criteria, ...aviralCriteria]));
    sessionRef.current = { ...s, criteria: merged, activeCriteria: aviralCriteria, lastActivityAt: Date.now() };
    persistIfActive(sessionRef.current);
  }, [aviralCriteria]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!mountedRef.current) return;
    sessionRef.current = { ...sessionRef.current, nirmalCriteria, lastActivityAt: Date.now() };
    persistIfActive(sessionRef.current);
  }, [nirmalCriteria]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!mountedRef.current) return;
    sessionRef.current = { ...sessionRef.current, janCriteria, lastActivityAt: Date.now() };
    persistIfActive(sessionRef.current);
  }, [janCriteria]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!mountedRef.current) return;
    sessionRef.current = { ...sessionRef.current, arthCriteria, lastActivityAt: Date.now() };
    persistIfActive(sessionRef.current);
  }, [arthCriteria]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!mountedRef.current) return;
    sessionRef.current = { ...sessionRef.current, gyanCriteria, lastActivityAt: Date.now() };
    persistIfActive(sessionRef.current);
  }, [gyanCriteria]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!mountedRef.current) return;
    sessionRef.current = { ...sessionRef.current, jeevantCriteria, lastActivityAt: Date.now() };
    persistIfActive(sessionRef.current);
  }, [jeevantCriteria]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!mountedRef.current) return;
    sessionRef.current = { ...sessionRef.current, basemap, lastActivityAt: Date.now() };
    persistIfActive(sessionRef.current);
  }, [basemap]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!mountedRef.current) return;
    sessionRef.current = { ...sessionRef.current, visibleScreens, lastActivityAt: Date.now() };
    persistIfActive(sessionRef.current);
  }, [visibleScreens]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!mountedRef.current) return;
    sessionRef.current = { ...sessionRef.current, activeModule, lastActivityAt: Date.now() };
    persistIfActive(sessionRef.current);
  }, [activeModule]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!mountedRef.current) return;
    sessionRef.current = { ...sessionRef.current, viewerScale, lastActivityAt: Date.now() };
    persistIfActive(sessionRef.current);
  }, [viewerScale]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!mountedRef.current) return;
    sessionRef.current = { ...sessionRef.current, mapView, lastActivityAt: Date.now() };
    persistIfActive(sessionRef.current);
  }, [mapView]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!mountedRef.current) return;
    sessionRef.current = { ...sessionRef.current, masterCollapsed, lastActivityAt: Date.now() };
    persistIfActive(sessionRef.current);
  }, [masterCollapsed]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!mountedRef.current) return;
    sessionRef.current = { ...sessionRef.current, stickyNotes, lastActivityAt: Date.now() };
    persistIfActive(sessionRef.current);
  }, [stickyNotes]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!mountedRef.current) return;
    sessionRef.current = { ...sessionRef.current, screenNames, lastActivityAt: Date.now() };
    persistIfActive(sessionRef.current);
  }, [screenNames]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!mountedRef.current) return;
    sessionRef.current = { ...sessionRef.current, messages: viewerMessages, lastActivityAt: Date.now() };
    persistIfActive(sessionRef.current);
  }, [viewerMessages]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!mountedRef.current) return;
    sessionRef.current = { ...sessionRef.current, drawnPolygon: drawnShape, visibleDatasetIds, lastActivityAt: Date.now() };
    persistIfActive(sessionRef.current);
  }, [drawnShape, visibleDatasetIds]);  // eslint-disable-line react-hooks/exhaustive-deps

  function addMark(mark: SplitMark) {
    const s = sessionRef.current;
    sessionRef.current = { ...s, marks: [...s.marks, mark], lastActivityAt: Date.now() };
    saveSession(sessionRef.current); // always save when a mark is added
  }
  // ─────────────────────────────────────────────────────────────────────────

  const handleMasterMapClick = useCallback((lat: number, lng: number) => {
    if (!masterStickyMode) return;
    const id = `${Date.now()}-${Math.random()}`;
    setStickyNotes((prev) => [
      ...prev,
      { id, author: "Main Screen", ownerSide: "main", text: "", color: masterNoteColor, lat, lng, shape: masterNoteShape },
    ]);
    setActiveEditors((prev) => ({ ...prev, [id]: "main" }));
    setMasterStickyMode(false);
    const toolLabel = masterNoteShape === "text" ? "text label" : masterNoteShape === "sticky" ? "sticky note" : (masterNoteShape ?? "shape");
    addMark({ id, timestamp: Date.now(), viewerSide: "main", viewerTitle: "Main Screen", tool: toolLabel, color: masterNoteColor, text: "", lat, lng });
  }, [masterStickyMode, masterNoteColor, masterNoteShape]);  // eslint-disable-line react-hooks/exhaustive-deps

  const handleDeleteStickyNote = useCallback((id: string) => {
    setStickyNotes((prev) => prev.filter((note) => note.id !== id));
    setViewerMessages((prev) => prev.filter((msg) => msg.noteId !== id));
    setActiveEditors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setRevealedNotes((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const handleOpenStickyEditor = useCallback((noteId: string | null, viewerSide: string) => {
    setActiveEditors((prev) => {
      const next = { ...prev };
      if (!noteId) {
        for (const [id, side] of Object.entries(next)) {
          if (side === viewerSide) delete next[id];
        }
      } else {
        if (next[noteId] && next[noteId] !== viewerSide) return prev;
        for (const [id, side] of Object.entries(next)) {
          if (side === viewerSide) delete next[id];
        }
        next[noteId] = viewerSide;
      }
      return next;
    });
  }, []);

  const handleMapViewChange = useCallback((center: [number, number], zoom: number) => {
    setMapView({ center, zoom });
  }, []);

  function applySession(s: SplitSession) {
    if (s.stickyNotes?.length) setStickyNotes(s.stickyNotes);
    if (s.activeZones?.length) setSelectedZones(s.activeZones);
    if (s.basemap) setBasemap(s.basemap as BasemapType);
    if (s.messages?.length) setViewerMessages(s.messages);
    if (s.screenNames) setScreenNames(s.screenNames);
    if (s.visibleScreens) setVisibleScreens(s.visibleScreens);
    if (s.activeModule) setActiveModule(s.activeModule as typeof activeModule);
    if (s.viewerScale) setViewerScale(s.viewerScale);
    if (s.mapView) setMapView(s.mapView);
    if (s.masterCollapsed !== undefined) setMasterCollapsed(s.masterCollapsed);
    if (s.drawnPolygon) setDrawnShape(s.drawnPolygon);
    if (s.visibleDatasetIds?.length) setVisibleDatasetIds(s.visibleDatasetIds);
    // Restore per-module criteria
    if (s.activeCriteria?.length) setAviralCriteria(s.activeCriteria);
    if (s.nirmalCriteria?.length) setNirmalCriteria(s.nirmalCriteria);
    if (s.janCriteria?.length) setJanCriteria(s.janCriteria);
    if (s.arthCriteria?.length) setArthCriteria(s.arthCriteria);
    if (s.gyanCriteria?.length) setGyanCriteria(s.gyanCriteria);
    if (s.jeevantCriteria?.length) setJeevantCriteria(s.jeevantCriteria);
    // Keep the same session id so further work updates this history entry
    sessionRef.current = { ...sessionRef.current, ...s, marks: s.marks ?? [], stickyNotes: s.stickyNotes ?? [], messages: s.messages ?? [] };
    setSaveState("saved");
    setSavedAt(s.lastActivityAt ?? null);
  }

  // Open where the user left off: a session picked in History (?session=…), else the user's
  // most recent session. ?new=1 starts empty.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const requested = params.get("session");
      let restored: SplitSession | null = null;
      try {
        if (requested) {
          if (await requireLogin("Sign in to open your saved session")) {
            const r = await apiFetch(`/sessions/${encodeURIComponent(requested)}`);
            if (r.ok) restored = await r.json();
          }
        } else if (!params.has("new") && getUser()) {
          const r = await apiFetch("/sessions/latest");
          if (r.ok) restored = (await r.json()).session;
        }
      } catch { /* start empty */ }
      if (requested || params.has("new")) window.history.replaceState(null, "", "/split");
      if (cancelled) return;
      if (restored) applySession(restored);
      // Mark mount as done — all sync effects are now active
      mountedRef.current = true;
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    document.body.classList.add("holistic-fullscreen-mode");
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;

    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }

    return () => {
      document.body.classList.remove("holistic-fullscreen-mode");
    };
  }, []);

  const activeCriteriaForModule =
    activeModule === "Nirmal Ganga" ? nirmalCriteria :
    activeModule === "Jan Ganga"   ? janCriteria :
    activeModule === "Arth Ganga"  ? arthCriteria :
    activeModule === "Gyan Ganga"  ? gyanCriteria :
    activeModule === "Jeevant Ganga" ? jeevantCriteria :
    aviralCriteria;

  const activeTiffForModule =
    activeModule === "Nirmal Ganga" ? nirmalCombinedTiff :
    activeModule === "Jan Ganga"    ? janCombinedTiff :
    activeModule === "Arth Ganga"   ? arthCombinedTiff :
    activeModule === "Gyan Ganga"   ? gyanCombinedTiff :
    activeModule === "Jeevant Ganga" ? jeevantCombinedTiff :
    combinedTiff;

  const setActiveTiffForModule =
    activeModule === "Nirmal Ganga" ? setNirmalCombinedTiff :
    activeModule === "Jan Ganga"    ? setJanCombinedTiff :
    activeModule === "Arth Ganga"   ? setArthCombinedTiff :
    activeModule === "Gyan Ganga"   ? setGyanCombinedTiff :
    activeModule === "Jeevant Ganga" ? setJeevantCombinedTiff :
    setCombinedTiff;

  const activeDataCategory = DATASET_CATEGORIES.find((c) => c.label === activeModule);
  const moduleDatasets = useMemo(
    () => (activeDataCategory ? datasets.filter((d) => d.status === "ready" && d.kind !== "table" && d.category === activeDataCategory.key) : []),
    [datasets, activeDataCategory],
  );

  // Dynamic offset: each top viewer is effectiveW*scale px wide; half + gap keeps them from overlapping
  const topBaseW = aviralCriteria.length > 0 ? Math.round(420 * 1.2) : 420;
  const topPairOffset = Math.round((topBaseW * viewerScale) / 2) + 20;

  const viewerWindows: {
    side: "top" | "topSecondary" | "left" | "right" | "bottom";
    title: string;
    subtitle: string;
    initialOffset?: number;
    isMainScreen: boolean;
  }[] = [
    { side: "top", title: screenNames.top, subtitle: "", initialOffset: -topPairOffset, isMainScreen: false },
    { side: "topSecondary", title: screenNames.topSecondary, subtitle: "", initialOffset: topPairOffset, isMainScreen: false },
    { side: "left", title: screenNames.left, subtitle: "", initialOffset: -30, isMainScreen: false },
    { side: "right", title: screenNames.right, subtitle: "", initialOffset: 30, isMainScreen: false },
    { side: "bottom", title: screenNames.bottom, subtitle: "", initialOffset: 0, isMainScreen: true },
  ];

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 overflow-hidden bg-[#0a0e1a]"
    >

      <div
        ref={mainMapRef}
        className="absolute inset-0 split-main-map"
        style={{
          width: "100%",
          height: "100%",
        }}
      >
        <AdminMap
          selectedZones={analysisZones}
          areaGeojson={layerState.area ? areaGeojson : null}
          riversGeojson={layerState.rivers ? riversGeojson : null}
          basinGeojson={layerState.basin ? basinGeojson : null}
          selectedZoneGeojson={selectedZoneGeojson}
          analysisResult={null}
          showRainfallLayer={activeCriteriaForModule.includes("Rainfall & runoff")}
          showRechargeLayer={activeCriteriaForModule.includes("Groundwater recharge")}
          rainfallYear={null}
          clipApiBase={backendBase}
          interactive={true}
          basemap={basemap}
          showBasemap={showBasemap}
          borderless={true}
          onViewChange={handleMapViewChange}
          onZoneClick={handleZoneClick}
          stickyNotes={stickyNotes}
          editingStickyNoteId={Object.keys(activeEditors).find(id => activeEditors[id] === "main") || null}
          onUpdateStickyNote={handleUpdateStickyNote}
          onOpenStickyEditor={(id) => handleOpenStickyEditor(id, "main")}
          onDeleteStickyNote={handleDeleteStickyNote}
          viewerSide="main"
          stickyMode={masterStickyMode}
          onStickyMapClick={handleMasterMapClick}
          activeCriteria={activeCriteriaForModule}
          screenNames={screenNames}
          stpWmsLayers={Object.values(mainStpLayers).filter(Boolean) as STPWmsLayer[]}
          stpAreaWmsLayers={Object.values(mainStpAreaLayers).filter(Boolean) as STPWmsLayer[]}
          aviralTiff={activeTiffForModule}
          onBasemapChange={setBasemap}
          drawnShape={drawnShape}
          onDrawnShapeChange={setDrawnShape}
          datasets={visibleDatasets}
          // controls live in the master panel toolbar, not on the map
          tools={["zoom", "coords", "scale"]}
          drawMode={drawMode}
          onDrawModeChange={setDrawMode}
          onControls={setMapControls}
        />
      </div>

      {viewerWindows.map((viewer) => (
        <SplitViewerWindow
          key={viewer.side}
          side={viewer.side}
          title={viewer.title}
          onScreenNameChange={(name) => setScreenNames((prev) => ({ ...prev, [viewer.side]: name }))}
          subtitle={viewer.subtitle}
          visible={visibleScreens[viewer.side] ?? false}
          onHideSelf={() => setVisibleScreens(prev => ({ ...prev, [viewer.side]: false }))}
          basemap={basemap}
          showBasemap={showBasemap}
          scale={viewerScale}
          initialOffset={viewer.initialOffset}
          areaGeojson={areaGeojson}
          riversGeojson={riversGeojson}
          basinGeojson={basinGeojson}
          layerState={layerState}
          mapView={mapView}
          selectedZones={analysisZones}
          stickyNotes={stickyNotes}
          onCreateStickyNote={(note) => {
            const id = `${Date.now()}-${Math.random()}`;
            setStickyNotes((prev) => [...prev, { id, ownerSide: viewer.side as string, ...note } as StickyNote]);
            setActiveEditors((prev) => ({ ...prev, [id]: viewer.side }));
            const shapeLabel = note.shape === "text" ? "text label"
              : note.shape === "sticky" ? "sticky note"
              : (note.shape ?? "shape");
            setViewerMessages((prev) => [...prev, {
              id: `notify-${id}`,
              text: `placed a ${shapeLabel} on the map`,
              fromSide: viewer.side,
              fromTitle: viewer.title,
              to: "all",
              timestamp: Date.now(),
              noteId: id,
            }]);
            addMark({ id, timestamp: Date.now(), viewerSide: viewer.side, viewerTitle: viewer.title, tool: shapeLabel, color: note.color, text: note.text ?? "", lat: note.lat, lng: note.lng });
          }}
          activeEditors={activeEditors}
          onUpdateStickyNote={handleUpdateStickyNote}
          onOpenStickyEditor={(id) => handleOpenStickyEditor(id, viewer.side)}
          onDeleteStickyNote={handleDeleteStickyNote}
          messages={viewerMessages}
          onSendMessage={(text) => handleSendMessage(viewer.side, viewer.title, text)}
          activeCriteria={activeCriteriaForModule}
          clipApiBase={backendBase}
          revealedNotes={revealedNotes}
          onRevealNote={(noteId) => handleRevealNote(noteId, viewer.side)}
          onHideNote={(noteId) => handleHideNote(noteId, viewer.side)}
          activeModule={activeModule}
          onSTPPresentToMain={(layer) => setMainStpLayers(prev => ({ ...prev, [viewer.side]: layer }))}
          onSTPAreaPresentToMain={(layer) => setMainStpAreaLayers(prev => ({ ...prev, [viewer.side]: layer }))}
          stpResetKey={stpResetKey}
          moduleTiff={activeTiffForModule}
          combinedMeta={activeCombinedMeta}
          onPresentToMain={setActiveTiffForModule}
        />
      ))}

      <SplitMasterPanel
        visibleScreens={visibleScreens}
        onToggleScreen={handleToggleScreen}
        onSetAllScreens={handleSetAllScreens}
        screenNames={screenNames}
        basemap={basemap}
        onBasemapChange={setBasemap}
        showBasemap={showBasemap}
        onToggleBasemap={() => setShowBasemap((prev) => !prev)}
        viewerScale={viewerScale}
        onViewerScaleChange={setViewerScale}
        collapsed={masterCollapsed}
        onToggleCollapse={() => setMasterCollapsed((prev) => !prev)}
        stickyMode={masterStickyMode}
        onToolSelect={handleMasterToolSelect}
        onCancelTool={() => setMasterStickyMode(false)}
        zones={availableZones}
        selectedZones={selectedZones}
        onZoneToggle={handleMasterZoneToggle}
        onSelectAllZones={handleSelectAllZones}
        onClearZones={handleClearZones}
        aviralCriteria={aviralCriteria}
        onAviralCriteriaChange={setAviralCriteria}
        onCombinedTiffChange={setCombinedTiff}
        nirmalCriteria={nirmalCriteria}
        onNirmalCriteriaChange={setNirmalCriteria}
        onNirmalCombinedTiffChange={setNirmalCombinedTiff}
        janCriteria={janCriteria}
        onJanCriteriaChange={setJanCriteria}
        onJanCombinedTiffChange={setJanCombinedTiff}
        arthCriteria={arthCriteria}
        onArthCriteriaChange={setArthCriteria}
        onArthCombinedTiffChange={setArthCombinedTiff}
        gyanCriteria={gyanCriteria}
        onGyanCriteriaChange={setGyanCriteria}
        onGyanCombinedTiffChange={setGyanCombinedTiff}
        jeevantCriteria={jeevantCriteria}
        onJeevantCriteriaChange={setJeevantCriteria}
        onJeevantCombinedTiffChange={setJeevantCombinedTiff}
        activeModule={activeModule}
        onActiveModuleChange={(mod) => {
          if (mod !== "STP Suitability") handleResetAllSTP();
          if (mod !== "Aviral Ganga") setAviralCriteria([]);
          if (mod !== "Nirmal Ganga") setNirmalCriteria([]);
          if (mod !== "Jan Ganga") setJanCriteria([]);
          if (mod !== "Arth Ganga") setArthCriteria([]);
          if (mod !== "Gyan Ganga") setGyanCriteria([]);
          if (mod !== "Jeevant Ganga") setJeevantCriteria([]);
          setVisibleDatasetIds([]);
          setActiveModule(mod);
          setActiveCombinedMeta(null);
        }}
        onResetAllSTP={handleResetAllSTP}
        onActiveCombinedMetaChange={setActiveCombinedMeta}
        hasDrawnArea={!!drawnShape}
        uploadedDatasets={moduleDatasets}
        visibleDatasetIds={visibleDatasetIds}
        onToggleDataset={(id) => setVisibleDatasetIds((ids) => (ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]))}
        toolbar={
          <SplitMasterToolbar
            saveState={saveState}
            savedAt={savedAt}
            onSave={handleSaveClick}
            onNewSession={handleNewSession}
            layersPanel={
              <MapLayersPanel
                baseLayers={layerState}
                onBaseLayersChange={setLayerState}
                visibleDatasets={visibleDatasets}
                onToggleDataset={toggleDataset}
              />
            }
            drawMode={drawMode}
            onDrawModeChange={setDrawMode}
            hasDrawing={!!drawnShape}
            onClearDrawing={() => setDrawnShape(null)}
            controls={mapControls}
          />
        }
      />
      {loginDialog}
    </div>
  );
}
