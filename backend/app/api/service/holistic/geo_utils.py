"""Shared GeoServer / raster helpers for the holistic analysis services."""
import json
import os
import re
from functools import wraps
from pathlib import Path

import numpy as np
import rasterio
import requests
from pyproj import Transformer
from rasterio.io import MemoryFile
from rasterio.mask import mask
from shapely.geometry import shape, mapping
from shapely.ops import transform as shapely_transform
from shapely.ops import unary_union

from app.api.exception.exceptions import JsonError
from app.conf.settings import Settings

MEDIA_DIR = Path(Settings().MEDIA_DIR)

# A polygon drawn on the map travels in selected_zones as "DRAWN AREA::<geojson>", so every
# zone-based analysis/clip also works on (or is narrowed by) the user's own area.
DRAWN_AREA = "DRAWN AREA"
DRAWN_PREFIX = f"{DRAWN_AREA}::"


def handle_errors(label: str):
    """Map GeoServer failures to 502 and anything else to 500, like the old Django views did."""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            try:
                return func(*args, **kwargs)
            except JsonError:
                raise
            except requests.RequestException as exc:
                raise JsonError(502, detail=f"GeoServer fetch failed: {exc}")
            except Exception as exc:
                raise JsonError(500, detail=f"{label} failed: {exc}")
        return wrapper
    return decorator


def polygon_from_geojson(obj: dict):
    """Polygonal shapely geometry from a GeoJSON geometry, Feature or FeatureCollection."""
    if obj.get("type") == "FeatureCollection":
        geom = unary_union([shape(f["geometry"]) for f in obj.get("features", []) if f.get("geometry")])
    elif obj.get("type") == "Feature":
        geom = shape(obj["geometry"])
    else:
        geom = shape(obj)
    if not geom.is_valid:
        geom = geom.buffer(0)
    if geom.geom_type == "GeometryCollection":
        geom = unary_union([g for g in geom.geoms if g.geom_type in ("Polygon", "MultiPolygon")])
    if geom.is_empty or geom.geom_type not in ("Polygon", "MultiPolygon"):
        raise JsonError(400, detail="The drawn area must be a polygon")
    return geom


def split_drawn_area(selected_zones: list) -> tuple[list, object | None]:
    """(zone names, drawn polygon or None) from a selected_zones list."""
    names, drawn = [], []
    for z in selected_zones:
        text = str(z)
        if text.startswith(DRAWN_PREFIX):
            try:
                drawn.append(polygon_from_geojson(json.loads(text[len(DRAWN_PREFIX):])))
            except (ValueError, KeyError, TypeError):
                raise JsonError(400, detail="Could not read the drawn area")
        elif text.strip():
            names.append(z)
    return names, (unary_union(drawn) if drawn else None)


def _polygonal(geom):
    if geom.geom_type == "GeometryCollection":
        geom = unary_union([g for g in geom.geoms if g.geom_type in ("Polygon", "MultiPolygon")])
    return geom


def require_zones(selected_zones: list) -> list:
    if not isinstance(selected_zones, list) or not selected_zones:
        raise JsonError(400, detail="selected_zones is required")
    return selected_zones


def round_stats(stats: dict, digits: int = 4) -> dict:
    return {k: round(stats[k], digits) if stats.get(k) is not None else None for k in ("mean", "min", "max")}


def _looks_like_tiff(content: bytes) -> bool:
    if not content or len(content) < 4:
        return False
    # TIFF headers: II*\x00 or MM\x00*
    return content.startswith(b"II*\x00") or content.startswith(b"MM\x00*")


def _normalize_geoserver_base(url: str) -> str:
    base = (url or "").strip().rstrip("/")
    if not base:
        return ""
    # If a REST URL is provided (e.g. .../geoserver/rest), convert to service base.
    if base.endswith("/rest"):
        base = base[: -len("/rest")]
    return base


def get_geoserver_candidates() -> list[str]:
    raw_candidates = [
        os.environ.get("GEOSERVER_URL", "").strip(),
        os.environ.get("NEXT_ENV_GEOSERVER", "").strip(),
        os.environ.get("GEOSERVER_BASE_URL", "").strip(),
        "http://geoserver:8080/geoserver",
        "http://localhost:9090/geoserver",
    ]
    normalized: list[str] = []
    for item in raw_candidates:
        base = _normalize_geoserver_base(item)
        if base and base not in normalized:
            normalized.append(base)
    return normalized


def fetch_vector_layer_geojson(layer_name: str, workspace: str = "dss_vector", timeout: int = 60) -> dict:
    last_exc = None
    for geoserver_base in get_geoserver_candidates():
        url = (
            f"{geoserver_base}/{workspace}/wfs"
            "?service=WFS&version=1.0.0&request=GetFeature"
            f"&typeName={workspace}:{layer_name}&outputFormat=application/json&srsName=EPSG:4326"
        )
        try:
            response = requests.get(url, timeout=timeout)
            response.raise_for_status()
            return response.json()
        except requests.RequestException as exc:
            last_exc = exc
            continue

    if last_exc:
        raise last_exc
    raise RuntimeError(f"No valid GeoServer URL candidates available for layer: {workspace}:{layer_name}")


def fetch_area_geojson() -> dict:
    return fetch_vector_layer_geojson("Area", timeout=30)


def fetch_coverage_tiff(coverage_name: str, bbox: tuple[float, float, float, float]) -> bytes:
    minx, miny, maxx, maxy = bbox
    attempt_errors: list[str] = []

    # Keep image dimensions proportional to bbox aspect ratio for WMS fallback.
    dx = max(maxx - minx, 1e-9)
    dy = max(maxy - miny, 1e-9)
    base_size = 1024
    if dx >= dy:
        width = base_size
        height = max(256, int(base_size * (dy / dx)))
    else:
        height = base_size
        width = max(256, int(base_size * (dx / dy)))

    for geoserver_base in get_geoserver_candidates():
        wcs_url = (
            f"{geoserver_base}/ows"
            "?service=WCS"
            "&version=2.0.1"
            "&request=GetCoverage"
            f"&coverageId={coverage_name}"
            "&format=image/tiff"
            f"&subset=Long({minx},{maxx})"
            f"&subset=Lat({miny},{maxy})"
        )
        try:
            response = requests.get(wcs_url, timeout=60)
            response.raise_for_status()
            if _looks_like_tiff(response.content):
                return response.content
            attempt_errors.append(f"{geoserver_base} [WCS] -> non-TIFF response")
        except requests.RequestException as exc:
            attempt_errors.append(f"{geoserver_base} [WCS] -> {exc}")

        # Fallback for layers that are available via WMS but not WCS (common for some coverage setups).
        wms_url = (
            f"{geoserver_base}/wms"
            "?service=WMS"
            "&version=1.1.0"
            "&request=GetMap"
            f"&layers={coverage_name}"
            f"&bbox={minx},{miny},{maxx},{maxy}"
            f"&width={width}"
            f"&height={height}"
            "&srs=EPSG:4326"
            "&styles="
            "&format=image/geotiff"
            "&transparent=true"
        )
        try:
            response = requests.get(wms_url, timeout=60)
            response.raise_for_status()
            if _looks_like_tiff(response.content):
                return response.content
            attempt_errors.append(f"{geoserver_base} [WMS] -> non-TIFF response")
        except requests.RequestException as exc:
            attempt_errors.append(f"{geoserver_base} [WMS] -> {exc}")
            continue

    if attempt_errors:
        raise requests.RequestException(
            f"Unable to fetch coverage '{coverage_name}'. Attempts: " + " | ".join(attempt_errors)
        )
    raise RuntimeError(f"Unable to fetch coverage: {coverage_name}")


def fetch_first_available_coverage_tiff(
    coverage_candidates: list[str], bbox: tuple[float, float, float, float]
) -> tuple[str, bytes]:
    errors: list[str] = []
    for coverage_name in coverage_candidates:
        try:
            return coverage_name, fetch_coverage_tiff(coverage_name, bbox)
        except requests.RequestException as exc:
            errors.append(f"{coverage_name}: {exc}")
            continue
    raise requests.RequestException(
        "Unable to fetch any coverage from candidates. Attempts: " + " | ".join(errors)
    )


def _guess_zone_field(features: list[dict]) -> str:
    if not features:
        return ""
    props = features[0].get("properties", {}) or {}
    keys = list(props.keys())
    priority = [
        "id_", "ID_", "zone_id", "Zone_ID", "zone", "Zone", "ZONE",
        "area_name", "Area_Name", "AREA_NAME", "area", "Area", "AREA",
        "name", "Name", "NAME",
    ]
    for key in priority:
        if key in keys:
            return key
    # Fallback: prefer any key that carries non-empty string categories across features.
    for key in keys:
        values = [str((ft.get("properties", {}) or {}).get(key, "")).strip() for ft in features]
        distinct_non_empty = {v for v in values if v}
        if len(distinct_non_empty) > 1:
            return key
    return keys[0] if keys else ""


def normalize_zone_value(value) -> str:
    text = str(value or "").strip()
    text = re.sub(r"\s+", " ", text)
    return text.upper()


def resolve_zone_geometries(selected_zones: list[str]) -> tuple[dict[str, list[dict]], str]:
    """Return ({ZONE_NAME: [geojson geometries]}, zone_field) for the selected zones of the Area layer.

    A drawn area on its own is returned as {"DRAWN AREA": [polygon]}; together with zones it
    narrows each zone to its overlap with the drawing.
    """
    selected_zones, drawn = split_drawn_area(selected_zones)
    if not selected_zones:
        if drawn is None:
            raise JsonError(400, detail="selected_zones is required")
        return {DRAWN_AREA: [mapping(drawn)]}, "drawn_area"

    zone_geometries, zone_field = _area_zone_geometries(selected_zones)
    if drawn is None:
        return zone_geometries, zone_field

    narrowed = {}
    for name, geoms in zone_geometries.items():
        part = _polygonal(unary_union([shape(g) for g in geoms]).intersection(drawn))
        if not part.is_empty:
            narrowed[name] = [mapping(part)]
    if not narrowed:
        raise JsonError(400, detail="The drawn area does not overlap the selected zones")
    return narrowed, zone_field


def _area_zone_geometries(selected_zones: list[str]) -> tuple[dict[str, list[dict]], str]:
    area_geojson = fetch_area_geojson()
    features = area_geojson.get("features", []) or []
    zone_field = _guess_zone_field(features)
    if not zone_field:
        raise JsonError(500, detail="Unable to detect zone field in Area layer")

    selected_set = {normalize_zone_value(z) for z in selected_zones if str(z).strip()}
    zone_geometries: dict[str, list[dict]] = {}
    for feature in features:
        props = feature.get("properties", {}) or {}
        zone_name = normalize_zone_value(str(props.get(zone_field, "")).strip())
        if zone_name in selected_set and feature.get("geometry"):
            zone_geometries.setdefault(zone_name, []).append(feature["geometry"])

    zone_geometries = {k: v for k, v in zone_geometries.items() if v}
    if not zone_geometries:
        available = sorted({normalize_zone_value((ft.get("properties", {}) or {}).get(zone_field, "")) for ft in features})
        raise JsonError(
            404,
            detail="Selected zones not found in Area layer",
            zone_field=zone_field,
            selected_zones=sorted(selected_set),
            available_zones=[v for v in available if v],
        )

    return zone_geometries, zone_field


def reproject_geometries(geometries: list[dict], dst_crs) -> list[dict]:
    if not dst_crs:
        return geometries
    if str(dst_crs).upper() in {"EPSG:4326", "WGS84"}:
        return geometries
    transformer = Transformer.from_crs("EPSG:4326", dst_crs, always_xy=True)
    result = []
    for geom in geometries:
        shp = shape(geom)
        transformed = shapely_transform(transformer.transform, shp)
        result.append(mapping(transformed))
    return result


def zonal_stats_for_raster_dataset(src: rasterio.io.DatasetReader, zone_geometries: dict[str, list[dict]]) -> dict[str, dict]:
    output: dict[str, dict] = {}
    nodata = src.nodata
    for zone_name, geoms in zone_geometries.items():
        try:
            geoms_projected = reproject_geometries(geoms, src.crs)
            masked, _ = mask(src, geoms_projected, crop=True, filled=False)
            band = masked[0]
            if hasattr(band, "compressed"):
                values = band.compressed()
            else:
                arr = np.asarray(band).astype(float)
                if nodata is not None:
                    arr = arr[arr != nodata]
                values = arr[np.isfinite(arr)]
            if values.size == 0:
                output[zone_name] = {"mean": None, "min": None, "max": None}
            else:
                output[zone_name] = {
                    "mean": float(np.nanmean(values)),
                    "min": float(np.nanmin(values)),
                    "max": float(np.nanmax(values)),
                }
        except Exception:
            output[zone_name] = {"mean": None, "min": None, "max": None}
    return output


def zonal_stats_for_tiff_bytes(tiff_bytes: bytes, zone_geometries: dict[str, list[dict]]) -> dict[str, dict]:
    with MemoryFile(tiff_bytes) as memfile:
        with memfile.open() as src:
            return zonal_stats_for_raster_dataset(src, zone_geometries)


def bounds_from_zone_geometries(zone_geometries: dict[str, list[dict]]) -> tuple[float, float, float, float]:
    minx = miny = float("inf")
    maxx = maxy = float("-inf")
    found = False
    for geoms in zone_geometries.values():
        for geom in geoms:
            try:
                b = shape(geom).bounds
                minx = min(minx, b[0])
                miny = min(miny, b[1])
                maxx = max(maxx, b[2])
                maxy = max(maxy, b[3])
                found = True
            except Exception:
                continue
    if not found:
        raise ValueError("Unable to compute selected zone bounds")
    return (minx, miny, maxx, maxy)


def _clip_dataset_to_zones(src, zone_geometries: dict[str, list[dict]]) -> bytes:
    all_geoms = [geom for geoms in zone_geometries.values() for geom in geoms]
    if not all_geoms:
        raise ValueError("No zone geometries to clip")

    union_geom_wgs84 = unary_union([shape(g) for g in all_geoms])
    union_geom_src = reproject_geometries([mapping(union_geom_wgs84)], src.crs)[0]

    nodata_value = src.nodata if src.nodata is not None else -9999.0
    clipped, clipped_transform = mask(src, [union_geom_src], crop=True, filled=True, nodata=nodata_value)

    profile = src.profile.copy()
    profile.update({
        "height": clipped.shape[1],
        "width": clipped.shape[2],
        "transform": clipped_transform,
        "nodata": nodata_value,
        "compress": "lzw",
    })

    with MemoryFile() as out_mem:
        with out_mem.open(**profile) as out_ds:
            out_ds.write(clipped)
        return out_mem.read()


def clip_coverage_tiff_to_geometries(coverage_name: str, zone_geometries: dict[str, list[dict]]) -> bytes:
    tiff_bytes = fetch_coverage_tiff(coverage_name, bounds_from_zone_geometries(zone_geometries))
    with MemoryFile(tiff_bytes) as memfile:
        with memfile.open() as src:
            return _clip_dataset_to_zones(src, zone_geometries)


def clip_local_tif_to_zones(local_path: Path, zone_geometries: dict) -> bytes:
    """Clip a local GeoTIFF to the union of zone geometries and return bytes."""
    with rasterio.open(local_path) as src:
        return _clip_dataset_to_zones(src, zone_geometries)
