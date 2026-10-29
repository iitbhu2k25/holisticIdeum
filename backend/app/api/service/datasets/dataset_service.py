import hashlib
import json
import math
import shutil
import uuid
from typing import Sequence
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import rasterio
from fastapi import UploadFile
from rasterio.io import MemoryFile
from rasterio.mask import mask
from shapely.geometry import mapping, shape
from shapely.ops import unary_union
from sqlalchemy.exc import IntegrityError, ProgrammingError
from sqlalchemy.orm import Session

from app.api.exception.exceptions import JsonError
from app.api.service.datasets import geoserver_publish
from app.api.service.datasets.processing import VECTOR_LAYER, process_dataset
from app.api.service.holistic.geo_utils import DRAWN_PREFIX, MEDIA_DIR, reproject_geometries, resolve_zone_geometries
from app.database.models import Dataset, User
from app.database.models.model_dataset import (
    CATEGORIES, KIND_RASTER, KIND_VECTOR, KIND_TABLE, STATUS_PROCESSING, STATUS_READY, STATUS_FAILED,
)

MAX_UPLOAD_BYTES = 1024 ** 3  # 1 GB
CHUNK = 4 * 1024 * 1024
FORMATS = {
    ".tif": ("geotiff", KIND_RASTER),
    ".tiff": ("geotiff", KIND_RASTER),
    ".zip": ("shapefile", KIND_VECTOR),
    ".geojson": ("geojson", KIND_VECTOR),
    ".json": ("geojson", KIND_VECTOR),
    ".gpkg": ("gpkg", KIND_VECTOR),
    ".kml": ("kml", KIND_VECTOR),
    ".csv": ("csv", KIND_VECTOR),
}
MAX_VIEW_FEATURES = 5000
MAX_CLIP_FEATURES = 50000
MAX_CLIP_PIXELS = 40_000_000  # beyond this the clip is read from a coarser overview


def _datasets_dir() -> Path:
    d = MEDIA_DIR / "datasets"
    d.mkdir(parents=True, exist_ok=True)
    return d


def dataset_out(ds: Dataset) -> dict:
    return {
        "id": ds.id,
        "title": ds.title,
        "category": ds.category,
        "category_label": CATEGORIES.get(ds.category, ds.category),
        "criterion": ds.criterion,
        "kind": ds.kind,
        "source_format": ds.source_format,
        "original_filename": ds.original_filename,
        "size_bytes": ds.size_bytes,
        "status": ds.status,
        "error": ds.error,
        "geoserver_layer": ds.geoserver_layer,
        "bbox": ds.bbox,
        "feature_count": ds.feature_count,
        "info": ds.info,
        "uploaded_by": ds.uploader.email if ds.uploader else None,
        "created_at": ds.created_at.isoformat(),
    }


def _ready(db: Session, dataset_id: int) -> Dataset:
    ds = db.get(Dataset, dataset_id)
    if ds is None:
        raise JsonError(404, detail="Dataset not found")
    if ds.status != STATUS_READY:
        raise JsonError(409, detail=f"Dataset is {ds.status}", error=ds.error)
    return ds


def _json_value(v):
    if isinstance(v, (np.floating, float)):
        return None if not math.isfinite(float(v)) else float(v)
    if isinstance(v, np.integer):
        return int(v)
    if isinstance(v, (pd.Timestamp,)):
        return v.isoformat()
    return v


def _feature_collection(gdf: gpd.GeoDataFrame, **extra) -> dict:
    # to_json handles numpy/NaN/timestamps consistently
    fc = json.loads(gdf.to_json(drop_id=True, na="null")) if len(gdf) else {"type": "FeatureCollection", "features": []}
    fc.update(extra)
    return fc


def clip_geometry(selected_zones: Sequence[str] | None, polygon: dict | None):
    """Area to clip to, in EPSG:4326: the selected zones, a drawn polygon, or their overlap when both are given.

    The drawn polygon may also arrive inside selected_zones (see geo_utils.DRAWN_PREFIX).
    """
    zones = list(selected_zones or [])
    if polygon:
        zones.append(DRAWN_PREFIX + json.dumps(polygon))
    if not zones:
        raise JsonError(400, detail="Select zones or draw a polygon to clip to")
    zone_geoms, _ = resolve_zone_geometries(zones)
    return unary_union([shape(g) for geoms in zone_geoms.values() for g in geoms])


class Dataset_service:

    def categories() -> list[dict]:
        return [{"key": k, "label": v} for k, v in CATEGORIES.items()]

    def upload(db: Session, user: User, file: UploadFile, category: str, criterion: str | None,
               title: str | None, join_field: str | None) -> Dataset:
        if category not in CATEGORIES:
            raise JsonError(400, detail=f"Unknown category '{category}'", categories=list(CATEGORIES))
        filename = Path(file.filename or "upload").name
        ext = Path(filename).suffix.lower()
        if ext not in FORMATS:
            raise JsonError(400, detail=f"Unsupported file type '{ext}'. Allowed: {', '.join(sorted(FORMATS))}")
        source_format, kind = FORMATS[ext]

        incoming = _datasets_dir() / "_incoming"
        incoming.mkdir(exist_ok=True)
        tmp = incoming / f"{uuid.uuid4().hex}{ext}"
        digest, size = hashlib.sha256(), 0
        try:
            with tmp.open("wb") as out:
                while chunk := file.file.read(CHUNK):
                    size += len(chunk)
                    if size > MAX_UPLOAD_BYTES:
                        raise JsonError(413, detail="File is larger than the 1 GB limit")
                    digest.update(chunk)
                    out.write(chunk)
            if size == 0:
                raise JsonError(400, detail="The file is empty")

            file_hash = digest.hexdigest()
            existing = db.query(Dataset).filter(Dataset.file_hash == file_hash).first()
            if existing is not None:
                raise JsonError(
                    409,
                    detail=(
                        f"Duplicate data: this file was already uploaded as \"{existing.title}\" "
                        f"in {CATEGORIES.get(existing.category, existing.category)}"
                        f"{' / ' + existing.criterion if existing.criterion else ''} "
                        f"on {existing.created_at:%d %b %Y}"
                        f"{' by ' + existing.uploader.email if existing.uploader else ''}."
                    ),
                    duplicate_of=existing.id,
                )

            ds = Dataset(
                uploaded_by=user.id,
                title=(title or Path(filename).stem).strip()[:255],
                category=category,
                criterion=(criterion or "").strip()[:255] or None,
                kind=kind,
                source_format=source_format,
                original_filename=filename[:255],
                file_hash=file_hash,
                size_bytes=size,
                source_path="",
                status=STATUS_PROCESSING,
                info={"join_field": join_field.strip()} if join_field and join_field.strip() else {},
            )
            db.add(ds)
            try:
                db.flush()
            except IntegrityError:
                db.rollback()
                raise JsonError(409, detail="Duplicate data: this file is being uploaded by someone else right now.")

            workdir = _datasets_dir() / category / str(ds.id)
            workdir.mkdir(parents=True, exist_ok=True)
            final = workdir / f"source{ext}"
            shutil.move(str(tmp), final)
            ds.source_path = str(final)
            db.commit()
            db.refresh(ds)
            return ds
        finally:
            tmp.unlink(missing_ok=True)

    def process(dataset_id: int):
        process_dataset(dataset_id)

    def list(db: Session, user: User | None, category: str | None, criterion: str | None, kind: str | None) -> list[dict]:
        query = db.query(Dataset)
        if user is None or not user.is_superuser:
            query = query.filter(Dataset.status == STATUS_READY)
        if category:
            query = query.filter(Dataset.category == category)
        if criterion:
            query = query.filter(Dataset.criterion == criterion)
        if kind:
            query = query.filter(Dataset.kind == kind)
        return [dataset_out(ds) for ds in query.order_by(Dataset.category, Dataset.criterion, Dataset.title)]

    def get(db: Session, dataset_id: int) -> dict:
        ds = db.get(Dataset, dataset_id)
        if ds is None:
            raise JsonError(404, detail="Dataset not found")
        return dataset_out(ds)

    def update(db: Session, dataset_id: int, data: dict) -> dict:
        ds = db.get(Dataset, dataset_id)
        if ds is None:
            raise JsonError(404, detail="Dataset not found")
        if "category" in data and data["category"] not in CATEGORIES:
            raise JsonError(400, detail=f"Unknown category '{data['category']}'")
        for key in ("title", "category", "criterion"):
            if key in data and data[key] is not None:
                value = str(data[key]).strip()[:255]
                setattr(ds, key, value or None if key == "criterion" else value)
        db.commit()
        return dataset_out(ds)

    def retry(db: Session, dataset_id: int) -> Dataset:
        ds = db.get(Dataset, dataset_id)
        if ds is None:
            raise JsonError(404, detail="Dataset not found")
        if ds.status != STATUS_FAILED:
            raise JsonError(409, detail="Only failed datasets can be reprocessed")
        if ds.geoserver_layer:
            geoserver_publish.unpublish(ds.geoserver_layer, ds.kind)
            ds.geoserver_layer = None
        ds.status, ds.error = STATUS_PROCESSING, None
        db.commit()
        return ds

    def delete(db: Session, dataset_id: int) -> dict:
        ds = db.get(Dataset, dataset_id)
        if ds is None:
            raise JsonError(404, detail="Dataset not found")
        if ds.geoserver_layer:
            geoserver_publish.unpublish(ds.geoserver_layer, ds.kind)
        if ds.source_path:
            shutil.rmtree(Path(ds.source_path).parent, ignore_errors=True)
        db.delete(ds)
        db.commit()
        return {"ok": True}

    def mark_interrupted(db: Session) -> int:
        """Called at startup: anything still 'processing' lost its worker when the server stopped."""
        try:
            count = (
                db.query(Dataset)
                .filter(Dataset.status == STATUS_PROCESSING)
                .update({"status": STATUS_FAILED, "error": "Processing was interrupted by a server restart; retry it"})
            )
        except ProgrammingError:
            # fresh database: tables come from start.sh (alembic), which may not have run yet
            db.rollback()
            return 0
        db.commit()
        return count

    # ---------------- serving ----------------
    def features(db: Session, dataset_id: int, bbox: tuple[float, float, float, float], zoom: float, limit: int) -> dict:
        """Only the features in view, simplified to the current zoom, so big layers load in pieces."""
        ds = _ready(db, dataset_id)
        if ds.kind != KIND_VECTOR:
            raise JsonError(400, detail="Dataset is not a vector layer")
        limit = max(1, min(limit, MAX_VIEW_FEATURES))
        gdf = gpd.read_file(ds.file_path, layer=VECTOR_LAYER, bbox=bbox, max_features=limit + 1, engine="pyogrio")
        truncated = len(gdf) > limit
        gdf = gdf.iloc[:limit]
        if len(gdf) and not set(gdf.geom_type.unique()) <= {"Point", "MultiPoint"}:
            # about one screen pixel in degrees at this zoom
            tolerance = 360.0 / (256 * 2 ** max(0.0, zoom))
            gdf["geometry"] = gdf.geometry.simplify(tolerance, preserve_topology=True)
        return _feature_collection(gdf, truncated=truncated, count=int(len(gdf)))

    def rows(db: Session, dataset_id: int, offset: int, limit: int) -> dict:
        ds = _ready(db, dataset_id)
        limit = max(1, min(limit, 1000))
        if ds.kind == KIND_TABLE:
            df = pd.read_csv(ds.file_path, skiprows=range(1, offset + 1), nrows=limit, low_memory=False)
        elif ds.kind == KIND_VECTOR:
            df = gpd.read_file(ds.file_path, layer=VECTOR_LAYER, skip_features=offset, max_features=limit,
                               read_geometry=False, engine="pyogrio")
        else:
            raise JsonError(400, detail="Raster datasets have no rows")
        records = [{k: _json_value(v) for k, v in rec.items()} for rec in df.to_dict(orient="records")]
        return {"columns": list(df.columns), "rows": records, "offset": offset, "total": ds.feature_count}

    def clip(db: Session, dataset_id: int, selected_zones: Sequence[str] | None, polygon: dict | None):
        ds = _ready(db, dataset_id)
        geom = clip_geometry(selected_zones, polygon)
        if ds.kind == KIND_RASTER:
            return Dataset_service._clip_raster(ds, geom)
        if ds.kind == KIND_VECTOR:
            gdf = gpd.read_file(ds.file_path, layer=VECTOR_LAYER, bbox=tuple(geom.bounds),
                                max_features=MAX_CLIP_FEATURES + 1, engine="pyogrio")
            truncated = len(gdf) > MAX_CLIP_FEATURES
            gdf = gpd.clip(gdf.iloc[:MAX_CLIP_FEATURES], geom)
            return _feature_collection(gdf, truncated=truncated, count=int(len(gdf)), clip_area=mapping(geom))
        raise JsonError(400, detail="Table datasets have no geometry to clip")

    def _clip_raster(ds: Dataset, geom) -> tuple[bytes, dict]:
        path = ds.file_path
        with rasterio.open(path) as src:
            shapes = reproject_geometries([mapping(geom)], src.crs)
            minx, miny, maxx, maxy = shape(shapes[0]).bounds
            px = ((maxx - minx) / src.res[0]) * ((maxy - miny) / src.res[1])
            overviews = src.overviews(1)
        # pick the finest overview that keeps the clip a sensible size
        level = None
        if px > MAX_CLIP_PIXELS:
            for i, factor in enumerate(overviews):
                level = i
                if px / (factor * factor) <= MAX_CLIP_PIXELS:
                    break
        open_kwargs = {"overview_level": level} if level is not None else {}

        with rasterio.open(path, **open_kwargs) as src:
            nodata = src.nodata
            if nodata is None:
                dtype = np.dtype(src.dtypes[0])
                nodata = np.iinfo(dtype).max if np.issubdtype(dtype, np.integer) else -9999.0
            try:
                clipped, transform = mask(src, shapes, crop=True, filled=True, nodata=nodata)
            except ValueError:
                raise JsonError(400, detail="The clip area does not overlap this raster")
            profile = src.profile.copy()
            profile.update(driver="GTiff", height=clipped.shape[1], width=clipped.shape[2],
                           transform=transform, nodata=nodata, compress="deflate", tiled=False)
            profile.pop("blockxsize", None)
            profile.pop("blockysize", None)

        band = clipped[0].astype("float64")
        valid = band[(band != nodata) & np.isfinite(band)]
        stats = {
            "min": float(valid.min()) if valid.size else None,
            "max": float(valid.max()) if valid.size else None,
            "mean": float(valid.mean()) if valid.size else None,
            "pixels": int(valid.size),
            "overview_level": level,
        }
        with MemoryFile() as mem:
            with mem.open(**profile) as out:
                out.write(clipped)
            return mem.read(), stats
