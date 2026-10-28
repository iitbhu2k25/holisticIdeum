"""Turn an uploaded file into something the maps can serve in pieces.

Runs in a background task after the upload request returns; the Dataset row's status
moves processing -> ready / failed and the upload page polls it.
"""
import math
import traceback
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import rasterio
from rasterio.shutil import copy as rio_copy
from rasterio.warp import transform_bounds
from shapely.geometry import shape

from app.api.service.datasets import geoserver_publish
from app.api.service.holistic.geo_utils import fetch_area_geojson, _guess_zone_field, normalize_zone_value
from app.conf.logging import logger
from app.database.config.session import SessionLocal
from app.database.models import Dataset
from app.database.models.model_dataset import KIND_RASTER, KIND_VECTOR, KIND_TABLE, STATUS_READY, STATUS_FAILED

VECTOR_LAYER = "data"
LAT_NAMES = {"lat", "latitude", "lat_dd", "y", "y_coord", "ycoord", "northing_dd"}
LON_NAMES = {"lon", "lng", "long", "longitude", "lon_dd", "long_dd", "x", "x_coord", "xcoord"}
STATS_SAMPLE = 1024  # overview size used for min/max so a 1 GB raster is never read whole


def _json_safe(value):
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, (np.floating, np.integer)):
        return _json_safe(value.item())
    return value


# ---------------- raster ----------------
def _raster_stats(path: Path) -> dict:
    with rasterio.open(path) as src:
        scale = max(src.width, src.height) / STATS_SAMPLE
        out_shape = (max(1, int(src.height / scale)), max(1, int(src.width / scale))) if scale > 1 else (src.height, src.width)
        band = src.read(1, out_shape=out_shape, masked=True).astype("float64")
        values = band.compressed()
        values = values[np.isfinite(values)]
        if values.size == 0:
            return {"min": None, "max": None, "mean": None, "nodata": src.nodata}
        return {
            "min": float(values.min()),
            "max": float(values.max()),
            "mean": float(values.mean()),
            "nodata": _json_safe(src.nodata),
        }


def process_raster(ds: Dataset, workdir: Path) -> None:
    src_path = Path(ds.source_path)
    cog_path = workdir / "data.tif"
    with rasterio.open(src_path) as src:
        if src.crs is None:
            raise ValueError("Raster has no coordinate reference system; re-export it with a CRS")
        info = {
            "crs": src.crs.to_string(),
            "width": src.width,
            "height": src.height,
            "bands": src.count,
            "dtype": src.dtypes[0],
            "resolution": list(src.res),
        }
        bbox = list(transform_bounds(src.crs, "EPSG:4326", *src.bounds, densify_pts=21))

    # COG = internal tiles + overviews, so GeoServer and clips read only the blocks they need.
    rio_copy(
        str(src_path), str(cog_path), driver="COG",
        compress="DEFLATE", BIGTIFF="IF_SAFER", NUM_THREADS="ALL_CPUS", OVERVIEW_RESAMPLING="AVERAGE",
    )
    stats = _raster_stats(cog_path)
    info["stats"] = stats

    ds.kind = KIND_RASTER
    ds.file_path = str(cog_path)
    ds.bbox = bbox
    ds.info = info
    ds.geoserver_layer = geoserver_publish.publish_raster(cog_path, f"ds_{ds.id}", stats if info["bands"] == 1 else None)
    # The COG carries the same pixels; drop the original so a 1 GB upload isn't stored twice.
    if src_path != cog_path:
        src_path.unlink(missing_ok=True)
        ds.source_path = str(cog_path)


# ---------------- vector ----------------
def _clean(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    gdf = gdf[gdf.geometry.notna() & ~gdf.geometry.is_empty]
    if gdf.crs is None:
        minx, miny, maxx, maxy = gdf.total_bounds
        if -180 <= minx <= 180 and -180 <= maxx <= 180 and -90 <= miny <= 90 and -90 <= maxy <= 90:
            gdf = gdf.set_crs("EPSG:4326")
        else:
            raise ValueError("Vector file has no CRS (missing .prj?) and coordinates are not longitude/latitude")
    gdf = gdf.to_crs("EPSG:4326")
    invalid = ~gdf.geometry.is_valid
    if invalid.any():
        gdf.loc[invalid, "geometry"] = gdf.loc[invalid, "geometry"].make_valid()
    # GPKG column names must be unique case-insensitively
    seen, columns = set(), []
    for col in gdf.columns:
        name, n = str(col), 1
        while name.lower() in seen:
            name, n = f"{col}_{n}", n + 1
        seen.add(name.lower())
        columns.append(name)
    gdf.columns = columns
    return gdf.set_geometry("geometry" if "geometry" in gdf.columns else gdf.geometry.name)


def _write_vector(ds: Dataset, gdf: gpd.GeoDataFrame, workdir: Path, info: dict) -> None:
    if gdf.empty:
        raise ValueError("No features with geometry were found in the file")
    gpkg_path = workdir / "data.gpkg"
    gpkg_path.unlink(missing_ok=True)
    gdf.to_file(gpkg_path, layer=VECTOR_LAYER, driver="GPKG", engine="pyogrio", SPATIAL_INDEX="YES")

    ds.kind = KIND_VECTOR
    ds.file_path = str(gpkg_path)
    ds.bbox = [float(v) for v in gdf.total_bounds]
    ds.feature_count = int(len(gdf))
    ds.info = {
        **info,
        "columns": [c for c in gdf.columns if c != gdf.geometry.name],
        "geometry_types": sorted(set(gdf.geom_type.dropna().unique())),
    }
    ds.geoserver_layer = geoserver_publish.publish_vector(gpkg_path, f"ds_{ds.id}", VECTOR_LAYER)


def _read_vector(path: Path, fmt: str) -> gpd.GeoDataFrame:
    if fmt == "shapefile":
        import pyogrio
        layers = pyogrio.list_layers(f"/vsizip/{path}")
        if len(layers) == 0:
            raise ValueError("No shapefile (.shp with .shx/.dbf) found inside the zip")
        gdf = gpd.read_file(f"/vsizip/{path}", layer=layers[0][0], engine="pyogrio")
        if len(layers) > 1:
            gdf.attrs["skipped_layers"] = [str(l[0]) for l in layers[1:]]
        return gdf
    return gpd.read_file(path, engine="pyogrio")


def process_vector(ds: Dataset, workdir: Path) -> None:
    gdf = _read_vector(Path(ds.source_path), ds.source_format)
    info = {"source_crs": gdf.crs.to_string() if gdf.crs else None}
    if gdf.attrs.get("skipped_layers"):
        info["skipped_layers"] = gdf.attrs["skipped_layers"]
    _write_vector(ds, _clean(gdf), workdir, info)


# ---------------- csv ----------------
def _read_csv(path: Path) -> pd.DataFrame:
    for encoding in ("utf-8-sig", "latin-1"):
        try:
            return pd.read_csv(path, encoding=encoding, low_memory=False)
        except UnicodeDecodeError:
            continue
    raise ValueError("Could not decode the CSV file")


def _find_coord_columns(df: pd.DataFrame) -> tuple[str, str] | None:
    lower = {c.strip().lower(): c for c in df.columns}
    lat = next((lower[n] for n in lower if n in LAT_NAMES), None)
    lon = next((lower[n] for n in lower if n in LON_NAMES), None)
    if not lat or not lon:
        return None
    lat_v = pd.to_numeric(df[lat], errors="coerce")
    lon_v = pd.to_numeric(df[lon], errors="coerce")
    ok = lat_v.between(-90, 90) & lon_v.between(-180, 180)
    return (lat, lon) if ok.mean() > 0.5 else None


def _find_join_column(df: pd.DataFrame, zone_names: set[str], requested: str | None) -> tuple[str | None, float]:
    candidates = [requested] if requested else list(df.columns)
    best, best_rate = None, 0.0
    for col in candidates:
        if col not in df.columns:
            raise ValueError(f"Join column '{col}' is not in the CSV; columns are: {', '.join(map(str, df.columns))}")
        values = df[col].dropna().map(normalize_zone_value)
        if values.empty:
            continue
        rate = float(values.isin(zone_names).mean())
        if rate > best_rate:
            best, best_rate = col, rate
    return best, best_rate


def process_csv(ds: Dataset, workdir: Path) -> None:
    df = _read_csv(Path(ds.source_path))
    df.columns = [str(c).strip() for c in df.columns]
    info: dict = {"rows": int(len(df))}

    coords = _find_coord_columns(df)
    if coords:
        lat, lon = coords
        lat_v = pd.to_numeric(df[lat], errors="coerce")
        lon_v = pd.to_numeric(df[lon], errors="coerce")
        keep = lat_v.notna() & lon_v.notna()
        gdf = gpd.GeoDataFrame(df[keep], geometry=gpd.points_from_xy(lon_v[keep], lat_v[keep]), crs="EPSG:4326")
        info.update({"csv_mode": "points", "lat_column": lat, "lon_column": lon, "skipped_rows": int((~keep).sum())})
        _write_vector(ds, _clean(gdf), workdir, info)
        return

    # No coordinates: attach rows to Area zones by name.
    area = fetch_area_geojson().get("features", []) or []
    zone_field = _guess_zone_field(area)
    zones = {}
    for ft in area:
        name = normalize_zone_value((ft.get("properties") or {}).get(zone_field, ""))
        if name and ft.get("geometry"):
            zones.setdefault(name, []).append(shape(ft["geometry"]))

    join_col, rate = _find_join_column(df, set(zones), ds.info.get("join_field"))
    if join_col and rate > 0:
        df["_zone"] = df[join_col].map(normalize_zone_value)
        df = df.drop(columns=[c for c in df.columns if c.lower() == "matched_zone"])
        matched = df[df["_zone"].isin(zones)]
        numeric = matched.select_dtypes("number").columns.tolist()
        agg = {c: ("mean" if c in numeric else "first") for c in matched.columns if c != "_zone"}
        grouped = matched.groupby("_zone", as_index=False).agg(agg)
        from shapely.ops import unary_union
        grouped["geometry"] = grouped["_zone"].map(lambda z: unary_union(zones[z]))
        gdf = gpd.GeoDataFrame(grouped.rename(columns={"_zone": "matched_zone"}), geometry="geometry", crs="EPSG:4326")
        unmatched = df.loc[~df["_zone"].isin(zones), join_col].dropna().astype(str).unique().tolist()
        info.update({
            "csv_mode": "zone_join",
            "join_column": join_col,
            "zone_field": zone_field,
            "matched_rows": int(len(matched)),
            "unmatched_values": unmatched[:30],
            "aggregated": bool(len(matched) > len(grouped)),
        })
        _write_vector(ds, gdf, workdir, info)
        return

    # Plain table — still useful as attribute data in the panels.
    ds.kind = KIND_TABLE
    ds.file_path = ds.source_path
    ds.feature_count = int(len(df))
    ds.info = {**info, "csv_mode": "table", "columns": list(df.columns)}


PROCESSORS = {
    "geotiff": process_raster,
    "shapefile": process_vector,
    "geojson": process_vector,
    "gpkg": process_vector,
    "kml": process_vector,
    "csv": process_csv,
}


def process_dataset(dataset_id: int) -> None:
    db = SessionLocal()
    try:
        ds = db.get(Dataset, dataset_id)
        if ds is None:
            return
        workdir = Path(ds.source_path).parent
        try:
            PROCESSORS[ds.source_format](ds, workdir)
            ds.status = STATUS_READY
            ds.error = None
        except Exception as exc:
            logger.error("Dataset %s processing failed: %s", dataset_id, traceback.format_exc())
            db.rollback()
            ds = db.get(Dataset, dataset_id)
            ds.status = STATUS_FAILED
            ds.error = str(exc)[:2000]
        db.commit()
    finally:
        db.close()
