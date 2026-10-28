"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import { useMap } from "react-leaflet";

export type DrawMode = "polygon" | "rectangle" | null;
export type DrawnShape = GeoJSON.Feature<GeoJSON.Polygon>;

const SHAPE_STYLE: L.PathOptions = { color: "#ea580c", weight: 2.5, dashArray: "6 4", fillColor: "#fb923c", fillOpacity: 0.12 };
const SKETCH_STYLE: L.PathOptions = { ...SHAPE_STYLE, dashArray: "2 6", fillOpacity: 0.06 };

function toFeature(latlngs: L.LatLng[]): DrawnShape {
  const ring = latlngs.map((p) => [Number(p.lng.toFixed(6)), Number(p.lat.toFixed(6))]);
  ring.push(ring[0]);
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } };
}

function fromFeature(shape: DrawnShape): L.LatLngExpression[] {
  return shape.geometry.coordinates[0].slice(0, -1).map(([lng, lat]) => [lat, lng] as [number, number]);
}

/**
 * Click-to-draw polygon (double-click or click the first point to finish, Esc to cancel)
 * and drag-to-draw rectangle. The finished shape is reported as a GeoJSON Feature.
 */
export default function DrawLayer({
  mode,
  shape,
  onShapeChange,
  onDone,
}: {
  mode: DrawMode;
  shape: DrawnShape | null;
  onShapeChange?: (shape: DrawnShape | null) => void;
  onDone: () => void;
}) {
  const map = useMap();
  const shapeLayer = useRef<L.Polygon | null>(null);
  // callbacks via refs so a parent re-render doesn't restart a drawing in progress
  const onShapeChangeRef = useRef(onShapeChange);
  const onDoneRef = useRef(onDone);
  onShapeChangeRef.current = onShapeChange;
  onDoneRef.current = onDone;

  // the committed shape
  useEffect(() => {
    shapeLayer.current?.remove();
    shapeLayer.current = shape ? L.polygon(fromFeature(shape), { ...SHAPE_STYLE, interactive: false }).addTo(map) : null;
    return () => {
      shapeLayer.current?.remove();
    };
  }, [map, shape]);

  // the drawing interaction
  useEffect(() => {
    if (!mode) return;
    const container = map.getContainer();
    container.style.cursor = "crosshair";
    const hadDoubleClickZoom = map.doubleClickZoom.enabled();
    const hadDragging = map.dragging.enabled();
    map.doubleClickZoom.disable();

    const points: L.LatLng[] = [];
    const sketch = L.polygon([], { ...SKETCH_STYLE, interactive: false }).addTo(map);
    const guide = L.polyline([], { ...SKETCH_STYLE, interactive: false }).addTo(map);
    const vertices = L.layerGroup().addTo(map);
    let rectStart: L.LatLng | null = null;

    const finish = (latlngs: L.LatLng[] | null) => {
      if (latlngs && latlngs.length >= 3) onShapeChangeRef.current?.(toFeature(latlngs));
      onDoneRef.current();
    };

    const redraw = (cursor?: L.LatLng) => {
      sketch.setLatLngs(points);
      guide.setLatLngs(cursor && points.length ? [points[points.length - 1], cursor, points[0]] : []);
    };

    const onClick = (e: L.LeafletMouseEvent) => {
      if (mode !== "polygon") return;
      if (points.length >= 3) {
        const first = map.latLngToContainerPoint(points[0]);
        if (first.distanceTo(e.containerPoint) < 10) return finish(points);
      }
      points.push(e.latlng);
      L.circleMarker(e.latlng, { radius: 4, color: "#ea580c", fillColor: "#fff", fillOpacity: 1, weight: 2, interactive: false }).addTo(vertices);
      redraw();
    };
    const onDblClick = (e: L.LeafletMouseEvent) => {
      if (mode !== "polygon") return;
      L.DomEvent.stop(e);
      finish(points);
    };
    const onMove = (e: L.LeafletMouseEvent) => {
      if (mode === "polygon") redraw(e.latlng);
      if (mode === "rectangle" && rectStart) {
        const b = L.latLngBounds(rectStart, e.latlng);
        sketch.setLatLngs([b.getSouthWest(), b.getNorthWest(), b.getNorthEast(), b.getSouthEast()]);
      }
    };
    const onDown = (e: L.LeafletMouseEvent) => {
      if (mode !== "rectangle") return;
      rectStart = e.latlng;
      map.dragging.disable();
    };
    // on the document, so a release outside the map (or over an overlay) still ends the rectangle
    const onUp = (e: MouseEvent) => {
      if (mode !== "rectangle" || !rectStart) return;
      const b = L.latLngBounds(rectStart, map.mouseEventToLatLng(e));
      rectStart = null;
      if (map.latLngToContainerPoint(b.getSouthWest()).distanceTo(map.latLngToContainerPoint(b.getNorthEast())) < 8) return;
      finish([b.getSouthWest(), b.getNorthWest(), b.getNorthEast(), b.getSouthEast()]);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish(null);
      if (e.key === "Enter" && mode === "polygon") finish(points);
    };

    if (mode === "rectangle") map.dragging.disable();
    map.on("click", onClick);
    map.on("dblclick", onDblClick);
    map.on("mousemove", onMove);
    map.on("mousedown", onDown);
    document.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onKey);

    return () => {
      container.style.cursor = "";
      if (hadDoubleClickZoom) map.doubleClickZoom.enable();
      if (hadDragging) map.dragging.enable();
      map.off("click", onClick);
      map.off("dblclick", onDblClick);
      map.off("mousemove", onMove);
      map.off("mousedown", onDown);
      document.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onKey);
      sketch.remove();
      guide.remove();
      vertices.remove();
    };
  }, [map, mode]);

  return null;
}
