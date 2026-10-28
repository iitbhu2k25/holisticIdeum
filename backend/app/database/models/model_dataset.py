from app.database.models.base import Base
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import String, Integer, BigInteger, Text, ForeignKey, JSON
from typing import Optional

# Fixed Ganga categories; the keys are what the API and the media folders use.
CATEGORIES = {
    "aviral": "Aviral Ganga",
    "nirmal": "Nirmal Ganga",
    "jan": "Jan Ganga",
    "arth": "Arth Ganga",
    "gyan": "Gyan Ganga",
    "jeevant": "Jeevant Ganga",
}

KIND_RASTER = "raster"
KIND_VECTOR = "vector"
KIND_TABLE = "table"

STATUS_PROCESSING = "processing"
STATUS_READY = "ready"
STATUS_FAILED = "failed"


class Dataset(Base):
    """A file a superuser uploaded, after it has been normalised for serving.

    raster -> Cloud-Optimised GeoTIFF (tiled + overviews) published to GeoServer
    vector -> GeoPackage in EPSG:4326 with a spatial index (shapefile / geojson / gpkg / kml / csv)
    table  -> CSV without coordinates that could not be joined to zones
    """
    __tablename__ = "datasets"
    uploaded_by: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    category: Mapped[str] = mapped_column(String(20), index=True, nullable=False)
    criterion: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    source_format: Mapped[str] = mapped_column(String(20), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    file_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    source_path: Mapped[str] = mapped_column(String(500), nullable=False)
    file_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(String(20), index=True, nullable=False, default=STATUS_PROCESSING)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    geoserver_layer: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    bbox: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    feature_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    info: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    uploader = relationship("User")
