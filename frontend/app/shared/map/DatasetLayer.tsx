"use client";

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { useMap, useMapEvents, WMSTileLayer } from "react-leaflet";
import { GEOSERVER_URL, UPLOADS_WORKSPACE } from "../config";
import { categoryColor, propertiesPopup } from "./styles";
import { ClipResult, Dataset, datasetService } from "../services/datasetService";
import ClipResultLayer from "./ClipResultLayer";

// Above this many features a vector layer is drawn from GeoServer tiles until the user zooms in.
const TILE_ONLY_FEATURES = 2000;
const FEATURE_MIN_ZOOM = 12;
const FETCH_DEBOUNCE_MS = 250;

function GeoServerTiles({ dataset, opacity }: { dataset: Dataset; opacity: number }) {
  return (
    <WMSTileLayer
      key={`ds-wms-${dataset.id}`}
      url={`${GEOSERVER_URL}/${UPLOADS_WORKSPACE}/wms`}
      params={{ layers: dataset.geoserver_layer!, format: "image/png", transparent: true, version: "1.1.1", tiled: true } as any}
      opacity={opacity}
      zIndex={450}
    />
  );
}

/** Fetches only the features in view (debounced, cancellable) and redraws on pan / zoom. */
function ViewportFeatures({ dataset, onStatus }: { dataset: Dataset; onStatus?: (s: ViewStatus) => void }) {
  const map = useMap();
  const layerRef = useRef<L.GeoJSON | null>(null);
  const loaded = useRef<{ bounds: L.LatLngBounds; zoom: number; complete: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abort = useRef<AbortController | null>(null);
  const color = categoryColor(dataset.category);

  const load = () => {
    const view = map.getBounds();
    const zoom = map.getZoom();
    const prev = loaded.current;
    // what we already have still covers the view at a comparable detail level
    if (prev && prev.complete && prev.bounds.contains(view) && Math.abs(prev.zoom - zoom) < 2) return;

    const padded = view.pad(0.25);
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    onStatus?.({ loading: true });
    datasetService
      .features(dataset.id, [padded.getWest(), padded.getSouth(), padded.getEast(), padded.getNorth()], Math.round(zoom), controller.signal)
      .then((fc) => {
        if (controller.signal.aborted) return;
        layerRef.current?.clearLayers();
        layerRef.current?.addData(fc as any);
        loaded.current = { bounds: padded, zoom, complete: !fc.truncated };
        onStatus?.({ loading: false, count: fc.count, truncated: fc.truncated });
      })
      .catch((err) => {
        if (!controller.signal.aborted) onStatus?.({ loading: false, error: err.message });
      });
  };

  const schedule = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(load, FETCH_DEBOUNCE_MS);
  };

  useMapEvents({ moveend: schedule });

  useEffect(() => {
    layerRef.current = L.geoJSON(undefined, {
      style: { color, weight: 1.6, fillColor: color, fillOpacity: 0.25 },
      pointToLayer: (_f, latlng) =>
        L.circleMarker(latlng, { radius: 5, color: "#fff", weight: 1.2, fillColor: color, fillOpacity: 0.9 }),
      onEachFeature: (feature, layer) => layer.bindPopup(propertiesPopup(dataset.title, feature.properties), { maxWidth: 320 }),
    }).addTo(map);
    load();
    return () => {
      abort.current?.abort();
      if (timer.current) clearTimeout(timer.current);
      layerRef.current?.remove();
      layerRef.current = null;
      loaded.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, dataset.id, color]);

  return null;
}

/** The dataset cut to the current zones / drawn area, re-fetched whenever the area changes. */
function ClippedDataset({ dataset, clipZones, onStatus }: { dataset: Dataset; clipZones: string[]; onStatus?: (s: ViewStatus) => void }) {
  const [result, setResult] = useState<ClipResult | null>(null);
  const key = clipZones.join("|");

  useEffect(() => {
    let cancelled = false;
    onStatus?.({ loading: true });
    datasetService
      .clip(dataset.id, { selectedZones: clipZones })
      .then((r) => {
        if (cancelled) return;
        setResult(r);
        onStatus?.({ loading: false, count: r.kind === "vector" ? r.geojson.features.length : undefined });
      })
      .catch((err) => {
        if (cancelled) return;
        setResult(null);
        onStatus?.({ loading: false, error: err.message });
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset.id, key]);

  return result ? <ClipResultLayer result={result} title={dataset.title} fit={false} /> : null;
}

export type ViewStatus = { loading: boolean; count?: number; truncated?: boolean; error?: string };

/**
 * An uploaded dataset on the map, loaded in pieces:
 *  raster          -> GeoServer WMS tiles (only visible tiles at the current zoom are requested)
 *  small vector    -> features for the current view from /api/datasets/{id}/features
 *  large vector    -> GeoServer tiles when zoomed out, live features once zoomed in
 * With zones selected or an area drawn (clipZones), only the clipped part is shown.
 */
export default function DatasetLayer({
  dataset,
  opacity = 0.8,
  clipZones = [],
  onStatus,
}: {
  dataset: Dataset;
  opacity?: number;
  clipZones?: string[];
  onStatus?: (s: ViewStatus) => void;
}) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });

  if (dataset.status !== "ready") return null;
  if (clipZones.length && dataset.kind !== "table") return <ClippedDataset dataset={dataset} clipZones={clipZones} onStatus={onStatus} />;
  if (dataset.kind === "raster") return dataset.geoserver_layer ? <GeoServerTiles dataset={dataset} opacity={opacity} /> : null;
  if (dataset.kind !== "vector") return null;

  const large = (dataset.feature_count ?? 0) > TILE_ONLY_FEATURES;
  if (large && zoom < FEATURE_MIN_ZOOM && dataset.geoserver_layer) {
    return <GeoServerTiles dataset={dataset} opacity={opacity} />;
  }
  return <ViewportFeatures dataset={dataset} onStatus={onStatus} />;
}
