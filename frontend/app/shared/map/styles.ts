// Map colours and popup markup. Kept free of Leaflet imports so panels can use them during SSR.
import { DATASET_CATEGORIES } from "../config";

export const categoryColor = (category: string) =>
  DATASET_CATEGORIES.find((c) => c.key === category)?.color ?? "#0f766e";

// blue -> green -> yellow -> red, matching the GeoServer style the backend publishes
const RAMP = [
  [44, 123, 182], [0, 166, 202], [0, 204, 188], [144, 235, 157],
  [255, 255, 140], [249, 208, 87], [242, 158, 46], [231, 104, 24], [215, 25, 28],
];

export function rampColor(t: number, alpha = 0.85) {
  const x = Math.max(0, Math.min(1, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  const f = x - i;
  const c = RAMP[i].map((v, k) => Math.round(v + (RAMP[i + 1][k] - v) * f));
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}

export const RAMP_CSS = `linear-gradient(90deg, ${RAMP.map((c) => `rgb(${c.join(",")})`).join(", ")})`;

const escapeHtml = (value: unknown) =>
  String(value ?? "—").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function propertiesPopup(title: string, props: Record<string, unknown> | null | undefined, maxRows = 14) {
  const rows = Object.entries(props ?? {})
    .slice(0, maxRows)
    .map(([k, v]) => `<tr><td style="padding:2px 6px;color:#64748b;white-space:nowrap">${escapeHtml(k)}</td><td style="padding:2px 6px;font-weight:600">${escapeHtml(v)}</td></tr>`)
    .join("");
  return `<div style="font-family:sans-serif;font-size:12px;min-width:200px"><div style="font-weight:700;margin-bottom:4px">${escapeHtml(title)}</div><table style="border-collapse:collapse;font-size:11px">${rows}</table></div>`;
}
