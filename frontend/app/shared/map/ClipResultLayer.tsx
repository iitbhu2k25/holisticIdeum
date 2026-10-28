"use client";

import { useEffect } from "react";
import L from "leaflet";
import { useMap } from "react-leaflet";
import type { ClipResult } from "../services/datasetService";
import { propertiesPopup, rampColor } from "./styles";

/** Result of clipping a dataset to the selected zones / drawn polygon. */
export default function ClipResultLayer({ result, title, fit = true }: { result: ClipResult; title: string; fit?: boolean }) {
  const map = useMap();

  useEffect(() => {
    let layer: L.Layer | null = null;
    let cancelled = false;

    if (result.kind === "vector") {
      const gj = L.geoJSON(result.geojson as any, {
        style: { color: "#c2410c", weight: 2, fillColor: "#fb923c", fillOpacity: 0.35 },
        pointToLayer: (_f, latlng) => L.circleMarker(latlng, { radius: 6, color: "#fff", weight: 1.5, fillColor: "#c2410c", fillOpacity: 0.95 }),
        onEachFeature: (feature, l) => l.bindPopup(propertiesPopup(title, feature.properties), { maxWidth: 320 }),
      }).addTo(map);
      layer = gj;
      if (fit && gj.getBounds().isValid()) map.fitBounds(gj.getBounds(), { padding: [30, 30] });
    } else {
      (async () => {
        const parseGeoraster: any = await import("georaster").then((m) => m.default ?? m);
        const GeoRasterLayer: any = await import("georaster-layer-for-leaflet").then((m) => m.default ?? m);
        const georaster = await parseGeoraster(result.tiff.slice(0));
        if (cancelled) return;
        const { min, max } = result.stats;
        const lo = min ?? georaster.mins?.[0] ?? 0;
        const span = (max ?? georaster.maxs?.[0] ?? 1) - lo || 1;
        const nodata = georaster.noDataValue;
        const rasterLayer = new GeoRasterLayer({
          georaster,
          opacity: 0.9,
          resolution: 256,
          pixelValuesToColorFn: (values: number[]) => {
            const v = values?.[0];
            if (v == null || !Number.isFinite(v) || (nodata != null && v === nodata)) return null;
            return rampColor((v - lo) / span);
          },
        });
        rasterLayer.addTo(map);
        layer = rasterLayer;
        if (fit) map.fitBounds(rasterLayer.getBounds(), { padding: [30, 30] });
      })();
    }

    return () => {
      cancelled = true;
      layer?.remove();
    };
  }, [map, result, title, fit]);

  return null;
}
