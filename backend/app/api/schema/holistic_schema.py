import json
from pydantic import BaseModel, ConfigDict, Field, field_validator, AliasChoices
from typing import Any, Optional


class DistrictRequest(BaseModel):
    state_code: Any = Field(default=None, validation_alias=AliasChoices("state_code", "stateCode"))


class ZoneRequest(BaseModel):
    """Body shared by the zone analysis endpoints; selected_zones may also arrive as a JSON string."""
    model_config = ConfigDict(extra="allow")
    selected_zones: Any = []

    @field_validator("selected_zones", mode="before")
    @classmethod
    def parse_selected_zones(cls, value):
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
                if isinstance(parsed, list):
                    return parsed
            except json.JSONDecodeError:
                pass
            return [value]
        return value


class ZoneRasterRequest(ZoneRequest):
    operations: Any = []


class ZoneClipRequest(ZoneRequest):
    year: Any = 2024
    data_type: Any = "rainfall"


class DemSlopeClipRequest(ZoneRequest):
    data_type: Any = "slope"


class FlowDirectionClipRequest(ZoneRequest):
    data_type: Any = "direction"


class CriteriaRequest(ZoneRequest):
    criteria: Optional[list[str] | str] = None


class LayerClipRequest(ZoneRequest):
    layer_name: Any = ""


class RwqClipRequest(ZoneRequest):
    season: str = "monsoon"


class WeightedRasterRequest(ZoneRequest):
    stage_index: int = 0
    criteria_weights: dict[str, float] = {}
