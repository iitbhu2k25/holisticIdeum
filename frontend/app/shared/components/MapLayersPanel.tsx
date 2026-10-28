"use client";

import { Eye, EyeOff, X } from "lucide-react";
import type { Dataset } from "../services/datasetService";
import { categoryColor } from "../map/styles";
import type { ClipEntry } from "./DatasetCatalog";

export type BaseLayerState = { area: boolean; rivers: boolean; basin: boolean };

const BASE_LAYERS: { key: keyof BaseLayerState; label: string; swatch: React.CSSProperties }[] = [
  { key: "basin", label: "Basin boundary", swatch: { border: "2px dashed #1d4ed8" } },
  { key: "rivers", label: "Rivers", swatch: { background: "linear-gradient(90deg,#06b6d4,#eb8f25,#22c55e)", height: 4 } },
  { key: "area", label: "Zones", swatch: { border: "2px solid #475569" } },
];

/** Contents of the map's "Layers" pop-over: base layers, uploaded data in view and clip results. */
export default function MapLayersPanel({
  baseLayers,
  onBaseLayersChange,
  visibleDatasets,
  onToggleDataset,
  clips = [],
  onRemoveClip,
}: {
  baseLayers: BaseLayerState;
  onBaseLayersChange: (next: BaseLayerState) => void;
  visibleDatasets: Dataset[];
  onToggleDataset: (ds: Dataset) => void;
  clips?: ClipEntry[];
  onRemoveClip?: (id: string) => void;
}) {
  return (
    <div className="space-y-4 text-sm">
      <section>
        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">Base layers</p>
        {BASE_LAYERS.map((l) => (
          <label key={l.key} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-slate-50">
            <input
              type="checkbox"
              checked={baseLayers[l.key]}
              onChange={() => onBaseLayersChange({ ...baseLayers, [l.key]: !baseLayers[l.key] })}
            />
            <span className="inline-block h-3 w-5 rounded-sm" style={l.swatch} />
            <span className="text-slate-700">{l.label}</span>
          </label>
        ))}
      </section>

      <section>
        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">Uploaded data</p>
        {visibleDatasets.length ? (
          visibleDatasets.map((ds) => (
            <div key={ds.id} className="flex items-center gap-2 rounded px-1 py-1">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: categoryColor(ds.category) }} />
              <span className="min-w-0 flex-1 truncate text-slate-700" title={ds.title}>{ds.title}</span>
              <button type="button" title="Hide" onClick={() => onToggleDataset(ds)} className="rounded p-1 text-emerald-700 hover:bg-slate-100">
                <Eye className="h-3.5 w-3.5" />
              </button>
            </div>
          ))
        ) : (
          <p className="flex items-center gap-1.5 px-1 text-xs text-slate-400">
            <EyeOff className="h-3.5 w-3.5" /> Turn data on from the criteria list.
          </p>
        )}
      </section>

      {clips.length ? (
        <section>
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">Clipped results</p>
          {clips.map((c) => (
            <div key={c.id} className="flex items-center gap-2 rounded px-1 py-1">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-orange-500" />
              <span className="min-w-0 flex-1 truncate text-slate-700">{c.title}</span>
              <button type="button" title="Remove" onClick={() => onRemoveClip?.(c.id)} className="rounded p-1 text-slate-500 hover:bg-slate-100">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}
