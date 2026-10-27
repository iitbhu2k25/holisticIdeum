from fastapi import APIRouter, Body, Form, File, UploadFile, Response
from typing import Optional
from app.api.schema.holistic_schema import (
    DistrictRequest, ZoneRequest, ZoneRasterRequest, ZoneClipRequest, DemSlopeClipRequest,
    FlowDirectionClipRequest, CriteriaRequest, LayerClipRequest, RwqClipRequest, WeightedRasterRequest,
)
from app.api.service.holistic.location_service import Location_service
from app.api.service.holistic.session_service import Phase_raster_service, Session_service
from app.api.service.holistic.analysis_service import Analysis_service, Nirmal_service, Phase_analysis_service, TiffFile

router = APIRouter()


def tiff_response(tiff: TiffFile) -> Response:
    return Response(
        content=tiff.content,
        media_type="image/tiff",
        headers={"Content-Disposition": f'inline; filename="{tiff.filename}"', **tiff.headers},
    )


# ---------------- location ----------------
@router.get("/location/state")
def location_state():
    return Location_service.states()

@router.post("/location/district")
def location_district(payload: DistrictRequest):
    return Location_service.districts(payload.state_code)


# ---------------- zone statistics ----------------
@router.post("/analysis/zone-raster")
def analysis_zone_raster(payload: ZoneRasterRequest):
    return Analysis_service.zone_raster(payload.selected_zones, payload.operations)

@router.post("/analysis/rainfall")
def analysis_rainfall(payload: ZoneRequest):
    return Analysis_service.rainfall(payload.selected_zones)

@router.post("/analysis/groundwater")
def analysis_groundwater(payload: ZoneRequest):
    return Analysis_service.groundwater(payload.selected_zones)

@router.post("/analysis/channel-geometry")
def analysis_channel_geometry(payload: ZoneRequest):
    return Analysis_service.channel_geometry(payload.selected_zones)

@router.post("/analysis/tributary-drain")
def analysis_tributary_drain(payload: ZoneRequest):
    return Analysis_service.tributary_drain(payload.selected_zones)

@router.post("/analysis/river-flow")
def analysis_river_flow(payload: ZoneRequest):
    return Analysis_service.river_flow(payload.selected_zones)

@router.post("/analysis/dem-slope")
def analysis_dem_slope(payload: ZoneRequest):
    return Analysis_service.dem_slope(payload.selected_zones)

@router.post("/analysis/flow-direction")
def analysis_flow_direction(payload: ZoneRequest):
    return Analysis_service.flow_direction(payload.selected_zones)

@router.post("/analysis/arth-ganga")
def analysis_arth_ganga(payload: CriteriaRequest):
    return Analysis_service.arth_ganga(payload.selected_zones, payload.criteria)

@router.post("/analysis/gyan-ganga")
def analysis_gyan_ganga(payload: CriteriaRequest):
    return Analysis_service.gyan_ganga(payload.selected_zones, payload.criteria)

@router.post("/analysis/jeevant-ganga")
def analysis_jeevant_ganga(payload: CriteriaRequest):
    return Analysis_service.jeevant_ganga(payload.selected_zones, payload.criteria)

@router.post("/analysis/industrial-discharge")
def analysis_industrial_discharge(payload: ZoneRequest):
    return Analysis_service.industrial_discharge(payload.selected_zones)

@router.post("/analysis/gram-panchayat")
def analysis_gram_panchayat(payload: ZoneRequest):
    return Analysis_service.gram_panchayat(payload.selected_zones)

@router.post("/analysis/population")
def analysis_population(payload: ZoneRequest):
    return Analysis_service.population(payload.selected_zones)

@router.post("/analysis/nirmal-stp")
def analysis_nirmal_stp(payload: ZoneRequest):
    return Analysis_service.nirmal_stp(payload.selected_zones)

@router.post("/analysis/nirmal-gwq-stats")
def analysis_nirmal_gwq_stats(payload: ZoneRequest):
    return Nirmal_service.gwq_stats(payload.selected_zones)

@router.post("/analysis/nirmal-rwq-stats")
def analysis_nirmal_rwq_stats(payload: ZoneRequest):
    return Nirmal_service.rwq_stats(payload.selected_zones)


# ---------------- clipped GeoTIFFs ----------------
@router.post("/analysis/zone-raster-clip")
def analysis_zone_raster_clip(payload: ZoneClipRequest):
    return tiff_response(Analysis_service.zone_raster_clip(payload.selected_zones, payload.data_type, payload.year))

@router.post("/analysis/rainfall-clip")
def analysis_rainfall_clip(payload: ZoneClipRequest):
    return tiff_response(Analysis_service.zone_raster_clip(payload.selected_zones, "rainfall", payload.year))

@router.post("/analysis/groundwater-clip")
def analysis_groundwater_clip(payload: ZoneRequest):
    return tiff_response(Analysis_service.zone_raster_clip(payload.selected_zones, "groundwater"))

@router.post("/analysis/dem-slope-clip")
def analysis_dem_slope_clip(payload: DemSlopeClipRequest):
    data_type = str(payload.data_type).strip().lower()
    if data_type not in {"dem", "slope"}:
        data_type = "slope"
    return tiff_response(Analysis_service.zone_raster_clip(payload.selected_zones, data_type))

@router.post("/analysis/flow-direction-clip")
def analysis_flow_direction_clip(payload: FlowDirectionClipRequest):
    return tiff_response(Analysis_service.flow_direction_clip(payload.selected_zones, payload.data_type))

@router.post("/analysis/aviral-geoserver-clip")
def analysis_aviral_geoserver_clip(payload: LayerClipRequest):
    return tiff_response(Analysis_service.aviral_geoserver_clip(payload.selected_zones, payload.layer_name))

@router.post("/analysis/nirmal-gwq-clip")
def analysis_nirmal_gwq_clip(payload: ZoneRequest):
    return tiff_response(Nirmal_service.gwq_clip(payload.selected_zones))

@router.post("/analysis/nirmal-rwq-clip")
def analysis_nirmal_rwq_clip(payload: RwqClipRequest):
    return tiff_response(Nirmal_service.rwq_clip(payload.selected_zones, payload.season))


# ---------------- weighted phase rasters ----------------
@router.post("/analysis/aviral")
def analysis_aviral(payload: WeightedRasterRequest):
    return tiff_response(Phase_analysis_service.aviral(payload.selected_zones, payload.criteria_weights))

@router.post("/analysis/phase-raster")
def analysis_phase_raster(payload: WeightedRasterRequest):
    return tiff_response(Phase_analysis_service.phase_raster(payload.selected_zones, payload.criteria_weights, payload.stage_index))

@router.post("/analysis/save-phase-raster")
def save_phase_raster(
    tiff: UploadFile = File(...),
    stage_index: int = Form(0),
    stage_name: Optional[str] = Form(None),
    criteria: str = Form("[]"),
    weights: str = Form("{}"),
):
    """Save a generated phase raster to media/temp so the /split page can read it."""
    return Phase_raster_service.save(stage_index, stage_name, criteria, weights, tiff.file.read())

@router.get("/analysis/phase-raster-meta/{stage_index}")
def phase_raster_meta(stage_index: int):
    return Phase_raster_service.meta(stage_index)

@router.get("/analysis/phase-raster-tiff/{stage_index}")
def phase_raster_tiff(stage_index: int):
    return Response(
        content=Phase_raster_service.tiff(stage_index),
        media_type="image/tiff",
        headers={
            "Content-Disposition": f'inline; filename="phase_raster_{stage_index}.tif"',
            "Cache-Control": "no-store",
        },
    )


# ---------------- split sessions ----------------
@router.post("/sessions/save")
def session_save(data: dict = Body(...)):
    return Session_service.save(data)

@router.get("/sessions/list")
def session_list():
    return Session_service.list()

@router.delete("/sessions/delete/{session_id}")
def session_delete(session_id: str):
    return Session_service.delete(session_id)
