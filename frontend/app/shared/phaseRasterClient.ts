// Weighted phase rasters generated in /holistic (or a split viewer) and read back by /split.
// Always kept in this browser (IndexedDB — rasters are too big for localStorage); signed-in users
// also get a copy on the server so it follows them to other devices.
import { apiFetch, getUser } from "./auth/authClient";

export type PhaseMeta = {
  stage_index: number;
  stage_name: string;
  criteria: string[];
  weights: Record<string, number>;
  generated_at: number;
};

const DB_NAME = "dss";
const STORE = "phase_rasters";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T | null> {
  try {
    const db = await openDb();
    return await new Promise<T | null>((resolve, reject) => {
      const req = run(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

type LocalEntry = { meta: PhaseMeta; tiff: ArrayBuffer };

export async function savePhaseRaster(
  stageIndex: number,
  stageName: string,
  criteria: string[],
  weights: Record<string, number>,
  tiff: ArrayBuffer,
): Promise<void> {
  const meta: PhaseMeta = { stage_index: stageIndex, stage_name: stageName, criteria, weights, generated_at: Date.now() };
  await idb("readwrite", (s) => s.put({ meta, tiff } satisfies LocalEntry, stageIndex));

  if (!getUser()) return;
  const form = new FormData();
  form.append("stage_index", String(stageIndex));
  form.append("stage_name", stageName);
  form.append("criteria", JSON.stringify(criteria));
  form.append("weights", JSON.stringify(weights));
  form.append("tiff", new Blob([tiff], { type: "image/tiff" }), `phase_raster_${stageIndex}.tif`);
  await apiFetch("/analysis/save-phase-raster", { method: "POST", body: form }).catch(() => null);
}

async function serverMeta(stageIndex: number): Promise<PhaseMeta | null> {
  if (!getUser()) return null;
  const r = await apiFetch(`/analysis/phase-raster-meta/${stageIndex}`).catch(() => null);
  return r?.ok ? r.json() : null;
}

/** The newest of the browser copy and the server copy. */
export async function loadPhaseMeta(stageIndex: number): Promise<PhaseMeta | null> {
  const [local, remote] = await Promise.all([idb<LocalEntry>("readonly", (s) => s.get(stageIndex)), serverMeta(stageIndex)]);
  const localMeta = local?.meta ?? null;
  if (localMeta && remote) return localMeta.generated_at >= remote.generated_at ? localMeta : remote;
  return localMeta ?? remote;
}

export async function loadPhaseTiff(stageIndex: number): Promise<ArrayBuffer | null> {
  const [local, remote] = await Promise.all([idb<LocalEntry>("readonly", (s) => s.get(stageIndex)), serverMeta(stageIndex)]);
  if (local && (!remote || local.meta.generated_at >= remote.generated_at)) return local.tiff;
  if (!remote) return null;
  const r = await apiFetch(`/analysis/phase-raster-tiff/${stageIndex}`).catch(() => null);
  return r?.ok ? r.arrayBuffer() : null;
}
