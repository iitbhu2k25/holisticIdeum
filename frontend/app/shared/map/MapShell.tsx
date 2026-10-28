"use client";

import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import {
  Expand, Home, Layers, Map as MapIcon, Minus, Pentagon, Plus, Shrink, Square, Trash2,
} from "lucide-react";
import type { BasemapType } from "../types";
import { BASEMAP_TILES } from "../types";
import DrawLayer, { DrawMode, DrawnShape } from "./DrawLayer";

export type MapTool = "layers" | "basemap" | "home" | "fullscreen" | "draw" | "zoom" | "coords" | "scale";
export const ALL_TOOLS: MapTool[] = ["layers", "basemap", "home", "fullscreen", "draw", "zoom", "coords", "scale"];

const INDIA_CENTER: [number, number] = [22.5937, 78.9629];
const INDIA_ZOOM = 5;

const BASEMAPS: { key: BasemapType; label: string }[] = [
  { key: "terrain", label: "Terrain" },
  { key: "satellite", label: "Satellite" },
  { key: "streets", label: "Streets" },
  { key: "dark", label: "Dark" },
];

/** Imperative map actions for hosts that render their own controls (e.g. the Split master panel). */
export type MapControls = {
  fitHome: () => void;
  toggleFullscreen: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
};

export type MapShellProps = {
  basemap?: BasemapType;
  onBasemapChange?: (basemap: BasemapType) => void;
  showBasemap?: boolean;
  interactive?: boolean;
  /** Which controls to show on the right-hand rail; false hides the rail (e.g. thumbnail maps). */
  tools?: MapTool[] | false;
  /** Extent for the "fit" button. */
  homeExtent?: GeoJSON.GeoJsonObject | null;
  drawnShape?: DrawnShape | null;
  onDrawnShapeChange?: (shape: DrawnShape | null) => void;
  /** Contents of the layers pop-over (layer toggles, legends …). */
  layersPanel?: ReactNode;
  /** Controlled draw mode; leave unset to let the rail manage it. */
  drawMode?: DrawMode;
  onDrawModeChange?: (mode: DrawMode) => void;
  onControls?: (controls: MapControls) => void;
  className?: string;
  children?: ReactNode;
};

/** Re-measure when the container is resized by panels opening/closing. */
function MapResizer() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    let last = `${container.offsetWidth}x${container.offsetHeight}`;
    const ro = new ResizeObserver(() => {
      const size = `${container.offsetWidth}x${container.offsetHeight}`;
      if (size !== last) {
        last = size;
        map.invalidateSize(false);
      }
    });
    ro.observe(container);
    const t = setTimeout(() => map.invalidateSize(false), 100);
    return () => {
      clearTimeout(t);
      ro.disconnect();
    };
  }, [map]);
  return null;
}

function ScaleBar() {
  const map = useMap();
  useEffect(() => {
    const control = L.control.scale({ position: "bottomleft", imperial: false, maxWidth: 140 }).addTo(map);
    return () => {
      control.remove();
    };
  }, [map]);
  return null;
}

function CoordinateReadout({ map }: { map: L.Map }) {
  const [pos, setPos] = useState<L.LatLng | null>(null);
  useEffect(() => {
    const move = (e: L.LeafletMouseEvent) => setPos(e.latlng);
    const out = () => setPos(null);
    map.on("mousemove", move);
    map.on("mouseout", out);
    return () => {
      map.off("mousemove", move);
      map.off("mouseout", out);
    };
  }, [map]);
  return (
    <div className="pointer-events-none absolute bottom-2 right-14 z-[800] rounded-md bg-white/90 px-2 py-1 font-mono text-[11px] text-slate-600 shadow-sm ring-1 ring-slate-200">
      {pos ? `Lat ${pos.lat.toFixed(5)}, Lng ${pos.lng.toFixed(5)}` : "Lat --, Lng --"}
    </div>
  );
}

function RailButton({
  title, active, disabled, onClick, children,
}: { title: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-9 w-9 items-center justify-center rounded-full shadow-md ring-1 transition disabled:opacity-40 ${
        active ? "bg-emerald-700 text-white ring-emerald-800" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}

function Popover({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="absolute right-14 top-0 z-[1000] w-72 max-w-[70vw] overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-slate-200">
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{title}</span>
        <button type="button" onClick={onClose} className="text-xs text-slate-400 hover:text-slate-700" aria-label="Close">✕</button>
      </div>
      <div className="max-h-[60vh] overflow-y-auto p-3">{children}</div>
    </div>
  );
}

/**
 * The one map used across the app: basemap, a tool rail (layers, basemap, fit, fullscreen,
 * polygon / rectangle drawing, zoom), coordinate read-out and scale bar. Modules put their
 * own layers in as children.
 */
export default function MapShell({
  basemap = "terrain",
  onBasemapChange,
  showBasemap = true,
  interactive = true,
  tools = ALL_TOOLS,
  homeExtent = null,
  drawnShape = null,
  onDrawnShapeChange,
  layersPanel,
  drawMode: controlledDrawMode,
  onDrawModeChange,
  onControls,
  className = "",
  children,
}: MapShellProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<L.Map | null>(null);
  const [panel, setPanel] = useState<"layers" | "basemap" | null>(null);
  const [localDrawMode, setLocalDrawMode] = useState<DrawMode>(null);
  const drawMode = controlledDrawMode !== undefined ? controlledDrawMode : localDrawMode;
  const setDrawMode = useCallback(
    (next: DrawMode | ((current: DrawMode) => DrawMode)) => {
      const value = typeof next === "function" ? next(drawMode) : next;
      setLocalDrawMode(value);
      onDrawModeChange?.(value);
    },
    [drawMode, onDrawModeChange],
  );
  const [fullscreen, setFullscreen] = useState(false);
  const has = (tool: MapTool) => tools !== false && tools.includes(tool);
  const tile = BASEMAP_TILES[basemap] ?? BASEMAP_TILES.terrain;

  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === wrapperRef.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const fitHome = useCallback(() => {
    if (!map) return;
    const bounds = homeExtent ? L.geoJSON(homeExtent as any).getBounds() : null;
    if (bounds?.isValid()) map.fitBounds(bounds, { padding: [24, 24] });
    else map.setView(INDIA_CENTER, INDIA_ZOOM);
  }, [map, homeExtent]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void wrapperRef.current?.requestFullscreen();
  }, []);

  useEffect(() => {
    if (!map || !onControls) return;
    onControls({ fitHome, toggleFullscreen, zoomIn: () => map.zoomIn(), zoomOut: () => map.zoomOut() });
  }, [map, onControls, fitHome, toggleFullscreen]);

  const toggleDraw = (mode: DrawMode) => {
    setPanel(null);
    setDrawMode((current) => (current === mode ? null : mode));
  };
  const stopDrawing = useCallback(() => setDrawMode(null), [setDrawMode]);

  return (
    <div ref={wrapperRef} className={`relative h-full w-full overflow-hidden bg-slate-100 ${className}`}>
      <MapContainer
        ref={setMap}
        center={INDIA_CENTER}
        zoom={INDIA_ZOOM}
        className="h-full w-full"
        style={{ width: "100%", height: "100%" }}
        zoomControl={false}
        attributionControl
        dragging={interactive}
        touchZoom={interactive}
        scrollWheelZoom={interactive}
        doubleClickZoom={interactive}
        boxZoom={interactive}
        keyboard={interactive}
      >
        <MapResizer />
        {showBasemap ? <TileLayer key={basemap} url={tile.url} attribution={tile.attribution} /> : null}
        {children}
        {onDrawnShapeChange || drawnShape ? (
          <DrawLayer mode={drawMode} shape={drawnShape} onShapeChange={onDrawnShapeChange} onDone={stopDrawing} />
        ) : null}
        {has("scale") ? <ScaleBar /> : null}
      </MapContainer>

      {tools !== false && interactive ? (
        <div className="absolute right-3 top-3 z-[900] flex flex-col items-end gap-2">
          <div className="relative flex flex-col gap-2">
            {has("layers") && layersPanel ? (
              <RailButton title="Layers" active={panel === "layers"} onClick={() => setPanel(panel === "layers" ? null : "layers")}>
                <Layers className="h-4 w-4" />
              </RailButton>
            ) : null}
            {has("basemap") && onBasemapChange ? (
              <RailButton title="Basemap" active={panel === "basemap"} onClick={() => setPanel(panel === "basemap" ? null : "basemap")}>
                <MapIcon className="h-4 w-4" />
              </RailButton>
            ) : null}
            {has("home") ? (
              <RailButton title="Fit to area" onClick={fitHome}>
                <Home className="h-4 w-4" />
              </RailButton>
            ) : null}
            {has("fullscreen") ? (
              <RailButton title={fullscreen ? "Exit full screen" : "Full screen"} onClick={toggleFullscreen}>
                {fullscreen ? <Shrink className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
              </RailButton>
            ) : null}

            {panel === "layers" && layersPanel ? (
              <Popover title="Layers" onClose={() => setPanel(null)}>{layersPanel}</Popover>
            ) : null}
            {panel === "basemap" && onBasemapChange ? (
              <Popover title="Basemap" onClose={() => setPanel(null)}>
                <div className="grid grid-cols-2 gap-2">
                  {BASEMAPS.map((b) => (
                    <button
                      key={b.key}
                      type="button"
                      onClick={() => { onBasemapChange(b.key); setPanel(null); }}
                      className={`rounded-lg border px-2 py-2 text-xs font-semibold transition ${
                        basemap === b.key ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {b.label}
                    </button>
                  ))}
                </div>
              </Popover>
            ) : null}
          </div>

          {has("draw") && onDrawnShapeChange ? (
            <div className="mt-2 flex flex-col gap-2">
              <RailButton title="Draw polygon (double-click to finish)" active={drawMode === "polygon"} onClick={() => toggleDraw("polygon")}>
                <Pentagon className="h-4 w-4" />
              </RailButton>
              <RailButton title="Draw rectangle (drag)" active={drawMode === "rectangle"} onClick={() => toggleDraw("rectangle")}>
                <Square className="h-4 w-4" />
              </RailButton>
              <RailButton title="Clear drawing" disabled={!drawnShape} onClick={() => onDrawnShapeChange(null)}>
                <Trash2 className="h-4 w-4" />
              </RailButton>
            </div>
          ) : null}
        </div>
      ) : null}

      {drawMode ? (
        <div className="pointer-events-none absolute left-1/2 top-3 z-[900] -translate-x-1/2 rounded-full bg-slate-900/85 px-4 py-1.5 text-xs font-medium text-white shadow">
          {drawMode === "polygon" ? "Click to add points · double-click or Enter to finish · Esc to cancel" : "Drag to draw a rectangle · Esc to cancel"}
        </div>
      ) : null}

      {has("zoom") && interactive && map ? (
        <div className="absolute bottom-10 right-3 z-[900] flex flex-col overflow-hidden rounded-xl bg-white shadow-md ring-1 ring-slate-200">
          <button type="button" title="Zoom in" onClick={() => map.zoomIn()} className="flex h-9 w-9 items-center justify-center text-slate-700 hover:bg-slate-50">
            <Plus className="h-4 w-4" />
          </button>
          <div className="h-px bg-slate-200" />
          <button type="button" title="Zoom out" onClick={() => map.zoomOut()} className="flex h-9 w-9 items-center justify-center text-slate-700 hover:bg-slate-50">
            <Minus className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {has("coords") && map ? <CoordinateReadout map={map} /> : null}
    </div>
  );
}
