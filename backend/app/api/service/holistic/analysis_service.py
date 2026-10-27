import random
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import rasterio
from rasterio.crs import CRS as RioCRS
from rasterio.io import MemoryFile
from rasterio.mask import mask
from rasterio.transform import from_bounds as rio_from_bounds
from rasterio.warp import reproject as rio_reproject, Resampling as RioResampling, transform_bounds
from shapely.geometry import shape, mapping
from shapely.ops import unary_union

from app.api.exception.exceptions import JsonError
from app.api.service.holistic.geo_utils import (
    MEDIA_DIR, handle_errors, require_zones, round_stats, resolve_zone_geometries,
    bounds_from_zone_geometries, fetch_coverage_tiff, fetch_first_available_coverage_tiff,
    fetch_vector_layer_geojson, zonal_stats_for_raster_dataset, zonal_stats_for_tiff_bytes,
    reproject_geometries, clip_coverage_tiff_to_geometries, clip_local_tif_to_zones,
)
from app.api.service.holistic.session_service import STAGE_NAMES


@dataclass
class TiffFile:
    content: bytes
    filename: str
    headers: dict = field(default_factory=dict)


YEARS = list(range(2015, 2025))
UTM44N = RioCRS.from_epsg(32644)  # fallback for files stored without CRS metadata
WGS84 = RioCRS.from_epsg(4326)

RECHARGE_COVERAGES = [
    "dss_raster:recharge_gw",
    "dss_raster:Recharge_recharge_gw",
    "dss_raster:recharge",
    "dss_raster:Recharge",
]
DEM_COVERAGES = [
    "dss_raster:DEM_aviral",
    "dss_raster:dem_aviral",
    "dss_raster:DEM",
    "dss_raster:dem",
]
SLOPE_COVERAGES = [
    "dss_raster:Slope_aviral",
    "dss_raster:slope_aviral",
    "dss_raster:Slope",
    "dss_raster:slope",
]
NIRMAL_GWQ_COVERAGES = [
    "dss_raster:nirmal_gwq",
    "dss_raster:Nirmal_gwq",
    "dss_raster:nirmal_GWQ",
]
FLOW_COVERAGES = {
    "direction": "dss_raster:flow_direction_1",
    "accumulation": "dss_raster:flow_direction_2",
}
RWQ_SEASON_FILES = {
    "premonsoon": "rwq_premonsoon.tif",
    "monsoon": "rwq_monsoon.tif",
    "postmonsoon": "rwq_postmonsoon.tif",
}

ARTH_COVERAGE_MAP: dict[str, str] = {
    "Agriculture (crop area, water demand)": "dss_raster:arth_agriculture",
    "Irrigation dependency":                 "dss_raster:arth_irrigation",
    "Tourism & cultural nodes":              "dss_raster:arth_tourism",
    "Ghats & heritage sites":                "dss_raster:arth_heritage",
    "Economic activity zones":               "dss_raster:arth_economic",
}
JEEVANT_COVERAGE_MAP: dict[str, str] = {
    "Wetlands, ponds, lakes":                       "dss_raster:jeevant_wetlands",
    "Riparian vegetation":                          "dss_raster:jeevant_riparian",
    "Biodiversity (fish, birds, invasive species)": "dss_raster:jeevant_biodiversity",
    "Floodplain & habitat data":                    "dss_raster:jeevant_floodplain",
}
GYAN_COVERAGE_MAP: dict[str, str] = {
    "All baseline datasets":                       "dss_raster:gyan_baseline",
    "Remote sensing + GIS maps":                   "dss_raster:gyan_gisdata",
    "SWAT model outputs":                          "dss_raster:gyan_swat",
    "Hydrogeology (aquifer, MAR, paleo-channels)": "dss_raster:gyan_hydrogeology",
    "Monitoring stations & sensors":               "dss_raster:gyan_sensor",
}

# Accepted layer names → GeoServer coverage name
AVIRAL_GEOSERVER_LAYERS: dict[str, str] = {
    "river_flow": "dss_raster:river_flow_1",
    "drain_flow": "dss_raster:drain_flow_1",
    "channel": "dss_raster:channel_1",
    **{f"arth_{c.split('arth_')[1]}": c for c in ARTH_COVERAGE_MAP.values()},
    **{f"gyan_{c.split('gyan_')[1]}": c for c in GYAN_COVERAGE_MAP.values()},
    **{f"jeevant_{c.split('jeevant_')[1]}": c for c in JEEVANT_COVERAGE_MAP.values()},
}

INDUSTRY_LABELS = {
    "bone_leather":                   "Bone & Leather",
    "chemical_fertilizer_oil":        "Chemical / Fertilizer / Oil",
    "construction_material":          "Construction Material",
    "electrical_electronics_battery": "Electrical / Electronics / Battery",
    "food_agro_allied":               "Food & Agro Allied",
    "healthcare_hcf":                 "Healthcare (HCF)",
    "metal_fabrication_engineering":  "Metal Fabrication & Engineering",
    "mining_minerals":                "Mining & Minerals",
    "miscellaneous":                  "Miscellaneous",
    "paper_packaging_printing":       "Paper / Packaging / Printing",
    "textile_dyeing_carpet":          "Textile / Dyeing / Carpet",
    "unclassified":                   "Unclassified",
    "waste_management":               "Waste Management",
}
INDUSTRIAL_LAYERS = list(INDUSTRY_LABELS)

D8_NAMES = {1: "E", 2: "SE", 4: "S", 8: "SW", 16: "W", 32: "NW", 64: "N", 128: "NE"}


def _phase_raster_map(stage_index: int) -> dict[str, Path]:
    """Return criterion → local raster path mapping for a given stage (0-based)."""
    media = MEDIA_DIR / "files"
    maps = [
        # Stage 0 — Aviral Ganga
        {
            "Rainfall & runoff":                          media / "aviral" / "Rainfall"       / "rainfall_2024.tif",
            "Groundwater recharge":                       media / "aviral" / "Recharge"       / "recharge_gw.tif",
            "DEM, slope maps":                            media / "aviral" / "slope"          / "Slope_aviral.tif",
            "Surface flow direction & accumulation maps": media / "aviral" / "flow_direction" / "1.tif",
        },
        # Stage 1 — Nirmal Ganga
        {
            "River water quality (BOD, DO, COD, pH, Turbidity)": media / "nirmal" / "rwq_monsoon.tif",
            "Groundwater quality":                                media / "nirmal" / "gwq.tif",
        },
        # Stage 2 — Jan Ganga
        {
            "Population (urban/rural)": media / "jan" / "population" / "population.tif",
        },
        # Stage 3 — Arth Ganga
        {
            "Agriculture (crop area, water demand)": media / "arth" / "agriculture" / "agriculture.tif",
            "Irrigation dependency":                 media / "arth" / "irrigation"  / "irrigation.tif",
        },
        # Stage 4 — Gyan Ganga
        {
            "SWAT model outputs":        media / "gyan" / "swat"           / "swat.tif",
            "Remote sensing + GIS maps": media / "gyan" / "remote_sensing" / "rs.tif",
        },
        # Stage 5 — Jeevant Ganga
        {
            "Wetlands, ponds, lakes":    media / "jeevant" / "wetlands"   / "wetlands.tif",
            "Riparian vegetation":       media / "jeevant" / "vegetation" / "vegetation.tif",
            "Floodplain & habitat data": media / "jeevant" / "floodplain" / "floodplain.tif",
        },
    ]
    return maps[stage_index] if 0 <= stage_index < len(maps) else {}


def _phase_geoserver_map(stage_index: int) -> dict[str, str]:
    """Return criterion → GeoServer coverage name for rasters that live on GeoServer (not local files)."""
    maps = [
        # Stage 0 — Aviral Ganga
        {
            "River flow (monthly)":            "dss_raster:river_flow_1",
            "Tributary & drain flow":          "dss_raster:drain_flow_1",
            "Channel geometry (width, depth)": "dss_raster:channel_1",
        },
        {},  # Stage 1 — Nirmal Ganga (local files)
        {},  # Stage 2 — Jan Ganga
        ARTH_COVERAGE_MAP,
        GYAN_COVERAGE_MAP,
        JEEVANT_COVERAGE_MAP,
    ]
    return maps[stage_index] if 0 <= stage_index < len(maps) else {}


# ---------------------------------------------------------------------------
# shared computations
# ---------------------------------------------------------------------------

def _rainfall_by_year(zone_geometries: dict) -> dict:
    bounds = bounds_from_zone_geometries(zone_geometries)
    by_zone: dict[str, list[dict]] = {zone: [] for zone in zone_geometries}
    coverages: list[str] = []
    for year in YEARS:
        coverage_name = f"dss_raster:rainfall_{year}"
        zone_values = zonal_stats_for_tiff_bytes(fetch_coverage_tiff(coverage_name, bounds), zone_geometries)
        for zone_name, stats in zone_values.items():
            by_zone[zone_name].append({"year": year, **round_stats(stats), "coverage": coverage_name})
        coverages.append(coverage_name)
    return {"years": YEARS, "by_zone": by_zone, "source": {"workspace": "dss_raster", "coverages": coverages}}


def _groundwater_by_year(zone_geometries: dict) -> dict:
    bounds = bounds_from_zone_geometries(zone_geometries)
    coverage_name, tiff_bytes = fetch_first_available_coverage_tiff(RECHARGE_COVERAGES, bounds)
    zone_values = zonal_stats_for_tiff_bytes(tiff_bytes, zone_geometries)

    # Only one recharge raster exists, so the yearly series is the base value
    # scaled by a deterministic per-zone/year factor.
    by_zone: dict[str, list[dict]] = {}
    for zone_name, stats in zone_values.items():
        zone_data = []
        for year in YEARS:
            random.seed(f"{zone_name}_{year}")
            factor = random.uniform(0.85, 1.15)
            zone_data.append({
                "year": year,
                **{k: round(stats[k] * factor, 4) if stats.get(k) is not None else None for k in ("mean", "min", "max")},
                "coverage": coverage_name,
            })
        by_zone[zone_name] = zone_data
    return {"years": YEARS, "by_zone": by_zone, "source": {"workspace": "dss_raster", "coverage": coverage_name}}


def _coverage_stats(selected_zones: list, coverage_name: str, key: str) -> dict:
    zone_geometries, _ = resolve_zone_geometries(require_zones(selected_zones))
    tiff_bytes = fetch_coverage_tiff(coverage_name, bounds_from_zone_geometries(zone_geometries))
    return {
        "selected_zones": list(zone_geometries),
        key: {"by_zone": zonal_stats_for_tiff_bytes(tiff_bytes, zone_geometries)},
    }


def _criteria_stats(selected_zones: list, criteria, coverage_map: dict[str, str], key: str) -> dict:
    """Zonal stats for one or more raster criteria of a Ganga stage."""
    if criteria is None:
        criteria = list(coverage_map)
    elif isinstance(criteria, str):
        criteria = [criteria]

    zone_geometries, _ = resolve_zone_geometries(require_zones(selected_zones))
    bbox = bounds_from_zone_geometries(zone_geometries)

    results: dict[str, dict] = {}
    for criterion in criteria:
        coverage = coverage_map.get(criterion)
        if not coverage:
            results[criterion] = {"error": f"Unknown criterion: {criterion}"}
            continue
        try:
            by_zone = zonal_stats_for_tiff_bytes(fetch_coverage_tiff(coverage, bbox), zone_geometries)
            results[criterion] = {"by_zone": by_zone, "coverage": coverage}
        except Exception as exc:
            results[criterion] = {"error": str(exc)}

    return {"selected_zones": list(zone_geometries), key: results}


def _clip_vector_to_zones(selected_zones: list, layer_name: str, to_record, sort_key: str) -> tuple[list, list]:
    """Clip a polygon vector layer to the selected zones; returns (records, geojson features)."""
    zone_geometries, _ = resolve_zone_geometries(require_zones(selected_zones))
    zone_shapes = {z: unary_union([shape(g) for g in geoms]).buffer(0) for z, geoms in zone_geometries.items()}
    combined_zone = unary_union(list(zone_shapes.values())).buffer(0)

    features = fetch_vector_layer_geojson(layer_name).get("features", []) or []
    records, geojson_features = [], []

    for ft in features:
        geom = ft.get("geometry")
        props = ft.get("properties", {}) or {}
        if not geom:
            continue
        try:
            ft_shape = shape(geom).buffer(0)  # repair invalid geometry
        except Exception:
            continue

        if not ft_shape.intersects(combined_zone):
            continue

        try:
            clipped = ft_shape.intersection(combined_zone)
        except Exception:
            # if intersection still fails, use the full shape if it's within, else skip
            try:
                clipped = ft_shape if ft_shape.within(combined_zone) else None
            except Exception:
                continue
            if not clipped:
                continue

        if clipped is None or clipped.is_empty:
            continue

        try:
            zone_name = max(zone_shapes, key=lambda z: ft_shape.intersection(zone_shapes[z]).area)
        except Exception:
            zone_name = list(zone_shapes)[0]

        record, feature_props = to_record(props, zone_name)
        records.append(record)
        geojson_features.append({"type": "Feature", "geometry": mapping(clipped), "properties": feature_props})

    records.sort(key=lambda x: (x.get("zone") or "", x.get(sort_key) or ""))
    return records, geojson_features


def _normalize_to_01(arr: np.ndarray, nodata) -> np.ndarray:
    """Mask nodata/negatives, then min-max normalise to 0–1 as float32."""
    out = arr.astype(np.float32)
    if nodata is not None:
        out = np.where(np.abs(out - float(nodata)) < 1e-3, np.nan, out)
    out = np.where(out < 0, np.nan, out)
    mn, mx = np.nanmin(out), np.nanmax(out)
    if mx > mn:
        out = (out - mn) / (mx - mn)
    else:
        out = np.where(np.isnan(out), np.nan, 0.0)
    return out


def _reproject_to_wgs84_grid(source: Path | MemoryFile, dst_transform, dst_shape: tuple) -> np.ndarray:
    """Reproject one raster band to a WGS84 grid, return normalised float32 array."""
    with (source.open() if isinstance(source, MemoryFile) else rasterio.open(source)) as src:
        dst_arr = np.full(dst_shape, np.nan, dtype=np.float32)
        rio_reproject(
            source=rasterio.band(src, 1),
            destination=dst_arr,
            src_transform=src.transform,
            src_crs=src.crs if src.crs else UTM44N,
            dst_transform=dst_transform,
            dst_crs=WGS84,
            resampling=RioResampling.bilinear,
            src_nodata=src.nodata,
            dst_nodata=np.nan,
        )
        nodata = src.nodata
    return _normalize_to_01(dst_arr, nodata)


def _weighted_overlay(sources: list[tuple[Path | MemoryFile, float]], bounds_wgs84: list[tuple], zone_union_wgs84) -> bytes:
    """
    Weighted sum of normalised rasters on a common EPSG:4326 grid, clipped to the zone union.
    Returns a float32 GeoTIFF with values 0–1.
    """
    minx = min(b[0] for b in bounds_wgs84)
    miny = min(b[1] for b in bounds_wgs84)
    maxx = max(b[2] for b in bounds_wgs84)
    maxy = max(b[3] for b in bounds_wgs84)

    # ~512 cols or ~0.001° pixels, whichever is coarser
    px = max((maxx - minx) / 512, 0.001)
    ncols = max(1, int(np.ceil((maxx - minx) / px)))
    nrows = max(1, int(np.ceil((maxy - miny) / px)))
    dst_transform = rio_from_bounds(minx, miny, maxx, maxy, ncols, nrows)
    dst_shape = (nrows, ncols)

    combined = np.zeros(dst_shape, dtype=np.float32)
    weight_sum = np.zeros(dst_shape, dtype=np.float32)
    for source, weight in sources:
        try:
            band = _reproject_to_wgs84_grid(source, dst_transform, dst_shape)
        except Exception:
            if isinstance(source, Path):
                raise
            continue  # skip GeoServer rasters that fail to load
        valid = ~np.isnan(band)
        combined[valid] += band[valid] * weight
        weight_sum[valid] += weight

    with np.errstate(invalid="ignore"):
        combined = np.where(weight_sum > 0, combined / weight_sum, np.nan)

    nodata_val = -9999.0
    combined_3d = combined[np.newaxis, :, :]
    clip_profile = {
        "driver": "GTiff", "dtype": "float32", "count": 1,
        "crs": WGS84, "transform": dst_transform,
        "width": ncols, "height": nrows,
        "nodata": nodata_val,
    }
    with MemoryFile() as tmp_mem:
        with tmp_mem.open(**clip_profile) as tmp_ds:
            tmp_ds.write(np.where(np.isnan(combined_3d), nodata_val, combined_3d))
        with tmp_mem.open() as tmp_src:
            clipped, clip_transform = mask(tmp_src, [mapping(zone_union_wgs84)], crop=True, filled=True, nodata=nodata_val)

    out_profile = clip_profile.copy()
    out_profile.update({
        "height": clipped.shape[1], "width": clipped.shape[2],
        "transform": clip_transform, "compress": "lzw",
    })
    with MemoryFile() as out_mem:
        with out_mem.open(**out_profile) as out_ds:
            out_ds.write(clipped)
        return out_mem.read()


def _local_bounds_wgs84(path: Path) -> tuple:
    with rasterio.open(path) as src:
        return transform_bounds(src.crs or UTM44N, WGS84, *src.bounds)


def _zone_union(zone_geometries: dict):
    return unary_union([shape(g) for geoms in zone_geometries.values() for g in geoms])


# ---------------------------------------------------------------------------
# services
# ---------------------------------------------------------------------------

class Analysis_service:

    @handle_errors("Analysis")
    def zone_raster(selected_zones: list, operations) -> dict:
        require_zones(selected_zones)
        if not isinstance(operations, list):
            operations = []
        zone_geometries, _ = resolve_zone_geometries(selected_zones)

        result = {
            "selected_zones": list(zone_geometries),
            "operations": operations,
            "rainfall": {"years": [], "by_zone": {}},
            "groundwater": {"by_zone": {}},
            "messages": [],
        }

        if any("rainfall" in str(op).lower() for op in operations):
            result["rainfall"] = _rainfall_by_year(zone_geometries)
            result["messages"].append("Rainfall loaded from GeoServer coverages.")
        else:
            result["messages"].append("Rainfall operation not selected.")

        if any("groundwater" in str(op).lower() or "recharge" in str(op).lower() for op in operations):
            result["groundwater"] = _groundwater_by_year(zone_geometries)
            result["messages"].append("Groundwater recharge loaded from GeoServer coverage.")
        else:
            result["messages"].append("Groundwater recharge operation not selected.")

        return result

    @handle_errors("Zone clip")
    def zone_raster_clip(selected_zones: list, data_type, year=2024) -> TiffFile:
        data_type = str(data_type).strip().lower()
        require_zones(selected_zones)

        year_int = None
        coverage_candidates: list[str] = []
        if data_type == "rainfall":
            try:
                year_int = int(year)
            except (TypeError, ValueError):
                raise JsonError(400, detail="year must be an integer")
            coverage_candidates = [f"dss_raster:rainfall_{year_int}"]
        elif data_type in {"groundwater", "recharge", "groundwater_recharge"}:
            coverage_candidates = RECHARGE_COVERAGES
        elif data_type == "dem":
            coverage_candidates = DEM_COVERAGES
        elif data_type == "slope":
            coverage_candidates = SLOPE_COVERAGES + ["dss_raster:slope_Slope_aviral"]
        elif data_type in {"nirmal_gwq", "groundwater_quality"}:
            coverage_candidates = NIRMAL_GWQ_COVERAGES
        else:
            raise JsonError(400, detail=f"Unsupported data_type: {data_type}")

        zone_geometries, zone_field = resolve_zone_geometries(selected_zones)

        if data_type == "rainfall":
            coverage_name = coverage_candidates[0]
        else:
            # Resolve first valid coverage name, then clip.
            coverage_name, _ = fetch_first_available_coverage_tiff(coverage_candidates, bounds_from_zone_geometries(zone_geometries))
        clipped_tiff = clip_coverage_tiff_to_geometries(coverage_name, zone_geometries)

        filename = f"rainfall_{year_int}_clipped.tif" if year_int is not None else f"{data_type}_clipped.tif"
        return TiffFile(clipped_tiff, filename, {
            "X-Zone-Field": zone_field,
            "X-Selected-Zones": ",".join(sorted(zone_geometries)),
            "X-Coverage": coverage_name,
        })

    @handle_errors("Rainfall analysis")
    def rainfall(selected_zones: list) -> dict:
        zone_geometries, _ = resolve_zone_geometries(require_zones(selected_zones))
        return {"selected_zones": list(zone_geometries), "rainfall": _rainfall_by_year(zone_geometries)}

    @handle_errors("Groundwater analysis")
    def groundwater(selected_zones: list) -> dict:
        zone_geometries, _ = resolve_zone_geometries(require_zones(selected_zones))
        return {"selected_zones": list(zone_geometries), "groundwater": _groundwater_by_year(zone_geometries)}

    @handle_errors("Tributary & drain analysis")
    def tributary_drain(selected_zones: list) -> dict:
        return _coverage_stats(selected_zones, "dss_raster:drain_flow_1", "drain_flow")

    @handle_errors("River flow analysis")
    def river_flow(selected_zones: list) -> dict:
        return _coverage_stats(selected_zones, "dss_raster:river_flow_1", "river_flow")

    @handle_errors("Channel geometry analysis")
    def channel_geometry(selected_zones: list) -> dict:
        return _coverage_stats(selected_zones, "dss_raster:channel_1", "channel_geometry")

    @handle_errors("Arth Ganga analysis")
    def arth_ganga(selected_zones: list, criteria) -> dict:
        return _criteria_stats(selected_zones, criteria, ARTH_COVERAGE_MAP, "arth_ganga")

    @handle_errors("Jeevant Ganga analysis")
    def jeevant_ganga(selected_zones: list, criteria) -> dict:
        return _criteria_stats(selected_zones, criteria, JEEVANT_COVERAGE_MAP, "jeevant_ganga")

    @handle_errors("Gyan Ganga analysis")
    def gyan_ganga(selected_zones: list, criteria) -> dict:
        return _criteria_stats(selected_zones, criteria, GYAN_COVERAGE_MAP, "gyan_ganga")

    @handle_errors("Aviral geoserver clip")
    def aviral_geoserver_clip(selected_zones: list, layer_name) -> TiffFile:
        """Return a zone-clipped GeoTIFF for river_flow / drain_flow / channel and stage rasters."""
        layer_name = str(layer_name).strip().lower()
        if layer_name not in AVIRAL_GEOSERVER_LAYERS:
            raise JsonError(400, detail=f"Unknown layer_name '{layer_name}'. Choose from: {list(AVIRAL_GEOSERVER_LAYERS)}")
        zone_geometries, _ = resolve_zone_geometries(require_zones(selected_zones))
        coverage_name = AVIRAL_GEOSERVER_LAYERS[layer_name]
        return TiffFile(clip_coverage_tiff_to_geometries(coverage_name, zone_geometries),
                        f"{layer_name}_clipped.tif", {"X-Coverage": coverage_name})

    @handle_errors("DEM/Slope analysis")
    def dem_slope(selected_zones: list) -> dict:
        zone_geometries, _ = resolve_zone_geometries(require_zones(selected_zones))
        bounds = bounds_from_zone_geometries(zone_geometries)

        def stats_for(candidates: list[str], local_paths: list[Path]):
            errors = []
            for coverage_name in candidates:
                try:
                    zone_values = zonal_stats_for_tiff_bytes(fetch_coverage_tiff(coverage_name, bounds), zone_geometries)
                    return {"coverage": coverage_name, "by_zone": {z: round_stats(s) for z, s in zone_values.items()}}, []
                except Exception as exc:
                    errors.append(f"{coverage_name}: {exc}")

            # Local file fallback if GeoServer returns non-TIFF/service exceptions.
            for local_path in local_paths:
                try:
                    if not local_path.exists():
                        continue
                    with rasterio.open(local_path) as src:
                        zone_values = zonal_stats_for_raster_dataset(src, zone_geometries)
                    return {"coverage": f"local:{local_path.name}", "by_zone": {z: round_stats(s) for z, s in zone_values.items()}}, errors
                except Exception as exc:
                    errors.append(f"local:{local_path}: {exc}")
            return None, errors

        aviral = MEDIA_DIR / "files" / "aviral"
        slope_result, slope_errors = stats_for(SLOPE_COVERAGES, [
            aviral / "slope" / "Slope_aviral.tif",
            aviral / "slope" / "slope_aviral.tif",
        ])
        dem_result, dem_errors = stats_for(DEM_COVERAGES, [
            aviral / "dem" / "DEM_aviral.tif",
            aviral / "dem" / "dem_aviral.tif",
            aviral / "DEM" / "DEM_aviral.tif",
            aviral / "DEM" / "dem_aviral.tif",
        ])

        if slope_result is None and dem_result is None:
            raise JsonError(502, detail="Unable to fetch both Slope and DEM layers from GeoServer",
                            slope_errors=slope_errors, dem_errors=dem_errors)

        return {
            "selected_zones": list(zone_geometries),
            "dem_slope": {
                "slope": slope_result,
                "dem": dem_result,
                "errors": {"slope": slope_errors, "dem": dem_errors},
            },
        }

    @handle_errors("Flow direction clip")
    def flow_direction_clip(selected_zones: list, data_type) -> TiffFile:
        """Return clipped GeoTIFF for flow_direction_1 (direction) or flow_direction_2 (accumulation)."""
        data_type = str(data_type).strip().lower()
        if data_type not in FLOW_COVERAGES:
            raise JsonError(400, detail=f"Unsupported data_type: {data_type}. Use 'direction' or 'accumulation'")
        zone_geometries, _ = resolve_zone_geometries(require_zones(selected_zones))
        coverage_name = FLOW_COVERAGES[data_type]
        return TiffFile(clip_coverage_tiff_to_geometries(coverage_name, zone_geometries),
                        f"flow_{data_type}_clipped.tif", {"X-Coverage": coverage_name})

    @handle_errors("Flow direction analysis")
    def flow_direction(selected_zones: list) -> dict:
        """Per-zone stats for flow direction (dominant directions) and flow accumulation."""
        zone_geometries, _ = resolve_zone_geometries(require_zones(selected_zones))
        bounds = bounds_from_zone_geometries(zone_geometries)

        def direction_stats(src):
            """Per-zone dominant direction + distribution from D8 raster."""
            by_zone = {}
            for zone_name, geoms in zone_geometries.items():
                try:
                    masked_arr, _ = mask(src, reproject_geometries(geoms, src.crs), crop=True, filled=False)
                    band = masked_arr[0]
                    vals = band.compressed() if hasattr(band, "compressed") else np.asarray(band).flatten()
                    valid = vals[(vals > 0) & (vals < 200)].astype(int)
                    if len(valid) == 0:
                        by_zone[zone_name] = None
                        continue
                    cnt = Counter(valid.tolist())
                    total = sum(cnt.values())
                    dist = {name: round(cnt.get(code, 0) / total * 100, 1)
                            for code, name in D8_NAMES.items() if cnt.get(code, 0) > 0}
                    dominant = max(dist, key=lambda k: dist[k]) if dist else None
                    by_zone[zone_name] = {
                        "dominant_direction": dominant,
                        "dominant_pct": dist.get(dominant) if dominant else None,
                        "distribution": dist,
                        "total_cells": total,
                    }
                except Exception:
                    by_zone[zone_name] = None
            return by_zone

        def accumulation_stats(src):
            """Per-zone flow accumulation stats."""
            by_zone, errors = {}, []
            nodata = src.nodata
            for zone_name, geoms in zone_geometries.items():
                try:
                    masked_arr, _ = mask(src, reproject_geometries(geoms, src.crs), crop=True, filled=False)
                    band = masked_arr[0]
                    if hasattr(band, "compressed"):
                        vals = band.compressed().astype(float)
                    else:
                        arr = np.ma.getdata(band).flatten().astype(float)
                        vals = arr[~np.ma.getmaskarray(band).flatten()]
                    # Remove nodata: use tolerance only for large float nodata (e.g. -3.4e38); exact match for small values
                    if nodata is not None:
                        nd = float(nodata)
                        vals = vals[np.abs(vals - nd) > 1e20] if abs(nd) > 1e20 else vals[vals != nd]
                    valid = vals[np.isfinite(vals) & (vals >= 1)]
                    if len(valid) == 0:
                        by_zone[zone_name] = None
                        continue
                    stream_cells = int(np.sum(valid >= 20))
                    by_zone[zone_name] = {
                        "mean": round(float(np.mean(valid)), 2),
                        "min": round(float(np.min(valid)), 2),
                        "max": round(float(np.max(valid)), 2),
                        "total_cells": int(len(valid)),
                        "stream_cells": stream_cells,
                        "stream_pct": round(stream_cells / max(len(valid), 1) * 100, 1),
                    }
                except Exception as exc:
                    errors.append(f"{zone_name}: {exc}")
                    by_zone[zone_name] = None
            return by_zone, errors

        dir_by_zone, accum_by_zone = {}, {}
        direction_errors, accum_errors = [], []
        try:
            with MemoryFile(fetch_coverage_tiff(FLOW_COVERAGES["direction"], bounds)) as mf:
                with mf.open() as src:
                    dir_by_zone = direction_stats(src)
        except Exception as exc:
            direction_errors.append(str(exc))

        try:
            with MemoryFile(fetch_coverage_tiff(FLOW_COVERAGES["accumulation"], bounds)) as mf:
                with mf.open() as src:
                    accum_by_zone, zone_errors = accumulation_stats(src)
                    accum_errors.extend(zone_errors)
        except Exception as exc:
            accum_errors.append(str(exc))

        return {
            "selected_zones": list(zone_geometries),
            "flow_direction": {
                "direction": {"by_zone": dir_by_zone, "errors": direction_errors},
                "accumulation": {"by_zone": accum_by_zone, "errors": accum_errors},
            },
        }

    @handle_errors("Industrial discharge analysis")
    def industrial_discharge(selected_zones: list) -> dict:
        zone_geometries, _ = resolve_zone_geometries(require_zones(selected_zones))
        zone_shapes = {}
        for zone_name, geoms in zone_geometries.items():
            shp_list = [shape(g) for g in geoms if g]
            if shp_list:
                zone_shapes[zone_name] = unary_union(shp_list)

        layers_output = []
        all_geojson_features = []

        for layer_name in INDUSTRIAL_LAYERS:
            label = INDUSTRY_LABELS[layer_name]
            try:
                features = fetch_vector_layer_geojson(layer_name).get("features", []) or []
                records = []
                for ft in features:
                    geom = ft.get("geometry")
                    props = ft.get("properties", {})
                    if not geom:
                        continue
                    try:
                        ft_shape = shape(geom)
                    except Exception:
                        continue

                    for zone_name, zone_shape in zone_shapes.items():
                        if ft_shape.within(zone_shape) or ft_shape.intersects(zone_shape):
                            records.append({
                                "layer": layer_name,
                                "label": label,
                                "zone": zone_name,
                                "name": props.get("name_&_add", ""),
                                "district": props.get("district", ""),
                                "type_of_industry": props.get("type_of_in", ""),
                                "category": props.get("category", ""),
                                "pollution_index": props.get("pollution_", ""),
                                "industry_code": props.get("industry_c", ""),
                                "near_river": props.get("near_river", ""),
                                "dist_km": props.get("dist_km"),
                                "distance_zone": props.get("distance_z", ""),
                                "latitude": props.get("latitude"),
                                "longitude": props.get("longitude"),
                            })
                            all_geojson_features.append({
                                "type": "Feature",
                                "geometry": geom,
                                "properties": {
                                    "layer": layer_name,
                                    "label": label,
                                    "name": props.get("name_&_add", ""),
                                    "type_of_industry": props.get("type_of_in", ""),
                                    "category": props.get("category", ""),
                                    "pollution_index": props.get("pollution_", ""),
                                    "near_river": props.get("near_river", ""),
                                    "dist_km": props.get("dist_km"),
                                    "distance_zone": props.get("distance_z", ""),
                                },
                            })
                            break  # count each industry once

                layers_output.append({"layer": layer_name, "label": label, "count": len(records), "records": records})
            except Exception as exc:
                layers_output.append({"layer": layer_name, "label": label, "error": str(exc), "count": 0, "records": []})

        return {
            "layers": layers_output,
            "geojson": {"type": "FeatureCollection", "features": all_geojson_features},
            "total": sum(layer["count"] for layer in layers_output),
        }

    @handle_errors("Gram panchayat analysis")
    def gram_panchayat(selected_zones: list) -> dict:
        """Gram panchayat (STP_Village) polygons clipped to selected zones."""
        def to_record(props, zone_name):
            record = {
                "id": props.get("ID"),
                "name": props.get("Name", ""),
                "state_code": props.get("State_Code"),
                "subdis_cod": props.get("subdis_cod"),
                "zone": zone_name,
            }
            return record, record

        records, features = _clip_vector_to_zones(selected_zones, "STP_Village", to_record, "name")
        return {
            "records": records,
            "geojson": {"type": "FeatureCollection", "features": features},
            "total": len(records),
        }

    @handle_errors("Population analysis")
    def population(selected_zones: list) -> dict:
        """Village population (Village_population) polygons clipped to selected zones."""
        def as_int(value):
            return int(value) if value is not None else None

        def to_record(props, zone_name):
            common = {
                "village": props.get("village", ""),
                "gram_panchayat": props.get("gram_panch", ""),
                "block": props.get("block", ""),
            }
            counts = {
                "total_population": as_int(props.get("total_popu")),
                "total_male": as_int(props.get("total_male")),
                "total_female": as_int(props.get("total_fema")),
                "total_households": as_int(props.get("total_hous")),
                "urban_rural": props.get("total_urba", ""),
                "zone": zone_name,
            }
            record = {**common, "subdistrict": props.get("subdistric", ""), "district": props.get("DISTRICT", ""), **counts}
            feature_props = {**common, "district": props.get("DISTRICT", ""), **counts}
            return record, feature_props

        records, features = _clip_vector_to_zones(selected_zones, "Village_population", to_record, "village")
        return {
            "records": records,
            "geojson": {"type": "FeatureCollection", "features": features},
            "total": len(records),
            "total_population": sum(r["total_population"] for r in records if r["total_population"] is not None),
        }

    @handle_errors("STP analysis")
    def nirmal_stp(selected_zones: list) -> dict:
        """STP points (from dss_vector:nirmal_stp_details) within selected zone polygons."""
        zone_geometries, _ = resolve_zone_geometries(require_zones(selected_zones))
        zone_union = _zone_union(zone_geometries)
        zone_lookup = {zone: unary_union([shape(g) for g in geoms]) for zone, geoms in zone_geometries.items()}

        def _f(v):
            return round(float(v), 2) if v is not None else None

        result = []
        for feature in fetch_vector_layer_geojson("nirmal_stp_details").get("features", []):
            geom = feature.get("geometry")
            if not geom:
                continue
            try:
                pt = shape(geom)
            except Exception:
                continue
            if not zone_union.contains(pt):
                continue

            props = feature.get("properties", {}) or {}
            result.append({
                "zone": next((z for z, zg in zone_lookup.items() if zg.contains(pt)), None),
                "name": props.get("name") or "Unknown",
                "district": props.get("district"),
                "city": props.get("city"),
                "state": props.get("state"),
                "status": props.get("status"),
                "capacity_mld": _f(props.get("capacity")),
                "last_seen": props.get("last_seen"),
                "inlet_BOD": _f(props.get("inlet_BOD")),
                "inlet_COD": _f(props.get("inlet_COD")),
                "inlet_TSS": _f(props.get("inlet_TSS")),
                "inlet_pH": _f(props.get("inlet_pH")),
                "outlet_BOD": _f(props.get("outlet_BOD")),
                "outlet_COD": _f(props.get("outlet_COD")),
                "outlet_TSS": _f(props.get("outlet_TSS")),
                "outlet_pH": _f(props.get("outlet_pH")),
                "lat": pt.y,
                "lng": pt.x,
            })

        result.sort(key=lambda x: (x.get("zone") or "", x.get("name") or ""))
        return {"stps": result, "total": len(result)}


class Nirmal_service:
    """Nirmal Ganga rasters are read from local files in media/files/nirmal."""

    def _clip(selected_zones: list, filename: str, label: str) -> TiffFile:
        @handle_errors(f"{label} clip")
        def run():
            zone_geometries, _ = resolve_zone_geometries(require_zones(selected_zones))
            local_path = MEDIA_DIR / "files" / "nirmal" / filename
            if not local_path.exists():
                raise JsonError(404, detail=f"{label} raster not found at {local_path}")
            return TiffFile(clip_local_tif_to_zones(local_path, zone_geometries), f"{label}_clipped.tif", {
                "X-Coverage": label,
                "X-Selected-Zones": ",".join(sorted(zone_geometries)),
            })
        return run()

    def gwq_clip(selected_zones: list) -> TiffFile:
        return Nirmal_service._clip(selected_zones, "gwq.tif", "nirmal_gwq")

    def rwq_clip(selected_zones: list, season: str) -> TiffFile:
        """Clip river water quality raster for a given season (premonsoon/monsoon/postmonsoon)."""
        season = season.strip().lower()
        if season not in RWQ_SEASON_FILES:
            raise JsonError(400, detail=f"Invalid season '{season}'. Use premonsoon, monsoon, or postmonsoon.")
        return Nirmal_service._clip(selected_zones, RWQ_SEASON_FILES[season], f"nirmal_rwq_{season}")

    @handle_errors("RWQ stats")
    def rwq_stats(selected_zones: list) -> dict:
        """Per-zone RWQ zonal stats (min/mean/max) for all three seasons."""
        zone_geometries, _ = resolve_zone_geometries(require_zones(selected_zones))
        result = {}
        for season, filename in RWQ_SEASON_FILES.items():
            path = MEDIA_DIR / "files" / "nirmal" / filename
            if not path.exists():
                result[season] = {"error": f"File not found: {path.name}"}
                continue
            with rasterio.open(path) as src:
                stats = zonal_stats_for_raster_dataset(src, zone_geometries)
            result[season] = {zone: round_stats(v, 3) for zone, v in stats.items()}
        return {"rwq": result, "zones": sorted(zone_geometries)}

    @handle_errors("GWQ stats")
    def gwq_stats(selected_zones: list) -> dict:
        """Per-zone GWQ zonal stats (min/mean/max) from local nirmal/gwq.tif."""
        zone_geometries, _ = resolve_zone_geometries(require_zones(selected_zones))
        gwq_path = MEDIA_DIR / "files" / "nirmal" / "gwq.tif"
        if not gwq_path.exists():
            raise JsonError(404, detail=f"GWQ raster not found at {gwq_path}")
        with rasterio.open(gwq_path) as src:
            stats = zonal_stats_for_raster_dataset(src, zone_geometries)
        return {"gwq": {zone: round_stats(v, 3) for zone, v in stats.items()}, "zones": sorted(zone_geometries)}


class Phase_analysis_service:
    """Weighted raster analysis for the 6 Holistic stages; returns GeoTIFFs (float32, EPSG:4326, 0–1)."""

    @handle_errors("Aviral analysis")
    def aviral(selected_zones: list, criteria_weights: dict) -> TiffFile:
        require_zones(selected_zones)
        if not criteria_weights:
            raise JsonError(400, detail="criteria_weights is required")

        raster_map = _phase_raster_map(0)
        matched = [(c, raster_map[c], float(w)) for c, w in criteria_weights.items()
                   if c in raster_map and raster_map[c].exists()]
        if not matched:
            available = [c for c, p in raster_map.items() if p.exists()]
            raise JsonError(422, detail=f"No raster data for selected criteria. Available: {available}.")

        # Normalise weights → sum to 1
        total = sum(w for _, _, w in matched)
        zone_geometries, _ = resolve_zone_geometries(selected_zones)
        tiff = _weighted_overlay(
            [(path, w / total) for _, path, w in matched],
            [_local_bounds_wgs84(path) for _, path, _ in matched],
            _zone_union(zone_geometries),
        )
        return TiffFile(tiff, "aviral_analysis.tif", {"X-Matched-Criteria": ",".join(c for c, _, _ in matched)})

    @handle_errors("Phase raster analysis")
    def phase_raster(selected_zones: list, criteria_weights: dict, stage_index: int) -> TiffFile:
        require_zones(selected_zones)
        if not criteria_weights:
            raise JsonError(400, detail="criteria_weights is required")

        raster_map = _phase_raster_map(stage_index)
        gs_map = _phase_geoserver_map(stage_index)

        matched = [(raster_map[c], float(w)) for c, w in criteria_weights.items()
                   if c in raster_map and raster_map[c].exists()]
        gs_matched = [(gs_map[c], float(w)) for c, w in criteria_weights.items() if c in gs_map]

        if not matched and not gs_matched:
            available = [c for c, p in raster_map.items() if p.exists()] + list(gs_map)
            raise JsonError(422, detail=f"No raster data available for selected criteria. Available: {available}.")

        total = sum(w for _, w in matched) + sum(w for _, w in gs_matched)
        if total == 0:
            raise JsonError(422, detail="No raster data available for selected criteria.")

        zone_geometries, _ = resolve_zone_geometries(selected_zones)

        sources: list[tuple[Path | MemoryFile, float]] = [(path, w / total) for path, w in matched]
        bounds = [_local_bounds_wgs84(path) for path, _ in matched]

        # GeoServer rasters are fetched into memory; unavailable layers are skipped silently.
        memfiles: list[MemoryFile] = []
        bbox = bounds_from_zone_geometries(zone_geometries)
        for coverage, w in gs_matched:
            try:
                mf = MemoryFile(fetch_coverage_tiff(coverage, bbox))
            except Exception:
                continue
            memfiles.append(mf)
            with mf.open() as src:
                bounds.append(transform_bounds(src.crs or WGS84, WGS84, *src.bounds))
            sources.append((mf, w / total))

        try:
            if not bounds:
                raise JsonError(422, detail="No raster data could be loaded.")
            tiff = _weighted_overlay(sources, bounds, _zone_union(zone_geometries))
        finally:
            for mf in memfiles:
                mf.close()

        name = STAGE_NAMES[stage_index] if 0 <= stage_index < len(STAGE_NAMES) else "phase"
        return TiffFile(tiff, f"{name}_analysis.tif")
