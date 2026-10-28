import { apiFetch, apiUpload, errorMessage } from "../auth/authClient";
import type { DatasetCategory } from "../config";

export type DatasetKind = "raster" | "vector" | "table";
export type DatasetStatus = "processing" | "ready" | "failed";

export type Dataset = {
  id: number;
  title: string;
  category: DatasetCategory;
  category_label: string;
  criterion: string | null;
  kind: DatasetKind;
  source_format: string;
  original_filename: string;
  size_bytes: number;
  status: DatasetStatus;
  error: string | null;
  geoserver_layer: string | null;
  bbox: [number, number, number, number] | null;
  feature_count: number | null;
  info: Record<string, any>;
  uploaded_by: string | null;
  created_at: string;
};

export type ClipArea = {
  selectedZones?: string[];
  polygon?: GeoJSON.Geometry | GeoJSON.Feature | null;
};

export type RasterClip = { kind: "raster"; tiff: ArrayBuffer; stats: { min: number | null; max: number | null; mean: number | null; pixels: number } };
export type VectorClip = { kind: "vector"; geojson: GeoJSON.FeatureCollection & { truncated?: boolean; count?: number } };
export type ClipResult = RasterClip | VectorClip;

async function json<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) throw new Error(await errorMessage(res, fallback));
  return res.json();
}

export const datasetService = {
  list: async (filters: { category?: string; criterion?: string } = {}): Promise<Dataset[]> => {
    const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]);
    return json(await apiFetch(`/api/datasets?${params}`), "Could not load datasets");
  },

  get: async (id: number): Promise<Dataset> => json(await apiFetch(`/api/datasets/${id}`), "Could not load dataset"),

  upload: (
    file: File,
    meta: { category: string; criterion?: string; title?: string; joinField?: string },
    onProgress: (fraction: number) => void,
  ) => {
    const form = new FormData();
    form.append("file", file);
    form.append("category", meta.category);
    if (meta.criterion) form.append("criterion", meta.criterion);
    if (meta.title) form.append("title", meta.title);
    if (meta.joinField) form.append("join_field", meta.joinField);
    return apiUpload("/api/datasets/upload", form, onProgress);
  },

  update: async (id: number, patch: Partial<Pick<Dataset, "title" | "category" | "criterion">>): Promise<Dataset> =>
    json(
      await apiFetch(`/api/datasets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }),
      "Could not update dataset",
    ),

  retry: async (id: number): Promise<Dataset> =>
    json(await apiFetch(`/api/datasets/${id}/retry`, { method: "POST" }), "Could not retry"),

  remove: async (id: number): Promise<void> => {
    await json(await apiFetch(`/api/datasets/${id}`, { method: "DELETE" }), "Could not delete dataset");
  },

  /** Features inside the current view only; the server simplifies them for the zoom level. */
  features: async (
    id: number,
    bbox: [number, number, number, number],
    zoom: number,
    signal?: AbortSignal,
  ): Promise<GeoJSON.FeatureCollection & { truncated: boolean; count: number }> =>
    json(
      await apiFetch(`/api/datasets/${id}/features?bbox=${bbox.map((v) => v.toFixed(5)).join(",")}&zoom=${zoom}&limit=3000`, { signal }),
      "Could not load features",
    ),

  rows: async (id: number, offset = 0, limit = 100): Promise<{ columns: string[]; rows: Record<string, any>[]; total: number | null }> =>
    json(await apiFetch(`/api/datasets/${id}/rows?offset=${offset}&limit=${limit}`), "Could not load rows"),

  clip: async (id: number, area: ClipArea): Promise<ClipResult> => {
    const res = await apiFetch(`/api/datasets/${id}/clip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selected_zones: area.selectedZones ?? [], polygon: area.polygon ?? null }),
    });
    if (!res.ok) throw new Error(await errorMessage(res, "Clip failed"));
    if ((res.headers.get("content-type") || "").includes("image/tiff")) {
      const stats = JSON.parse(res.headers.get("X-Stats") || "{}");
      return { kind: "raster", tiff: await res.arrayBuffer(), stats };
    }
    return { kind: "vector", geojson: await res.json() };
  },
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}
