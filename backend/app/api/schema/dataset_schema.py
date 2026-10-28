from typing import Any, Optional
from pydantic import BaseModel

from app.api.schema.holistic_schema import ZoneRequest


class DatasetClipRequest(ZoneRequest):
    """selected_zones, a drawn polygon (GeoJSON geometry / Feature / FeatureCollection), or both."""
    polygon: Optional[dict[str, Any]] = None


class DatasetPatch(BaseModel):
    title: Optional[str] = None
    category: Optional[str] = None
    criterion: Optional[str] = None
