"""Publish processed uploads to GeoServer by reference.

GeoServer mounts backend/media at /opt/geoserver/medias (docker-compose.yml), so files are
registered in place instead of being streamed over REST — a 1 GB raster is never copied twice.
"""
from pathlib import Path

import requests

from app.api.service.holistic.geo_utils import MEDIA_DIR
from app.conf.settings import Settings

WORKSPACE = "dss_uploads"
GEOSERVER_MEDIA_DIR = "/opt/geoserver/medias"
TIMEOUT = 120

# Blue -> green -> yellow -> red, used for single-band rasters.
RAMP = ["#2c7bb6", "#00a6ca", "#00ccbc", "#90eb9d", "#ffff8c", "#f9d057", "#f29e2e", "#e76818", "#d7191c"]


def _rest() -> str:
    return Settings().GEOSERVER_URL.rstrip("/") + "/rest"


def _auth() -> tuple[str, str]:
    s = Settings()
    return (s.GEOSERVER_USERNAME, s.GEOSERVER_PASSWORD)


def _check(resp: requests.Response, action: str):
    if resp.status_code not in (200, 201):
        raise RuntimeError(f"GeoServer {action} failed ({resp.status_code}): {resp.text[:300]}")


def _geoserver_path(path: Path) -> str:
    return f"{GEOSERVER_MEDIA_DIR}/{path.relative_to(MEDIA_DIR).as_posix()}"


def ensure_workspace():
    if requests.get(f"{_rest()}/workspaces/{WORKSPACE}.json", auth=_auth(), timeout=TIMEOUT).status_code == 200:
        return
    resp = requests.post(f"{_rest()}/workspaces", json={"workspace": {"name": WORKSPACE}}, auth=_auth(), timeout=TIMEOUT)
    if resp.status_code != 409:
        _check(resp, "create workspace")


def _ramp_sld(name: str, vmin: float, vmax: float, nodata) -> str:
    step = (vmax - vmin) / (len(RAMP) - 1) if vmax > vmin else 0
    entries = []
    if nodata is not None:
        entries.append(f'<ColorMapEntry color="#000000" quantity="{nodata}" opacity="0"/>')
    for i, color in enumerate(RAMP):
        entries.append(f'<ColorMapEntry color="{color}" quantity="{vmin + step * i}" opacity="0.85"/>')
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor version="1.0.0" xmlns="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc">
  <NamedLayer><Name>{name}</Name><UserStyle><Title>{name}</Title><FeatureTypeStyle><Rule>
    <RasterSymbolizer><ColorMap type="ramp">{''.join(entries)}</ColorMap></RasterSymbolizer>
  </Rule></FeatureTypeStyle></UserStyle></NamedLayer>
</StyledLayerDescriptor>"""


def _apply_style(layer: str, sld: str):
    style = f"{layer}_style"
    requests.delete(f"{_rest()}/workspaces/{WORKSPACE}/styles/{style}?purge=true", auth=_auth(), timeout=TIMEOUT)
    resp = requests.post(
        f"{_rest()}/workspaces/{WORKSPACE}/styles?name={style}",
        data=sld.encode("utf-8"),
        headers={"Content-Type": "application/vnd.ogc.sld+xml"},
        auth=_auth(),
        timeout=TIMEOUT,
    )
    _check(resp, "upload style")
    resp = requests.put(
        f"{_rest()}/layers/{WORKSPACE}:{layer}",
        json={"layer": {"defaultStyle": {"name": f"{WORKSPACE}:{style}"}}},
        auth=_auth(),
        timeout=TIMEOUT,
    )
    _check(resp, "set default style")


def publish_raster(cog_path: Path, layer: str, stats: dict | None) -> str:
    ensure_workspace()
    resp = requests.put(
        f"{_rest()}/workspaces/{WORKSPACE}/coveragestores/{layer}/external.geotiff"
        f"?configure=first&coverageName={layer}",
        data=_geoserver_path(cog_path),  # external.geotiff wants a bare path, not a file:// URL
        headers={"Content-Type": "text/plain"},
        auth=_auth(),
        timeout=TIMEOUT,
    )
    _check(resp, "publish raster")
    if stats and stats.get("min") is not None and stats.get("max") is not None:
        _apply_style(layer, _ramp_sld(layer, stats["min"], stats["max"], stats.get("nodata")))
    return f"{WORKSPACE}:{layer}"


def publish_vector(gpkg_path: Path, layer: str, table: str) -> str:
    ensure_workspace()
    store = {
        "dataStore": {
            "name": layer,
            "connectionParameters": {"entry": [
                {"@key": "database", "$": f"file://{_geoserver_path(gpkg_path)}"},
                {"@key": "dbtype", "$": "geopkg"},
            ]},
        }
    }
    resp = requests.post(f"{_rest()}/workspaces/{WORKSPACE}/datastores", json=store, auth=_auth(), timeout=TIMEOUT)
    _check(resp, "create datastore")
    resp = requests.post(
        f"{_rest()}/workspaces/{WORKSPACE}/datastores/{layer}/featuretypes",
        json={"featureType": {"name": layer, "nativeName": table, "srs": "EPSG:4326"}},
        auth=_auth(),
        timeout=TIMEOUT,
    )
    _check(resp, "publish feature type")
    return f"{WORKSPACE}:{layer}"


def unpublish(qualified_layer: str, kind: str):
    """Best effort: a dataset row must be deletable even if GeoServer has lost the store."""
    layer = qualified_layer.split(":", 1)[-1]
    store_type = "coveragestores" if kind == "raster" else "datastores"
    try:
        requests.delete(f"{_rest()}/workspaces/{WORKSPACE}/{store_type}/{layer}?recurse=true&purge=none", auth=_auth(), timeout=TIMEOUT)
        requests.delete(f"{_rest()}/workspaces/{WORKSPACE}/styles/{layer}_style?purge=true", auth=_auth(), timeout=TIMEOUT)
    except requests.RequestException:
        pass
