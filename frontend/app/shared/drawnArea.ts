// A polygon drawn on the map is sent to the backend inside `selected_zones` as
// "DRAWN AREA::<geojson>" (backend: geo_utils.DRAWN_PREFIX). Every zone-based layer and
// analysis then clips to the drawing alone, or to its overlap with the selected zones.
import type { DrawnShape } from "./map/DrawLayer";

export const DRAWN_PREFIX = "DRAWN AREA::";

export const isDrawnArea = (zone: string) => zone.startsWith(DRAWN_PREFIX);

/** Zones to send for analysis / clipping: the selected zones plus the drawn area, if any. */
export function withDrawnArea(zones: string[], shape: DrawnShape | null): string[] {
  return shape ? [...zones, DRAWN_PREFIX + JSON.stringify(shape.geometry)] : zones;
}

/** Zone names for display, with the drawn area shown by name. */
export function zoneLabels(zones: string[]): string[] {
  return zones.map((z) => (isDrawnArea(z) ? "Drawn area" : z));
}
