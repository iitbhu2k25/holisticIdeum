"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, CheckCircle2, CloudUpload, FileUp, Loader2, RefreshCw, RotateCcw, Trash2, XCircle,
} from "lucide-react";
import { DATASET_CATEGORIES } from "../../shared/config";
import { STAGE_CONFIGS } from "../../shared/criteria-configs";
import { Dataset, datasetService, formatBytes } from "../../shared/services/datasetService";
import { loadDatasets } from "../../shared/components/DatasetCatalog";
import { useAuth } from "../../shared/auth/useAuth";

const MAX_BYTES = 1024 ** 3;
const ACCEPT = ".tif,.tiff,.zip,.geojson,.json,.gpkg,.kml,.csv";
const OTHER = "__other__";

type QueueItem = {
  key: string;
  file: File;
  progress: number;
  state: "waiting" | "uploading" | "done" | "duplicate" | "error";
  message?: string;
};

const FORMAT_HELP = [
  ["Raster", "GeoTIFF (.tif) with a coordinate system"],
  ["Shapefile", ".zip containing .shp, .shx, .dbf and .prj"],
  ["Vector", "GeoJSON, GeoPackage (.gpkg) or KML"],
  ["CSV", "lat/lon columns → points; otherwise a column with zone names (A, B, …) is joined to the zones; otherwise kept as a table"],
];

function StatusBadge({ ds }: { ds: Dataset }) {
  if (ds.status === "ready") return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700"><CheckCircle2 className="h-3 w-3" />Ready</span>;
  if (ds.status === "failed") return <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700"><XCircle className="h-3 w-3" />Failed</span>;
  return <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700"><Loader2 className="h-3 w-3 animate-spin" />Processing</span>;
}

function datasetNote(ds: Dataset): string {
  const i = ds.info || {};
  if (i.csv_mode === "points") return `Points from ${i.lat_column}/${i.lon_column}${i.skipped_rows ? `, ${i.skipped_rows} rows without coordinates skipped` : ""}`;
  if (i.csv_mode === "zone_join") {
    const missed = i.unmatched_values?.length ? `; not matched: ${i.unmatched_values.slice(0, 5).join(", ")}${i.unmatched_values.length > 5 ? "…" : ""}` : "";
    return `Joined to zones on "${i.join_column}" (${i.matched_rows} rows)${missed}`;
  }
  if (i.csv_mode === "table") return "No coordinates or zone names found — kept as a table";
  if (ds.kind === "raster" && i.crs) return `${i.width}×${i.height} px · ${i.bands} band · ${i.crs}`;
  if (i.geometry_types) return i.geometry_types.join(", ");
  return "";
}

export default function DatasetAdminPage() {
  const { user } = useAuth();
  const [category, setCategory] = useState<string>(DATASET_CATEGORIES[0].key);
  const [criterion, setCriterion] = useState("");
  const [otherCriterion, setOtherCriterion] = useState("");
  const [title, setTitle] = useState("");
  const [joinField, setJoinField] = useState("");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [listError, setListError] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const fileInput = useRef<HTMLInputElement>(null);
  const uploading = queue.some((q) => q.state === "uploading");

  const criteriaOptions = useMemo(() => {
    const stage = DATASET_CATEGORIES.find((c) => c.key === category)!.stageIndex;
    return STAGE_CONFIGS[stage]?.criteria ?? [];
  }, [category]);

  const refresh = useCallback(async () => {
    try {
      setDatasets(await loadDatasets(true));
      setListError("");
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Could not load datasets");
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // poll while anything is still being processed
  useEffect(() => {
    if (!datasets.some((d) => d.status === "processing")) return;
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [datasets, refresh]);

  const addFiles = (files: FileList | File[]) => {
    const items: QueueItem[] = Array.from(files).map((file) => ({
      key: `${file.name}-${file.size}-${file.lastModified}`,
      file,
      progress: 0,
      state: file.size > MAX_BYTES ? "error" : "waiting",
      message: file.size > MAX_BYTES ? "Larger than the 1 GB limit" : undefined,
    }));
    // finished rows are dropped, so choosing the same file again re-queues it (and shows the duplicate notice)
    setQueue((prev) => {
      const pending = prev.filter((p) => p.state === "uploading" || p.state === "waiting");
      return [...pending, ...items.filter((i) => !pending.some((p) => p.key === i.key))];
    });
  };

  const patch = (key: string, change: Partial<QueueItem>) =>
    setQueue((prev) => prev.map((q) => (q.key === key ? { ...q, ...change } : q)));

  const startUpload = async () => {
    const chosenCriterion = criterion === OTHER ? otherCriterion.trim() : criterion;
    const waiting = queue.filter((q) => q.state === "waiting");
    for (const item of waiting) {
      patch(item.key, { state: "uploading", progress: 0 });
      try {
        const { promise } = datasetService.upload(
          item.file,
          {
            category,
            criterion: chosenCriterion || undefined,
            title: waiting.length === 1 && title.trim() ? title.trim() : undefined,
            joinField: joinField.trim() || undefined,
          },
          (p) => patch(item.key, { progress: p }),
        );
        const { status, body } = await promise;
        if (status === 409) patch(item.key, { state: "duplicate", message: body?.detail });
        else if (status >= 400) patch(item.key, { state: "error", message: body?.detail || `Upload failed (${status})` });
        else patch(item.key, { state: "done", progress: 1, message: "Uploaded — processing on the server" });
      } catch (err) {
        patch(item.key, { state: "error", message: err instanceof Error ? err.message : "Upload failed" });
      }
    }
    setTitle("");
    await refresh();
  };

  const remove = async (ds: Dataset) => {
    if (!confirm(`Delete "${ds.title}"? This removes the file and its map layer for everyone.`)) return;
    try {
      await datasetService.remove(ds.id);
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const retry = async (ds: Dataset) => {
    await datasetService.retry(ds.id).catch((err) => alert(err.message));
    await refresh();
  };

  const shown = filter === "all" ? datasets : datasets.filter((d) => d.category === filter);
  const hasCsv = queue.some((q) => q.state === "waiting" && q.file.name.toLowerCase().endsWith(".csv"));

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Data upload</h1>
          <p className="text-sm text-slate-500">
            Upload data by Ganga category. Once processed it appears in the Holistic and Split modules for every user.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-500">{user?.email}</span>
          <Link href="/holistic" className="rounded-lg border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-50">Open Holistic</Link>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        {/* ── upload form ── */}
        <section className="h-fit space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Category</p>
            <div className="grid grid-cols-2 gap-2">
              {DATASET_CATEGORIES.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => { setCategory(c.key); setCriterion(""); }}
                  className={`rounded-lg border px-2 py-2 text-left text-sm font-medium transition ${
                    category === c.key ? "border-transparent text-white shadow" : "border-slate-200 text-slate-700 hover:bg-slate-50"
                  }`}
                  style={category === c.key ? { background: c.color } : undefined}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Criterion</span>
            <select value={criterion} onChange={(e) => setCriterion(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="">— none —</option>
              {criteriaOptions.map((c) => <option key={c} value={c}>{c}</option>)}
              <option value={OTHER}>Other…</option>
            </select>
            {criterion === OTHER ? (
              <input value={otherCriterion} onChange={(e) => setOtherCriterion(e.target.value)} placeholder="Criterion name" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            ) : null}
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Title <span className="font-normal normal-case text-slate-400">(optional, single file)</span></span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Defaults to the file name" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </label>

          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
            onClick={() => fileInput.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-8 text-center transition ${
              dragging ? "border-sky-500 bg-sky-50" : "border-slate-300 hover:border-sky-400 hover:bg-slate-50"
            }`}
          >
            <CloudUpload className="mb-2 h-8 w-8 text-sky-600" />
            <p className="text-sm font-medium text-slate-700">Drop files here or click to choose</p>
            <p className="mt-1 text-xs text-slate-500">TIFF · zipped shapefile · GeoJSON · GPKG · KML · CSV — up to 1 GB each</p>
            <input ref={fileInput} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
          </div>

          {hasCsv ? (
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">CSV zone column <span className="font-normal normal-case text-slate-400">(optional)</span></span>
              <input value={joinField} onChange={(e) => setJoinField(e.target.value)} placeholder="Auto-detected if empty" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </label>
          ) : null}

          {queue.length ? (
            <ul className="space-y-2">
              {queue.map((q) => (
                <li key={q.key} className="rounded-lg border border-slate-200 p-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5 font-medium text-slate-700">
                      <FileUp className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <span className="truncate">{q.file.name}</span>
                    </span>
                    <span className="shrink-0 text-slate-400">{formatBytes(q.file.size)}</span>
                  </div>
                  {q.state === "uploading" || q.state === "done" ? (
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded bg-slate-100">
                      <div className="h-full bg-sky-600 transition-all" style={{ width: `${Math.round(q.progress * 100)}%` }} />
                    </div>
                  ) : null}
                  {q.state === "duplicate" ? (
                    <p className="mt-1.5 flex gap-1 rounded bg-amber-50 p-1.5 text-amber-800"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />{q.message}</p>
                  ) : null}
                  {q.state === "error" ? <p className="mt-1.5 text-red-600">{q.message}</p> : null}
                  {q.state === "done" ? <p className="mt-1 text-emerald-700">{q.message}</p> : null}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={startUpload}
              disabled={uploading || !queue.some((q) => q.state === "waiting") || (criterion === OTHER && !otherCriterion.trim())}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-sky-700 py-2.5 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-50"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudUpload className="h-4 w-4" />}
              Upload {queue.filter((q) => q.state === "waiting").length || ""}
            </button>
            {queue.length && !uploading ? (
              <button type="button" onClick={() => setQueue([])} className="rounded-lg border border-slate-300 px-3 text-sm text-slate-600 hover:bg-slate-50">Clear</button>
            ) : null}
          </div>

          <details className="text-xs text-slate-500">
            <summary className="cursor-pointer font-medium text-slate-600">Supported formats</summary>
            <dl className="mt-2 space-y-1">
              {FORMAT_HELP.map(([k, v]) => (
                <div key={k}><dt className="inline font-semibold text-slate-700">{k}: </dt><dd className="inline">{v}</dd></div>
              ))}
            </dl>
          </details>
        </section>

        {/* ── dataset list ── */}
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
            {[{ key: "all", label: "All" }, ...DATASET_CATEGORIES].map((c) => {
              const count = c.key === "all" ? datasets.length : datasets.filter((d) => d.category === c.key).length;
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setFilter(c.key)}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${filter === c.key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                >
                  {c.label} <span className="opacity-60">{count}</span>
                </button>
              );
            })}
            <button type="button" onClick={refresh} title="Refresh" className="ml-auto rounded p-1.5 text-slate-500 hover:bg-slate-100">
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>

          {listError ? <p className="p-4 text-sm text-red-600">{listError}</p> : null}
          {!shown.length && !listError ? <p className="p-8 text-center text-sm text-slate-400">No datasets uploaded yet.</p> : null}

          <ul className="divide-y divide-slate-100">
            {shown.map((ds) => (
              <li key={ds.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: DATASET_CATEGORIES.find((c) => c.key === ds.category)?.color }} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-slate-900">{ds.title}</p>
                    <StatusBadge ds={ds} />
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] uppercase text-slate-500">{ds.kind}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {ds.category_label}{ds.criterion ? ` · ${ds.criterion}` : ""} · {ds.original_filename} · {formatBytes(ds.size_bytes)}
                    {ds.feature_count != null ? ` · ${ds.feature_count.toLocaleString()} ${ds.kind === "table" ? "rows" : "features"}` : ""}
                  </p>
                  {datasetNote(ds) ? <p className="mt-0.5 text-xs text-slate-400">{datasetNote(ds)}</p> : null}
                  {ds.error ? <p className="mt-1 rounded bg-red-50 px-2 py-1 text-xs text-red-700">{ds.error}</p> : null}
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {new Date(ds.created_at).toLocaleString()}{ds.uploaded_by ? ` · ${ds.uploaded_by}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {ds.status === "failed" ? (
                    <button type="button" onClick={() => retry(ds)} title="Process again" className="rounded p-1.5 text-slate-500 hover:bg-slate-100">
                      <RotateCcw className="h-4 w-4" />
                    </button>
                  ) : null}
                  <button type="button" onClick={() => remove(ds)} title="Delete" className="rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
