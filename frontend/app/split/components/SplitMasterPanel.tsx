"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadPhaseMeta, loadPhaseTiff } from "../../shared/phaseRasterClient";
import { BACKEND_URL } from "../../shared/config";
import type { BasemapType, StickyNote } from "../../shared/types";

type CombinedMeta = { stage_name: string; criteria: string[]; weights: Record<string, number>; generated_at: number } | null;

type SplitMasterPanelProps = {
  visibleScreens: Record<string, boolean>;
  onToggleScreen: (side: string) => void;
  onSetAllScreens: (visible: boolean) => void;
  screenNames: Record<string, string>;
  basemap: BasemapType;
  onBasemapChange: (basemap: BasemapType) => void;
  showBasemap: boolean;
  onToggleBasemap: () => void;
  viewerScale: number;
  onViewerScaleChange: (scale: number) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  stickyMode?: boolean;
  onToolSelect?: (color: string, shape: StickyNote["shape"]) => void;
  onCancelTool?: () => void;
  zones?: string[];
  selectedZones?: string[];
  onZoneToggle?: (zone: string) => void;
  onSelectAllZones?: () => void;
  onClearZones?: () => void;
  aviralCriteria?: string[];
  onAviralCriteriaChange?: (criteria: string[]) => void;
  onCombinedTiffChange?: (tiff: ArrayBuffer | null) => void;
  nirmalCriteria?: string[];
  onNirmalCriteriaChange?: (criteria: string[]) => void;
  onNirmalCombinedTiffChange?: (tiff: ArrayBuffer | null) => void;
  janCriteria?: string[];
  onJanCriteriaChange?: (criteria: string[]) => void;
  onJanCombinedTiffChange?: (tiff: ArrayBuffer | null) => void;
  arthCriteria?: string[];
  onArthCriteriaChange?: (criteria: string[]) => void;
  onArthCombinedTiffChange?: (tiff: ArrayBuffer | null) => void;
  gyanCriteria?: string[];
  onGyanCriteriaChange?: (criteria: string[]) => void;
  onGyanCombinedTiffChange?: (tiff: ArrayBuffer | null) => void;
  jeevantCriteria?: string[];
  onJeevantCriteriaChange?: (criteria: string[]) => void;
  onJeevantCombinedTiffChange?: (tiff: ArrayBuffer | null) => void;
  activeModule: "Aviral Ganga" | "Nirmal Ganga" | "Jan Ganga" | "Arth Ganga" | "Gyan Ganga" | "Jeevant Ganga" | "STP Suitability";
  onActiveModuleChange: (module: "Aviral Ganga" | "Nirmal Ganga" | "Jan Ganga" | "Arth Ganga" | "Gyan Ganga" | "Jeevant Ganga" | "STP Suitability") => void;
  onResetAllSTP?: () => void;
  onActiveCombinedMetaChange?: (meta: CombinedMeta) => void;
  /** Session + map controls, shown as the first row of the panel. */
  toolbar?: React.ReactNode;
  /** a polygon drawn on the map also counts as an analysis area */
  hasDrawnArea?: boolean;
  /** Datasets uploaded for the active module's category, listed with the criteria. */
  uploadedDatasets?: { id: number; title: string }[];
  visibleDatasetIds?: number[];
  onToggleDataset?: (id: number) => void;
};

const basemapOptions: { key: BasemapType; label: string; icon: string }[] = [
  { key: "terrain",   label: "Terrain",   icon: "T" },
  { key: "satellite", label: "Satellite", icon: "S" },
  { key: "streets",   label: "Streets",   icon: "R" },
  { key: "dark",      label: "Dark",      icon: "D" },
];

/** Same accent as the bottom viewer for visual consistency */
const ACCENT = "#60a5fa";

const SCREEN_SIDES = ["top", "topSecondary", "left", "right", "bottom"] as const;

export default function SplitMasterPanel({
  visibleScreens,
  onToggleScreen,
  onSetAllScreens,
  screenNames,
  basemap,
  onBasemapChange,
  showBasemap: _showBasemap,
  onToggleBasemap: _onToggleBasemap,
  viewerScale,
  onViewerScaleChange,
  collapsed,
  onToggleCollapse,
  stickyMode = false,
  onToolSelect,
  onCancelTool,
  zones = [],
  selectedZones = [],
  onZoneToggle,
  onSelectAllZones,
  onClearZones,
  aviralCriteria = [],
  onAviralCriteriaChange,
  onCombinedTiffChange,
  nirmalCriteria = [],
  onNirmalCriteriaChange,
  onNirmalCombinedTiffChange,
  janCriteria = [],
  onJanCriteriaChange,
  onJanCombinedTiffChange,
  arthCriteria = [],
  onArthCriteriaChange,
  onArthCombinedTiffChange,
  gyanCriteria = [],
  onGyanCriteriaChange,
  onGyanCombinedTiffChange,
  jeevantCriteria = [],
  onJeevantCriteriaChange,
  onJeevantCombinedTiffChange,
  activeModule,
  onActiveModuleChange,
  onResetAllSTP,
  onActiveCombinedMetaChange,
  toolbar,
  hasDrawnArea = false,
  uploadedDatasets = [],
  visibleDatasetIds = [],
  onToggleDataset,
}: SplitMasterPanelProps) {
  const [showScreensDropdown, setShowScreensDropdown] = useState(false);
  const [showViewerSize, setShowViewerSize] = useState(false);
  const [showZoneDropdown, setShowZoneDropdown] = useState(false);
  // Right column is absolutely positioned; track its height so the panel body
  // grows to fit it instead of clipping modules/criteria.
  const rightColRef = useRef<HTMLDivElement>(null);
  const [rightColHeight, setRightColHeight] = useState(0);
  useEffect(() => {
    const el = rightColRef.current;
    if (!el) return;
    const update = () => setRightColHeight(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [collapsed]);
  const zoneDropdownRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarOffset, setToolbarOffset] = useState(2);
  useEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    // body padding-top (10) + toolbar row + its bottom margin (8)
    const update = () => setToolbarOffset(10 + el.offsetHeight + 8);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [!!toolbar, collapsed]);

  // Close zone dropdown when clicking outside
  useEffect(() => {
    if (!showZoneDropdown) return;
    const handler = (e: MouseEvent) => {
      if (zoneDropdownRef.current && !zoneDropdownRef.current.contains(e.target as Node)) {
        setShowZoneDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showZoneDropdown]);

  const AVIRAL_CRITERIA = [
    "River flow",
    "Tributary & drain flow",
    "Rainfall & runoff",
    "Groundwater recharge",
    "Channel geometry (width, depth)",
    "DEM, slope maps",
    "Surface flow direction & accumulation maps",
  ] as const;

  const NIRMAL_CRITERIA = [
    "River water quality",
    "Groundwater quality",
    "STP details",
    "Drains & discharge points",
    "Industrial discharge",
    "Septage density",
    "Solid waste hotspots",
  ] as const;

  const JAN_CRITERIA = [
    "Population (urban/rural)",
    "Gram Panchayat data",
    "Fishing communities",
    "Public participation plans",
  ] as const;

  const ARTH_CRITERIA = [
    "Agriculture (crop area, water demand)",
    "Irrigation dependency",
    "Tourism & cultural nodes",
    "Ghats & heritage sites",
    "Economic activity zones",
  ] as const;

  const GYAN_CRITERIA = [
    "All baseline datasets",
    "Remote sensing + GIS maps",
    "SWAT model outputs",
    "Hydrogeology (aquifer, MAR, paleo-channels)",
    "Monitoring stations & sensors",
  ] as const;

  const JEEVANT_CRITERIA = [
    "Wetlands, ponds, lakes",
    "Riparian vegetation",
    "Biodiversity (fish, birds, invasive species)",
    "Floodplain & habitat data",
  ] as const;

  const COMBINED_LABEL = "Combined Output";
  const BACKEND = BACKEND_URL;

  const [combinedMeta, setCombinedMeta] = useState<CombinedMeta>(null);
  const [nirmalCombinedMeta, setNirmalCombinedMeta] = useState<CombinedMeta>(null);
  const [janCombinedMeta, setJanCombinedMeta] = useState<CombinedMeta>(null);
  const [arthCombinedMeta, setArthCombinedMeta] = useState<CombinedMeta>(null);
  const [gyanCombinedMeta, setGyanCombinedMeta] = useState<CombinedMeta>(null);
  const [jeevantCombinedMeta, setJeevantCombinedMeta] = useState<CombinedMeta>(null);

  const aviralGenRef    = useRef<number | null>(null);
  const nirmalGenRef    = useRef<number | null>(null);
  const janGenRef       = useRef<number | null>(null);
  const arthGenRef      = useRef<number | null>(null);
  const gyanGenRef      = useRef<number | null>(null);
  const jeevantGenRef   = useRef<number | null>(null);
  const aviralActiveRef   = useRef(false);
  const nirmalActiveRef   = useRef(false);
  const janActiveRef      = useRef(false);
  const arthActiveRef     = useRef(false);
  const gyanActiveRef     = useRef(false);
  const jeevantActiveRef  = useRef(false);

  // Single polling effect — only polls the active module's stage, switches when module changes
  useEffect(() => {
    const stageMap: Partial<Record<string, number>> = {
      "Aviral Ganga": 0, "Nirmal Ganga": 1, "Jan Ganga": 2, "Arth Ganga": 3, "Gyan Ganga": 4, "Jeevant Ganga": 5,
    };
    const stageIndex = stageMap[activeModule];
    if (stageIndex === undefined) return; // STP Suitability — no meta polling
    let cancelled = false;
    const genRefs = [aviralGenRef, nirmalGenRef, janGenRef, arthGenRef, gyanGenRef, jeevantGenRef];
    const setters = [setCombinedMeta, setNirmalCombinedMeta, setJanCombinedMeta, setArthCombinedMeta, setGyanCombinedMeta, setJeevantCombinedMeta];
    const load = () => {
      loadPhaseMeta(stageIndex)
        .then((d) => {
          if (cancelled) return;
          const meta = d as CombinedMeta;
          const gen = meta?.generated_at ?? null;
          if (gen !== genRefs[stageIndex].current) {
            genRefs[stageIndex].current = gen;
            setters[stageIndex](meta ?? null);
            onActiveCombinedMetaChange?.(meta ?? null);
          }
        })
        .catch(() => {});
    };
    load();
    const interval = setInterval(load, 10000);
    return () => { cancelled = true; clearInterval(interval); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeModule]);

  // Helper: fetch meta if missing, then fetch the tiff. Handles the case where
  // Combined Output is clicked before the 10-second poller has run.
  const fetchTiffForStage = useCallback(async (
    stageIndex: number,
    metaSetter: (m: CombinedMeta) => void,
    tiffCallback: ((buf: ArrayBuffer | null) => void) | undefined,
    existingMeta: CombinedMeta,
  ) => {
    if (!tiffCallback) return;
    let meta = existingMeta;
    if (!meta) {
      meta = await loadPhaseMeta(stageIndex);
      if (meta) { metaSetter(meta); onActiveCombinedMetaChange?.(meta); }
    }
    if (!meta) { return; } // no saved raster for this stage
    tiffCallback(await loadPhaseTiff(stageIndex));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onActiveCombinedMetaChange]);

  // Fetch tiff when Combined Output is toggled ON or when the saved raster changes
  useEffect(() => {
    const active = aviralCriteria.includes(COMBINED_LABEL);
    aviralActiveRef.current = active;
    if (!active) { onCombinedTiffChange?.(null); return; }
    void fetchTiffForStage(0, setCombinedMeta, onCombinedTiffChange, combinedMeta);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aviralCriteria, combinedMeta]);

  useEffect(() => {
    const active = nirmalCriteria.includes(COMBINED_LABEL);
    nirmalActiveRef.current = active;
    if (!active) { onNirmalCombinedTiffChange?.(null); return; }
    void fetchTiffForStage(1, setNirmalCombinedMeta, onNirmalCombinedTiffChange, nirmalCombinedMeta);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nirmalCriteria, nirmalCombinedMeta]);

  useEffect(() => {
    const active = janCriteria.includes(COMBINED_LABEL);
    janActiveRef.current = active;
    if (!active) { onJanCombinedTiffChange?.(null); return; }
    void fetchTiffForStage(2, setJanCombinedMeta, onJanCombinedTiffChange, janCombinedMeta);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [janCriteria, janCombinedMeta]);

  useEffect(() => {
    const active = arthCriteria.includes(COMBINED_LABEL);
    arthActiveRef.current = active;
    if (!active) { onArthCombinedTiffChange?.(null); return; }
    void fetchTiffForStage(3, setArthCombinedMeta, onArthCombinedTiffChange, arthCombinedMeta);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arthCriteria, arthCombinedMeta]);

  useEffect(() => {
    const active = gyanCriteria.includes(COMBINED_LABEL);
    gyanActiveRef.current = active;
    if (!active) { onGyanCombinedTiffChange?.(null); return; }
    void fetchTiffForStage(4, setGyanCombinedMeta, onGyanCombinedTiffChange, gyanCombinedMeta);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gyanCriteria, gyanCombinedMeta]);

  useEffect(() => {
    const active = jeevantCriteria.includes(COMBINED_LABEL);
    jeevantActiveRef.current = active;
    if (!active) { onJeevantCombinedTiffChange?.(null); return; }
    void fetchTiffForStage(5, setJeevantCombinedMeta, onJeevantCombinedTiffChange, jeevantCombinedMeta);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jeevantCriteria, jeevantCombinedMeta]);

  const allZonesSelected = zones.length > 0 && zones.every((z) => selectedZones.includes(z));
  const [showToolsSection, setShowToolsSection] = useState(false);
  const [toolsSubMenu, setToolsSubMenu] = useState<"none" | "colors" | "shapes">("none");
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [selectedColor, setSelectedColor] = useState("#fde047");
  const [selectedShape, setSelectedShape] = useState<StickyNote["shape"]>("sticky");

  // Collapse tools panel once placement mode becomes active
  useEffect(() => {
    if (stickyMode) {
      setShowToolsSection(false);
      setToolsSubMenu("none");
    }
  }, [stickyMode]);

  /* X-axis only offset — touch-anywhere drag with tap-click preserved */
  const [offsetX, setOffsetX] = useState(0);
  const offsetXRef = useRef(0);
  const panelRef = useRef<HTMLDivElement>(null);

  // Mouse drag
  const mouseDragging = useRef(false);
  const mouseDragStartX = useRef(0);
  const mouseOffsetStart = useRef(0);

  const onMouseDragStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch") return; // handled by touch listeners
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("input")) return;
    mouseDragging.current = true;
    mouseDragStartX.current = e.clientX;
    mouseOffsetStart.current = offsetXRef.current;
    target.setPointerCapture(e.pointerId);
  }, []);

  const onMouseDragMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!mouseDragging.current || e.pointerType === "touch") return;
    setOffsetX(mouseOffsetStart.current + (e.clientX - mouseDragStartX.current));
  }, []);

  const onMouseDragEnd = useCallback(() => { mouseDragging.current = false; }, []);

  // Touch drag
  const touchDragging = useRef(false);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const touchOffsetStart = useRef(0);
  const touchMoved = useRef(false);

  // Keep ref in sync with state so touch handlers always see latest value
  useEffect(() => { offsetXRef.current = offsetX; }, [offsetX]);

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      touchDragging.current = true;
      touchMoved.current = false;
      touchStartX.current = e.touches[0].clientX;
      touchStartY.current = e.touches[0].clientY;
      touchOffsetStart.current = offsetXRef.current;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!touchDragging.current || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - touchStartX.current;
      const dy = e.touches[0].clientY - touchStartY.current;
      // Only start dragging when clearly horizontal (dx > threshold)
      if (!touchMoved.current) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        // If mostly vertical, let the event pass through
        if (Math.abs(dy) > Math.abs(dx)) { touchDragging.current = false; return; }
        touchMoved.current = true;
      }
      e.preventDefault();
      e.stopPropagation();
      setOffsetX(touchOffsetStart.current + dx);
    };

    const onTouchEnd = () => {
      touchDragging.current = false;
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true, capture: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false, capture: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true, capture: false });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true, capture: false });

    return () => {
      el.removeEventListener("touchstart", onTouchStart, false);
      el.removeEventListener("touchmove", onTouchMove, false);
      el.removeEventListener("touchend", onTouchEnd, false);
      el.removeEventListener("touchcancel", onTouchEnd, false);
    };
  }, []);

  // uploaded datasets appear under every module's criteria; ticking one shows it clipped to the area
  const uploadedCriteria = uploadedDatasets.length ? (
    <div style={{ marginTop: 3, paddingTop: 3, borderTop: "1px solid rgba(251,191,36,0.25)", display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#fbbf24aa" }}>Uploaded data</span>
      {uploadedDatasets.map((ds) => (
        <label key={ds.id} style={{ display: "flex", alignItems: "flex-start", gap: 6, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={visibleDatasetIds.includes(ds.id)}
            onChange={() => onToggleDataset?.(ds.id)}
            style={{ accentColor: "#fbbf24", width: 10, height: 10, flexShrink: 0, marginTop: 1 }}
          />
          <span style={{ fontSize: 9, color: "#fde68a", lineHeight: 1.3 }}>{ds.title}</span>
        </label>
      ))}
    </div>
  ) : null;

  return (
    <div
      ref={panelRef}
      className="split-master-panel pointer-events-auto absolute bottom-4 left-1/2 z-[940]"
      style={{
        width: collapsed ? "auto" : toolbar ? "min(540px, 92vw)" : "min(460px, 62vw)",
        transform: `translateX(calc(-50% + ${offsetX}px))`,
        transition: "width 0.4s ease",
        cursor: mouseDragging.current ? "grabbing" : "grab",
      }}
      onPointerDown={onMouseDragStart}
      onPointerMove={onMouseDragMove}
      onPointerUp={onMouseDragEnd}
      onPointerCancel={onMouseDragEnd}
    >
      {/* 5-dot drag indicator */}
      <div className="flex justify-center mb-1 pointer-events-none select-none">
        <div className="flex gap-1 opacity-50">
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className="block h-1 w-1 rounded-full bg-blue-300" />
          ))}
        </div>
      </div>

      {/* Show / Hide Master tab button */}
      <div className="flex justify-center">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="relative -mb-px rounded-t-xl backdrop-blur-xl transition-all hover:text-white"
          style={{
            background: "rgba(15,23,42,0.95)",
            border: "1.5px solid rgba(96,165,250,0.35)",
            borderBottom: "none",
            boxShadow: "0 0 12px 2px rgba(96,165,250,0.12)",
            padding: "6px 20px",
            fontSize: "10px",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            color: "#93c5fd",
          }}
        >
          {collapsed ? "▲ Show Master" : "▼ Hide Master"}
        </button>
      </div>

      {/* ── Panel body ── */}
      <div
        className="overflow-hidden transition-all duration-500 ease-in-out"
        style={{
          maxHeight: collapsed ? "0px" : "600px",
          opacity: collapsed ? 0 : 1,
          background: "rgba(12,17,27,0.93)",
          border: `1.5px solid ${ACCENT}50`,
          borderTop: "none",
          borderRadius: "0 0 16px 16px",
          boxShadow: [
            `0 0 0 1.5px ${ACCENT}18`,
            `0 0 24px 4px ${ACCENT}18`,
            "0 16px 40px rgba(0,0,0,0.75)",
            "inset 0 0 0 1px rgba(255,255,255,0.04)",
          ].join(", "),
          padding: collapsed ? "0 16px" : "10px 16px 12px",
          position: "relative",
        }}
      >
        {toolbar ? (
          <div ref={toolbarRef} className="mb-2 border-b border-white/10 pb-2">{toolbar}</div>
        ) : null}

        {/* Right column — Zone selector + Modules + Criteria, absolutely positioned (below the toolbar row) */}
        <div ref={rightColRef} className="absolute right-4 flex flex-col items-end gap-2" style={{ top: toolbarOffset, maxWidth: activeModule === "Aviral Ganga" ? 260 : activeModule === "Nirmal Ganga" ? 260 : activeModule === "Jan Ganga" ? 260 : activeModule === "Arth Ganga" ? 260 : activeModule === "Gyan Ganga" ? 260 : activeModule === "Jeevant Ganga" ? 260 : activeModule === "STP Suitability" ? 160 : 140 }}>

          {/* ── Zone selector ── */}
          <div className="w-full" ref={zoneDropdownRef}>
            <p className="mb-1 text-right text-[10px] font-semibold uppercase tracking-widest text-blue-400/70">Step 1 · Choose Zone</p>
            {/* Dropdown trigger */}
            <button
              type="button"
              onClick={() => setShowZoneDropdown((p) => !p)}
              title="Click to pick one or more zones"
              style={{
                width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6,
                background: showZoneDropdown ? "rgba(96,165,250,0.15)" : "rgba(255,255,255,0.07)",
                border: `1px solid ${selectedZones.length > 0 || hasDrawnArea ? "rgba(96,165,250,0.6)" : "rgba(251,191,36,0.6)"}`,
                borderRadius: 7, padding: "5px 9px", fontSize: 11, fontWeight: 600, color: "#e2e8f0", cursor: "pointer",
              }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {selectedZones.length > 0
                  ? `Zones: ${selectedZones.length === zones.length ? "All" : selectedZones.join(", ")}${hasDrawnArea ? " + drawn area" : ""}`
                  : hasDrawnArea ? "Drawn area (add zones to narrow)" : "Click to select zones"}
              </span>
              <span style={{ fontSize: 10, color: "#93c5fd", flexShrink: 0 }}>{showZoneDropdown ? "▲" : "▼"}</span>
            </button>

            {/* Dropdown list */}
            {showZoneDropdown && zones.length > 0 && (
              <div style={{
                marginTop: 2, background: "rgba(15,23,42,0.97)", border: "1px solid rgba(96,165,250,0.3)",
                borderRadius: 7, overflow: "hidden",
              }}>
                {/* Select all row */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 8px", borderBottom: "1px solid rgba(96,165,250,0.15)" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={allZonesSelected}
                      onChange={() => allZonesSelected ? onClearZones?.() : onSelectAllZones?.()}
                      style={{ accentColor: "#60a5fa", width: 12, height: 12 }}
                    />
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#93c5fd" }}>Select all</span>
                  </label>
                  {selectedZones.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onClearZones?.()}
                      style={{ fontSize: 9, color: "#f87171", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                    >
                      Clear
                    </button>
                  )}
                </div>
                <p style={{ margin: 0, padding: "3px 8px 0", fontSize: 9, color: "#94a3b8" }}>Tap a zone to select / unselect</p>
                {/* Horizontal zone chips */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 3, padding: "4px 8px" }}>
                  {zones.map((zone) => {
                    const checked = selectedZones.includes(zone);
                    return (
                      <button
                        key={zone}
                        type="button"
                        onClick={() => onZoneToggle?.(zone)}
                        style={{
                          minWidth: 30, height: 22, padding: "0 5px", display: "flex", alignItems: "center", justifyContent: "center", gap: 2,
                          borderRadius: 6, fontSize: 10, fontWeight: 600, flexShrink: 0,
                          cursor: "pointer", border: "1px solid",
                          borderColor: checked ? "rgba(96,165,250,0.9)" : "rgba(148,163,184,0.25)",
                          background: checked ? "rgba(59,130,246,0.45)" : "rgba(255,255,255,0.05)",
                          color: checked ? "#fff" : "#94a3b8",
                          transition: "all 0.15s",
                        }}
                      >
                        {checked ? "✓ " : ""}{zone}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* ── Modules + Criteria side-by-side ── */}
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start", justifyContent: "flex-end", width: "100%" }}>

            {/* Criteria — left of modules, only when Aviral Ganga active */}
            {activeModule === "Aviral Ganga" && (
              <div style={{ flexShrink: 1, minWidth: 0, maxWidth: 130 }}>
                <p style={{ margin: "0 0 4px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#60a5fa99" }}>Criteria</p>
                {selectedZones.length === 0 && !hasDrawnArea ? (
                  <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(96,165,250,0.15)", borderRadius: 7, padding: "7px 10px" }}>
                    <span style={{ fontSize: 9, color: "#64748b", fontStyle: "italic" }}>Select zones first</span>
                  </div>
                ) : (
                  <div className="split-modules-scroll" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(96,165,250,0.2)", borderRadius: 7, padding: "3px 5px", display: "flex", flexDirection: "column", gap: 2, maxHeight: 130, overflowY: "auto" }}>
                    {AVIRAL_CRITERIA.map((criterion) => (
                      <label key={criterion} style={{ display: "flex", alignItems: "flex-start", gap: 6, cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={aviralCriteria.includes(criterion)}
                          onChange={() => {
                            const withoutCombined = aviralCriteria.filter((c: string) => c !== COMBINED_LABEL);
                            const next = withoutCombined.includes(criterion)
                              ? withoutCombined.filter((c: string) => c !== criterion)
                              : [...withoutCombined, criterion];
                            onAviralCriteriaChange?.(next);
                          }}
                          style={{ accentColor: "#60a5fa", width: 10, height: 10, flexShrink: 0, marginTop: 1 }}
                        />
                        <span style={{ fontSize: 9, color: "#cbd5e1", lineHeight: 1.3 }}>{criterion}</span>
                      </label>
                    ))}
                    {uploadedCriteria}
                    {combinedMeta && (
                      <label style={{ display: "flex", alignItems: "flex-start", gap: 6, cursor: "pointer", marginTop: 3, paddingTop: 3, borderTop: "1px solid rgba(96,165,250,0.2)" }}>
                        <input
                          type="checkbox"
                          checked={aviralCriteria.includes(COMBINED_LABEL)}
                          onChange={() => {
                            const next = aviralCriteria.includes(COMBINED_LABEL)
                              ? aviralCriteria.filter((c: string) => c !== COMBINED_LABEL)
                              : [COMBINED_LABEL]; // uncheck all others
                            onAviralCriteriaChange?.(next);
                          }}
                          style={{ accentColor: "#34d399", width: 10, height: 10, flexShrink: 0, marginTop: 1 }}
                        />
                        <span style={{ fontSize: 9, color: "#34d399", lineHeight: 1.3, fontWeight: 700 }}>
                          ⬡ {COMBINED_LABEL}
                          <span style={{ display: "block", fontSize: 8, fontWeight: 400, color: "#94a3b8" }}>
                            {combinedMeta.criteria.length} criteria · from Holistic
                          </span>
                        </span>
                      </label>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Criteria — left of modules, only when Nirmal Ganga active */}
            {activeModule === "Nirmal Ganga" && (
              <div style={{ flexShrink: 1, minWidth: 0, maxWidth: 130 }}>
                <p style={{ margin: "0 0 4px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#a78bfa99" }}>Criteria</p>
                {selectedZones.length === 0 && !hasDrawnArea ? (
                  <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(167,139,250,0.15)", borderRadius: 7, padding: "7px 10px" }}>
                    <span style={{ fontSize: 9, color: "#64748b", fontStyle: "italic" }}>Select zones first</span>
                  </div>
                ) : (
                  <div className="split-modules-scroll" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(167,139,250,0.2)", borderRadius: 7, padding: "3px 5px", display: "flex", flexDirection: "column", gap: 2, maxHeight: 130, overflowY: "auto" }}>
                    {NIRMAL_CRITERIA.map((criterion) => (
                      <label key={criterion} style={{ display: "flex", alignItems: "flex-start", gap: 6, cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={nirmalCriteria.includes(criterion)}
                          onChange={() => {
                            const withoutCombined = nirmalCriteria.filter((c: string) => c !== COMBINED_LABEL);
                            const next = withoutCombined.includes(criterion)
                              ? withoutCombined.filter((c: string) => c !== criterion)
                              : [...withoutCombined, criterion];
                            onNirmalCriteriaChange?.(next);
                          }}
                          style={{ accentColor: "#a78bfa", width: 10, height: 10, flexShrink: 0, marginTop: 1 }}
                        />
                        <span style={{ fontSize: 9, color: "#cbd5e1", lineHeight: 1.3 }}>{criterion}</span>
                      </label>
                    ))}
                    {uploadedCriteria}
                    {nirmalCombinedMeta && (
                      <label style={{ display: "flex", alignItems: "flex-start", gap: 6, cursor: "pointer", marginTop: 3, paddingTop: 3, borderTop: "1px solid rgba(167,139,250,0.2)" }}>
                        <input
                          type="checkbox"
                          checked={nirmalCriteria.includes(COMBINED_LABEL)}
                          onChange={() => {
                            const next = nirmalCriteria.includes(COMBINED_LABEL)
                              ? nirmalCriteria.filter((c: string) => c !== COMBINED_LABEL)
                              : [COMBINED_LABEL]; // uncheck all others
                            onNirmalCriteriaChange?.(next);
                          }}
                          style={{ accentColor: "#34d399", width: 10, height: 10, flexShrink: 0, marginTop: 1 }}
                        />
                        <span style={{ fontSize: 9, color: "#34d399", lineHeight: 1.3, fontWeight: 700 }}>
                          ⬡ {COMBINED_LABEL}
                          <span style={{ display: "block", fontSize: 8, fontWeight: 400, color: "#94a3b8" }}>
                            {nirmalCombinedMeta.criteria.length} criteria · from Holistic
                          </span>
                        </span>
                      </label>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Jan Ganga criteria panel */}
            {activeModule === "Jan Ganga" && (
              <div style={{ flexShrink: 1, minWidth: 0, maxWidth: 130 }}>
                <p style={{ margin: "0 0 4px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#34d39999" }}>Criteria</p>
                {selectedZones.length === 0 && !hasDrawnArea ? (
                  <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(52,211,153,0.15)", borderRadius: 7, padding: "7px 10px" }}>
                    <span style={{ fontSize: 9, color: "#64748b", fontStyle: "italic" }}>Select zones first</span>
                  </div>
                ) : (
                  <div className="split-modules-scroll" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(52,211,153,0.2)", borderRadius: 7, padding: "3px 5px", display: "flex", flexDirection: "column", gap: 2, maxHeight: 130, overflowY: "auto" }}>
                    {JAN_CRITERIA.map((criterion) => (
                      <label key={criterion} style={{ display: "flex", alignItems: "flex-start", gap: 6, cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={janCriteria.includes(criterion)}
                          onChange={() => {
                            const withoutCombined = janCriteria.filter((c: string) => c !== COMBINED_LABEL);
                            const next = withoutCombined.includes(criterion)
                              ? withoutCombined.filter((c: string) => c !== criterion)
                              : [...withoutCombined, criterion];
                            onJanCriteriaChange?.(next);
                          }}
                          style={{ accentColor: "#34d399", width: 10, height: 10, flexShrink: 0, marginTop: 1 }}
                        />
                        <span style={{ fontSize: 9, color: "#cbd5e1", lineHeight: 1.3 }}>{criterion}</span>
                      </label>
                    ))}
                    {uploadedCriteria}
                    {janCombinedMeta && (
                      <label style={{ display: "flex", alignItems: "flex-start", gap: 6, cursor: "pointer", marginTop: 3, paddingTop: 3, borderTop: "1px solid rgba(52,211,153,0.2)" }}>
                        <input
                          type="checkbox"
                          checked={janCriteria.includes(COMBINED_LABEL)}
                          onChange={() => {
                            const next = janCriteria.includes(COMBINED_LABEL)
                              ? janCriteria.filter((c: string) => c !== COMBINED_LABEL)
                              : [COMBINED_LABEL];
                            onJanCriteriaChange?.(next);
                          }}
                          style={{ accentColor: "#34d399", width: 10, height: 10, flexShrink: 0, marginTop: 1 }}
                        />
                        <span style={{ fontSize: 9, color: "#34d399", lineHeight: 1.3, fontWeight: 700 }}>
                          ⬡ {COMBINED_LABEL}
                          <span style={{ display: "block", fontSize: 8, fontWeight: 400, color: "#94a3b8" }}>
                            {janCombinedMeta.criteria.length} criteria · from Holistic
                          </span>
                        </span>
                      </label>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Arth Ganga criteria panel */}
            {activeModule === "Arth Ganga" && (
              <div style={{ flexShrink: 1, minWidth: 0, maxWidth: 130 }}>
                <p style={{ margin: "0 0 4px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#fb923c99" }}>Criteria</p>
                {selectedZones.length === 0 && !hasDrawnArea ? (
                  <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(251,146,60,0.15)", borderRadius: 7, padding: "7px 10px" }}>
                    <span style={{ fontSize: 9, color: "#64748b", fontStyle: "italic" }}>Select zones first</span>
                  </div>
                ) : (
                  <div className="split-modules-scroll" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(251,146,60,0.2)", borderRadius: 7, padding: "3px 5px", display: "flex", flexDirection: "column", gap: 2, maxHeight: 130, overflowY: "auto" }}>
                    {ARTH_CRITERIA.map((criterion) => (
                      <label key={criterion} style={{ display: "flex", alignItems: "flex-start", gap: 6, cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={arthCriteria.includes(criterion)}
                          onChange={() => {
                            const withoutCombined = arthCriteria.filter((c: string) => c !== COMBINED_LABEL);
                            const next = withoutCombined.includes(criterion)
                              ? withoutCombined.filter((c: string) => c !== criterion)
                              : [...withoutCombined, criterion];
                            onArthCriteriaChange?.(next);
                          }}
                          style={{ accentColor: "#fb923c", width: 10, height: 10, flexShrink: 0, marginTop: 1 }}
                        />
                        <span style={{ fontSize: 9, color: "#cbd5e1", lineHeight: 1.3 }}>{criterion}</span>
                      </label>
                    ))}
                    {uploadedCriteria}
                    {arthCombinedMeta && (
                      <label style={{ display: "flex", alignItems: "flex-start", gap: 6, cursor: "pointer", marginTop: 3, paddingTop: 3, borderTop: "1px solid rgba(251,146,60,0.2)" }}>
                        <input
                          type="checkbox"
                          checked={arthCriteria.includes(COMBINED_LABEL)}
                          onChange={() => {
                            const next = arthCriteria.includes(COMBINED_LABEL)
                              ? arthCriteria.filter((c: string) => c !== COMBINED_LABEL)
                              : [COMBINED_LABEL];
                            onArthCriteriaChange?.(next);
                          }}
                          style={{ accentColor: "#34d399", width: 10, height: 10, flexShrink: 0, marginTop: 1 }}
                        />
                        <span style={{ fontSize: 9, color: "#34d399", lineHeight: 1.3, fontWeight: 700 }}>
                          ⬡ {COMBINED_LABEL}
                          <span style={{ display: "block", fontSize: 8, fontWeight: 400, color: "#94a3b8" }}>
                            {arthCombinedMeta.criteria.length} criteria · from Holistic
                          </span>
                        </span>
                      </label>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Gyan Ganga criteria panel */}
            {activeModule === "Gyan Ganga" && (
              <div style={{ flexShrink: 1, minWidth: 0, maxWidth: 130 }}>
                <p style={{ margin: "0 0 4px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#22d3ee99" }}>Criteria</p>
                {selectedZones.length === 0 && !hasDrawnArea ? (
                  <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(34,211,238,0.15)", borderRadius: 7, padding: "7px 10px" }}>
                    <span style={{ fontSize: 9, color: "#64748b", fontStyle: "italic" }}>Select zones first</span>
                  </div>
                ) : (
                  <div className="split-modules-scroll" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(34,211,238,0.2)", borderRadius: 7, padding: "3px 5px", display: "flex", flexDirection: "column", gap: 2, maxHeight: 130, overflowY: "auto" }}>
                    {GYAN_CRITERIA.map((criterion) => (
                      <label key={criterion} style={{ display: "flex", alignItems: "flex-start", gap: 6, cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={gyanCriteria.includes(criterion)}
                          onChange={() => {
                            const withoutCombined = gyanCriteria.filter((c: string) => c !== COMBINED_LABEL);
                            const next = withoutCombined.includes(criterion)
                              ? withoutCombined.filter((c: string) => c !== criterion)
                              : [...withoutCombined, criterion];
                            onGyanCriteriaChange?.(next);
                          }}
                          style={{ accentColor: "#22d3ee", width: 10, height: 10, flexShrink: 0, marginTop: 1 }}
                        />
                        <span style={{ fontSize: 9, color: "#cbd5e1", lineHeight: 1.3 }}>{criterion}</span>
                      </label>
                    ))}
                    {uploadedCriteria}
                    {gyanCombinedMeta && (
                      <label style={{ display: "flex", alignItems: "flex-start", gap: 6, cursor: "pointer", marginTop: 3, paddingTop: 3, borderTop: "1px solid rgba(34,211,238,0.2)" }}>
                        <input
                          type="checkbox"
                          checked={gyanCriteria.includes(COMBINED_LABEL)}
                          onChange={() => {
                            const next = gyanCriteria.includes(COMBINED_LABEL)
                              ? gyanCriteria.filter((c: string) => c !== COMBINED_LABEL)
                              : [COMBINED_LABEL];
                            onGyanCriteriaChange?.(next);
                          }}
                          style={{ accentColor: "#34d399", width: 10, height: 10, flexShrink: 0, marginTop: 1 }}
                        />
                        <span style={{ fontSize: 9, color: "#34d399", lineHeight: 1.3, fontWeight: 700 }}>
                          ⬡ {COMBINED_LABEL}
                          <span style={{ display: "block", fontSize: 8, fontWeight: 400, color: "#94a3b8" }}>
                            {gyanCombinedMeta.criteria.length} criteria · from Holistic
                          </span>
                        </span>
                      </label>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Jeevant Ganga criteria panel */}
            {activeModule === "Jeevant Ganga" && (
              <div style={{ flexShrink: 1, minWidth: 0, maxWidth: 130 }}>
                <p style={{ margin: "0 0 4px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#4ade8099" }}>Criteria</p>
                {selectedZones.length === 0 && !hasDrawnArea ? (
                  <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(74,222,128,0.15)", borderRadius: 7, padding: "7px 10px" }}>
                    <span style={{ fontSize: 9, color: "#64748b", fontStyle: "italic" }}>Select zones first</span>
                  </div>
                ) : (
                  <div className="split-modules-scroll" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(74,222,128,0.2)", borderRadius: 7, padding: "3px 5px", display: "flex", flexDirection: "column", gap: 2, maxHeight: 130, overflowY: "auto" }}>
                    {JEEVANT_CRITERIA.map((criterion) => (
                      <label key={criterion} style={{ display: "flex", alignItems: "flex-start", gap: 6, cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={jeevantCriteria.includes(criterion)}
                          onChange={() => {
                            const withoutCombined = jeevantCriteria.filter((c: string) => c !== COMBINED_LABEL);
                            const next = withoutCombined.includes(criterion)
                              ? withoutCombined.filter((c: string) => c !== criterion)
                              : [...withoutCombined, criterion];
                            onJeevantCriteriaChange?.(next);
                          }}
                          style={{ accentColor: "#4ade80", width: 10, height: 10, flexShrink: 0, marginTop: 1 }}
                        />
                        <span style={{ fontSize: 9, color: "#cbd5e1", lineHeight: 1.3 }}>{criterion}</span>
                      </label>
                    ))}
                    {uploadedCriteria}
                    {jeevantCombinedMeta && (
                      <label style={{ display: "flex", alignItems: "flex-start", gap: 6, cursor: "pointer", marginTop: 3, paddingTop: 3, borderTop: "1px solid rgba(74,222,128,0.2)" }}>
                        <input
                          type="checkbox"
                          checked={jeevantCriteria.includes(COMBINED_LABEL)}
                          onChange={() => {
                            const next = jeevantCriteria.includes(COMBINED_LABEL)
                              ? jeevantCriteria.filter((c: string) => c !== COMBINED_LABEL)
                              : [COMBINED_LABEL];
                            onJeevantCriteriaChange?.(next);
                          }}
                          style={{ accentColor: "#34d399", width: 10, height: 10, flexShrink: 0, marginTop: 1 }}
                        />
                        <span style={{ fontSize: 9, color: "#34d399", lineHeight: 1.3, fontWeight: 700 }}>
                          ⬡ {COMBINED_LABEL}
                          <span style={{ display: "block", fontSize: 8, fontWeight: 400, color: "#94a3b8" }}>
                            {jeevantCombinedMeta.criteria.length} criteria · from Holistic
                          </span>
                        </span>
                      </label>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Modules — always on the right */}
            <div style={{ flexShrink: 0, minWidth: 0 }}>
              <p style={{ margin: "0 0 4px", textAlign: "right", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#60a5fa99" }}>Modules</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, height: "120px", overflowY: "scroll", overflowX: "hidden", paddingBottom: 4 }} className="split-modules-scroll">
                {(["Aviral Ganga", "Nirmal Ganga", "Jan Ganga", "Arth Ganga", "Gyan Ganga", "Jeevant Ganga", "STP Suitability"] as const).map((moduleName) => (
                  <button
                    key={moduleName}
                    type="button"
                    onClick={() => onActiveModuleChange(moduleName)}
                    className={`rounded-lg px-3 py-2 text-[11px] font-bold transition-all ${
                      activeModule === moduleName
                        ? moduleName === "STP Suitability"
                          ? "bg-blue-500/20 text-blue-200 ring-1 ring-blue-400/40"
                          : moduleName === "Nirmal Ganga"
                          ? "bg-violet-500/20 text-violet-200 ring-1 ring-violet-400/40"
                          : moduleName === "Jan Ganga"
                          ? "bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/40"
                          : moduleName === "Arth Ganga"
                          ? "bg-orange-500/20 text-orange-200 ring-1 ring-orange-400/40"
                          : moduleName === "Gyan Ganga"
                          ? "bg-cyan-500/20 text-cyan-200 ring-1 ring-cyan-400/40"
                          : moduleName === "Jeevant Ganga"
                          ? "bg-green-500/20 text-green-200 ring-1 ring-green-400/40"
                          : "bg-sky-500/20 text-sky-200 ring-1 ring-sky-400/40"
                        : "bg-white/5 text-slate-300 ring-1 ring-white/5 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    {moduleName}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Left content — padded right to stay clear of the absolute right column */}
        <div style={{ minHeight: rightColHeight, paddingRight: activeModule === "Aviral Ganga" ? 270 : activeModule === "Nirmal Ganga" ? 270 : activeModule === "Jan Ganga" ? 270 : activeModule === "Arth Ganga" ? 270 : activeModule === "Gyan Ganga" ? 270 : activeModule === "Jeevant Ganga" ? 270 : activeModule === "STP Suitability" ? 170 : 150 }}>

        {/* Row 1: Screens — single toggle + expand */}
        {(() => {
          const anyOn = SCREEN_SIDES.some(s => visibleScreens[s]);
          return (
            <div className="mb-2">
              {/* First row: toggle + expand button */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onSetAllScreens(!anyOn)}
                  style={{
                    padding: "3px 10px", fontSize: 10, fontWeight: 700, borderRadius: 6,
                    border: "1px solid",
                    borderColor: anyOn ? "rgba(239,68,68,0.45)" : "rgba(52,211,153,0.45)",
                    background: anyOn ? "rgba(239,68,68,0.15)" : "rgba(52,211,153,0.15)",
                    color: anyOn ? "#fca5a5" : "#6ee7b7",
                    cursor: "pointer", transition: "all 0.2s", whiteSpace: "nowrap" as const,
                  }}
                >
                  {anyOn ? "Hide Screen" : "Show Screen"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowScreensDropdown(v => !v)}
                  title="Toggle individual screens"
                  style={{
                    padding: "3px 7px", fontSize: 9, fontWeight: 700, borderRadius: 6,
                    border: "1px solid rgba(96,165,250,0.3)",
                    background: showScreensDropdown ? "rgba(96,165,250,0.15)" : "rgba(255,255,255,0.05)",
                    color: showScreensDropdown ? "#93c5fd" : "#64748b",
                    cursor: "pointer", transition: "all 0.2s",
                  }}
                >
                  {showScreensDropdown ? "▲" : "▼"}
                </button>
              </div>

              {/* Second row: individual pills — only when expanded */}
              {showScreensDropdown && (
                <div className="flex items-center gap-1.5 mt-1.5">
                  {SCREEN_SIDES.map((side, idx) => {
                    const on = visibleScreens[side] ?? false;
                    return (
                      <button
                        key={side}
                        type="button"
                        onClick={() => onToggleScreen(side)}
                        title={screenNames[side] ?? side}
                        style={{
                          width: 22, height: 22, borderRadius: 5, fontSize: 9, fontWeight: 800,
                          border: "1px solid",
                          borderColor: on ? "rgba(52,211,153,0.5)" : "rgba(148,163,184,0.2)",
                          background: on ? "rgba(52,211,153,0.2)" : "rgba(255,255,255,0.04)",
                          color: on ? "#6ee7b7" : "#475569",
                          cursor: "pointer", transition: "all 0.15s",
                          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                        }}
                      >
                        {idx + 1}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}

        {/* Row 2a: Basemap — own row so height doesn't inflate due to modules */}
        <div className="mb-2 flex items-center gap-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-blue-400/70">Basemap</p>
          <select
            value={basemap}
            onChange={(e) => onBasemapChange(e.target.value as BasemapType)}
            title="Change basemap"
            className="rounded-md bg-white/10 px-2 py-1 text-[10px] font-semibold text-white ring-1 ring-blue-400/30 hover:bg-white/20 focus:outline-none"
          >
            {basemapOptions.map((opt) => (
              <option key={opt.key} value={opt.key} className="bg-slate-900 text-white">
                {opt.label}
              </option>
            ))}
          </select>
        </div>


        {/* Row 3: Viewer size */}
        <div className="mb-2">
          <div className="flex items-center gap-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-blue-400/70 shrink-0">
              Viewer Size
            </p>
            <button
              type="button"
              onClick={() => setShowViewerSize((p) => !p)}
              className="rounded-md bg-white/10 px-2 py-1 text-[10px] font-semibold text-white hover:bg-white/20 shrink-0"
            >
              {showViewerSize ? "Hide" : "Show"}
            </button>
          </div>
          {showViewerSize ? (
            <div className="mt-3 flex items-center gap-3">
              <input
                type="range"
                min={70}
                max={130}
                step={1}
                value={Math.round(viewerScale * 100)}
                onChange={(e) => onViewerScaleChange(Number(e.target.value) / 100)}
                className="w-[180px] accent-cyan-400"
              />
              <span className="text-[11px] font-bold text-cyan-300 tabular-nums shrink-0">
                {Math.round(viewerScale * 100)}%
              </span>
            </div>
          ) : null}
        </div>

        {/* Row 4: Tools (main map note/shape placement) */}
        <div>
          <div className="flex items-center gap-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-blue-400/70 shrink-0">
              Tools
            </p>
            <button
              type="button"
              onClick={() => {
                setShowToolsSection((p) => !p);
                setToolsSubMenu("none");
              }}
              className="rounded-md bg-white/10 px-2 py-1 text-[10px] font-semibold text-white hover:bg-white/20 shrink-0"
            >
              {showToolsSection ? "Hide" : "Show"}
            </button>
            {stickyMode && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold text-emerald-300 animate-pulse">
                  ● Click map to place
                </span>
                <button
                  type="button"
                  onClick={onCancelTool}
                  className="rounded-md bg-red-500/20 px-2 py-1 text-[10px] font-semibold text-red-300 ring-1 ring-red-500/40 hover:bg-red-500/30"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          {showToolsSection && !stickyMode ? (
            <div className="mt-2">
              <div
                style={{
                  display: "inline-flex",
                  flexDirection: "column",
                  padding: "6px",
                  borderRadius: 10,
                  background: "rgba(255,255,255,0.07)",
                  border: "1px solid rgba(96,165,250,0.2)",
                  gap: 5,
                  width: "fit-content",
                }}
              >
                {/* Icon row: sticky | text | shapes | edit screen names */}
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <button
                    type="button"
                    title="Sticky Note"
                    onClick={() => setToolsSubMenu(toolsSubMenu === "colors" ? "none" : "colors")}
                    style={{
                      width: 32, height: 32, borderRadius: 7,
                      border: toolsSubMenu === "colors" ? "2px solid #60a5fa" : "1px solid rgba(148,163,184,.4)",
                      background: toolsSubMenu === "colors" ? "rgba(96,165,250,0.18)" : "rgba(255,255,255,0.08)",
                      display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                    }}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#93c5fd" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5Z"/>
                      <path d="M15 3v6h6"/>
                    </svg>
                  </button>

                  <button
                    type="button"
                    title="Text label"
                    onClick={() => {
                      setSelectedShape("text");
                      setSelectedColor("transparent");
                      onToolSelect?.("transparent", "text");
                    }}
                    style={{
                      width: 32, height: 32, borderRadius: 7,
                      border: "1px solid rgba(148,163,184,.4)",
                      background: "rgba(255,255,255,0.08)",
                      display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                    }}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#93c5fd" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="4 7 4 4 20 4 20 7"/>
                      <line x1="9" y1="20" x2="15" y2="20"/>
                      <line x1="12" y1="4" x2="12" y2="20"/>
                    </svg>
                  </button>

                  <button
                    type="button"
                    title="Shapes"
                    onClick={() => setToolsSubMenu(toolsSubMenu === "shapes" ? "none" : "shapes")}
                    style={{
                      width: 32, height: 32, borderRadius: 7,
                      border: toolsSubMenu === "shapes" ? "2px solid #60a5fa" : "1px solid rgba(148,163,184,.4)",
                      background: toolsSubMenu === "shapes" ? "rgba(96,165,250,0.18)" : "rgba(255,255,255,0.08)",
                      display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                    }}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#93c5fd" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="2" width="9" height="9"/>
                      <circle cx="17.5" cy="6.5" r="3.5"/>
                      <polygon points="2,22 11,22 6.5,14"/>
                      <polygon points="13,18 22,22 18,13"/>
                    </svg>
                  </button>

                  {/* Reset button — inline with other tools */}
                  <button
                    type="button"
                    title="Reset (reload page)"
                    onClick={() => setShowResetConfirm(true)}
                    style={{
                      width: 32, height: 32, borderRadius: 7,
                      border: "1px solid rgba(239,68,68,0.4)",
                      background: "rgba(239,68,68,0.12)",
                      display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fca5a5" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                      <path d="M3 3v5h5"/>
                    </svg>
                  </button>

                </div>

                {/* Color swatches for sticky note */}
                {toolsSubMenu === "colors" && (
                  <div style={{ display: "flex", gap: 6, paddingLeft: 2 }}>
                    {["#fde047", "#fb7185", "#93c5fd"].map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => {
                          setSelectedShape("sticky");
                          setSelectedColor(color);
                          onToolSelect?.(color, "sticky");
                        }}
                        style={{
                          width: 24, height: 24, borderRadius: 5,
                          border: selectedColor === color && selectedShape === "sticky"
                            ? "2px solid #fff"
                            : "1px solid rgba(148,163,184,.4)",
                          background: color, cursor: "pointer",
                        }}
                      />
                    ))}
                  </div>
                )}

                {/* Shape picker */}
                {toolsSubMenu === "shapes" && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", paddingLeft: 2 }}>
                    {(["rect", "oval", "rhombus", "triangle"] as const).map((shape) => (
                      <button
                        key={shape}
                        type="button"
                        title={shape}
                        onClick={() => {
                          setSelectedShape(shape);
                          setSelectedColor("#ffffff");
                          onToolSelect?.("#ffffff", shape);
                        }}
                        style={{
                          width: 28, height: 28, borderRadius: 5,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          border: selectedShape === shape
                            ? "2px solid #60a5fa"
                            : "1px solid rgba(148,163,184,.4)",
                          background: "rgba(255,255,255,0.08)", cursor: "pointer",
                        }}
                      >
                        {shape === "rect" && <div style={{ width: 14, height: 9, border: "2px solid #93c5fd" }} />}
                        {shape === "oval" && <div style={{ width: 14, height: 9, border: "2px solid #93c5fd", borderRadius: "50%" }} />}
                        {shape === "rhombus" && <div style={{ width: 9, height: 9, border: "2px solid #93c5fd", transform: "rotate(45deg)" }} />}
                        {shape === "triangle" && (
                          <svg width="13" height="11" viewBox="0 0 13 11">
                            <polygon points="6.5,1 12,10 1,10" fill="none" stroke="#93c5fd" strokeWidth="2" />
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                )}

              </div>
            </div>
          ) : null}
        </div>
        {/* end left content wrapper */}
        </div>
      </div>

      {/* Reset confirmation modal */}
      {showResetConfirm && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 9999,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
          }}
        >
          <div
            style={{
              background: "#1e1b3a",
              border: "1px solid rgba(239,68,68,0.4)",
              borderRadius: 16,
              padding: "28px 32px",
              width: 320,
              boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 16,
            }}
          >
            {/* Icon */}
            <div style={{ width: 48, height: 48, borderRadius: "50%", background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fca5a5" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                <path d="M3 3v5h5"/>
              </svg>
            </div>
            {/* Title */}
            <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#f1f5f9", textAlign: "center" }}>
              Confirm Reset
            </p>
            {/* Body */}
            <p style={{ margin: 0, fontSize: 12, color: "#94a3b8", textAlign: "center", lineHeight: 1.6 }}>
              All data will be cleared and the page will reload. This action cannot be undone.
            </p>
            {/* Buttons */}
            <div style={{ display: "flex", gap: 12, width: "100%", marginTop: 4 }}>
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                style={{
                  flex: 1, padding: "9px 0", borderRadius: 8,
                  background: "rgba(255,255,255,0.07)", border: "1px solid rgba(148,163,184,0.3)",
                  color: "#cbd5e1", fontSize: 13, fontWeight: 600, cursor: "pointer",
                }}
              >
                No
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                style={{
                  flex: 1, padding: "9px 0", borderRadius: 8,
                  background: "rgba(239,68,68,0.2)", border: "1px solid rgba(239,68,68,0.5)",
                  color: "#fca5a5", fontSize: 13, fontWeight: 700, cursor: "pointer",
                }}
              >
                Yes, Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
