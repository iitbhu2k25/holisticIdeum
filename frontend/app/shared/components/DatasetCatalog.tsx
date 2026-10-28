"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Eye, EyeOff, Loader2, Scissors, Table2, X } from "lucide-react";
import { DATASET_CATEGORIES } from "../config";
import { ClipResult, Dataset, datasetService, formatBytes } from "../services/datasetService";
import { categoryColor, RAMP_CSS } from "../map/styles";
import type { DrawnShape } from "../map/DrawLayer";

// One request shared by every catalog on the page; refreshed on demand.
let cache: Promise<Dataset[]> | null = null;
export function loadDatasets(force = false): Promise<Dataset[]> {
  if (!cache || force) cache = datasetService.list().catch((err) => { cache = null; throw err; });
  return cache;
}

export function useDatasets() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const reload = useCallback((force = false) => {
    setLoading(true);
    loadDatasets(force)
      .then((d) => { setDatasets(d); setError(""); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => reload(), [reload]);
  return { datasets, error, loading, reload };
}

export type ClipEntry = { id: string; datasetId: number; title: string; result: ClipResult };

function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function RowsDialog({ dataset, onClose }: { dataset: Dataset; onClose: () => void }) {
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ columns: string[]; rows: Record<string, any>[]; total: number | null } | null>(null);
  const [error, setError] = useState("");
  const size = 50;
  useEffect(() => {
    datasetService.rows(dataset.id, page * size, size).then(setData).catch((e) => setError(e.message));
  }, [dataset.id, page]);
  const total = data?.total ?? 0;
  return (
    <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-4xl flex-col rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <p className="font-semibold text-slate-900">{dataset.title}</p>
            <p className="text-xs text-slate-500">{total.toLocaleString()} rows</p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-auto">
          {error ? <p className="p-4 text-sm text-red-700">{error}</p> : null}
          {!data && !error ? <p className="p-4 text-sm text-slate-500">Loading…</p> : null}
          {data ? (
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 bg-slate-100">
                <tr>{data.columns.map((c) => <th key={c} className="border-b px-2 py-1.5 text-left font-semibold text-slate-700">{c}</th>)}</tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={i} className="odd:bg-white even:bg-slate-50">
                    {data.columns.map((c) => <td key={c} className="border-b px-2 py-1 text-slate-700">{r[c] == null ? "—" : String(r[c])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </div>
        <div className="flex items-center justify-end gap-2 border-t px-4 py-2 text-xs">
          <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} className="rounded border px-2 py-1 disabled:opacity-40">Previous</button>
          <span className="text-slate-500">Page {page + 1} of {Math.max(1, Math.ceil(total / size))}</span>
          <button type="button" disabled={(page + 1) * size >= total} onClick={() => setPage(page + 1)} className="rounded border px-2 py-1 disabled:opacity-40">Next</button>
        </div>
      </div>
    </div>
  );
}

function ClipSummary({ entry, onRemove }: { entry: ClipEntry; onRemove: () => void }) {
  const r = entry.result;
  const fmt = (v: number | null | undefined) => (v == null ? "—" : Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(3));
  return (
    <div className="mt-2 rounded-lg border border-orange-200 bg-orange-50/60 p-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-orange-900">Clipped result</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title="Download"
            onClick={() =>
              r.kind === "raster"
                ? download(`${entry.title}_clip.tif`, r.tiff, "image/tiff")
                : download(`${entry.title}_clip.geojson`, JSON.stringify(r.geojson), "application/geo+json")
            }
            className="rounded p-1 text-orange-800 hover:bg-orange-100"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
          <button type="button" title="Remove from map" onClick={onRemove} className="rounded p-1 text-orange-800 hover:bg-orange-100">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {r.kind === "raster" ? (
        <>
          <div className="mt-1 grid grid-cols-3 gap-1 text-center">
            {(["min", "mean", "max"] as const).map((k) => (
              <div key={k} className="rounded bg-white px-1 py-1">
                <div className="text-[10px] uppercase text-slate-400">{k}</div>
                <div className="font-semibold text-slate-800">{fmt(r.stats[k])}</div>
              </div>
            ))}
          </div>
          <div className="mt-1.5 h-2 rounded" style={{ background: RAMP_CSS }} />
        </>
      ) : (
        <p className="mt-1 text-slate-700">
          {(r.geojson.count ?? r.geojson.features.length).toLocaleString()} features inside the area
          {r.geojson.truncated ? " (first 50,000 shown)" : ""}
        </p>
      )}
    </div>
  );
}

/**
 * Uploaded datasets for one category (or all), with show-on-map toggles and
 * "clip to selected zones / drawn polygon".
 */
export default function DatasetCatalog({
  category,
  visibleIds,
  onToggleVisible,
  selectedZones,
  drawnShape,
  clips,
  onClip,
  onRemoveClip,
  compact = false,
}: {
  category?: string;
  visibleIds: number[];
  onToggleVisible: (dataset: Dataset) => void;
  selectedZones: string[];
  drawnShape: DrawnShape | null;
  clips: ClipEntry[];
  onClip: (entry: ClipEntry) => void;
  onRemoveClip: (id: string) => void;
  compact?: boolean;
}) {
  const { datasets, error, loading } = useDatasets();
  const [busy, setBusy] = useState<number | null>(null);
  const [clipError, setClipError] = useState<Record<number, string>>({});
  const [rowsFor, setRowsFor] = useState<Dataset | null>(null);

  const shown = useMemo(
    () => datasets.filter((d) => d.status === "ready" && (!category || d.category === category)),
    [datasets, category],
  );
  const groups = useMemo(() => {
    const byCriterion = new Map<string, Dataset[]>();
    for (const d of shown) {
      const key = category ? d.criterion || "Other" : DATASET_CATEGORIES.find((c) => c.key === d.category)?.label ?? d.category;
      byCriterion.set(key, [...(byCriterion.get(key) ?? []), d]);
    }
    return [...byCriterion.entries()];
  }, [shown, category]);

  const canClip = selectedZones.length > 0 || !!drawnShape;
  const areaLabel = drawnShape && selectedZones.length ? "zones ∩ drawn area" : drawnShape ? "drawn area" : `zone${selectedZones.length > 1 ? "s" : ""} ${selectedZones.join(", ")}`;

  const clip = async (ds: Dataset) => {
    setBusy(ds.id);
    setClipError((e) => ({ ...e, [ds.id]: "" }));
    try {
      const result = await datasetService.clip(ds.id, { selectedZones, polygon: drawnShape });
      onClip({ id: `clip-${ds.id}`, datasetId: ds.id, title: ds.title, result });
    } catch (err) {
      setClipError((e) => ({ ...e, [ds.id]: err instanceof Error ? err.message : "Clip failed" }));
    } finally {
      setBusy(null);
    }
  };

  if (loading && !datasets.length) return <p className="text-xs text-slate-500">Loading uploaded data…</p>;
  if (error) return <p className="text-xs text-red-600">{error}</p>;
  if (!shown.length) {
    return <p className="text-xs italic text-slate-400">No uploaded data{category ? " for this category" : ""} yet.</p>;
  }

  return (
    <div className="space-y-3">
      {!compact ? (
        <p className="text-[11px] text-slate-500">
          {canClip ? <>Clip uses the <strong>{areaLabel}</strong>.</> : "Select zones or draw a polygon on the map to clip."}
        </p>
      ) : null}
      {groups.map(([group, items]) => (
        <div key={group}>
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">{group}</p>
          <ul className="space-y-1.5">
            {items.map((ds) => {
              const visible = visibleIds.includes(ds.id);
              const entry = clips.find((c) => c.datasetId === ds.id);
              return (
                <li key={ds.id} className="rounded-lg border border-slate-200 bg-white p-2">
                  <div className="flex items-start gap-2">
                    <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: categoryColor(ds.category) }} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800" title={ds.title}>{ds.title}</p>
                      <p className="text-[11px] text-slate-500">
                        {ds.kind}{ds.feature_count != null ? ` · ${ds.feature_count.toLocaleString()} ${ds.kind === "table" ? "rows" : "features"}` : ""} · {formatBytes(ds.size_bytes)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      {ds.kind !== "raster" ? (
                        <button type="button" title="View attribute table" onClick={() => setRowsFor(ds)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100">
                          <Table2 className="h-4 w-4" />
                        </button>
                      ) : null}
                      {ds.kind !== "table" ? (
                        <>
                          <button
                            type="button"
                            title={visible ? "Hide from map" : "Show on map"}
                            onClick={() => onToggleVisible(ds)}
                            className={`rounded p-1.5 ${visible ? "bg-emerald-50 text-emerald-700" : "text-slate-500 hover:bg-slate-100"}`}
                          >
                            {visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                          </button>
                          <button
                            type="button"
                            title={canClip ? `Clip to ${areaLabel}` : "Select zones or draw a polygon first"}
                            disabled={!canClip || busy === ds.id}
                            onClick={() => clip(ds)}
                            className="rounded p-1.5 text-slate-500 hover:bg-orange-50 hover:text-orange-700 disabled:opacity-40"
                          >
                            {busy === ds.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scissors className="h-4 w-4" />}
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>
                  {clipError[ds.id] ? <p className="mt-1 text-[11px] text-red-600">{clipError[ds.id]}</p> : null}
                  {entry ? <ClipSummary entry={entry} onRemove={() => onRemoveClip(entry.id)} /> : null}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {rowsFor ? <RowsDialog dataset={rowsFor} onClose={() => setRowsFor(null)} /> : null}
    </div>
  );
}
