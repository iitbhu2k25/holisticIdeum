"""
Push all GeoServer data used by the backend from backend/media.

Run from the host (GeoServer published on localhost:9090):
    python backend/script/push_to_geoserver.py

or inside the backend container (uses GEOSERVER_URL from .env):
    docker compose exec backend python script/push_to_geoserver.py

Only one part:
    python backend/script/push_to_geoserver.py --only vector|raster|stp
"""
import argparse
import csv
import os
from pathlib import Path

import requests

# ================= CONFIG =================
GEOSERVER_URL = os.environ.get("GEOSERVER_URL", "http://localhost:9090/geoserver").rstrip("/") + "/rest"
GEOSERVER_USER = os.environ.get("GEOSERVER_USERNAME", "admin")
GEOSERVER_PASSWORD = os.environ.get("GEOSERVER_PASSWORD", "geoserver")
AUTH = (GEOSERVER_USER, GEOSERVER_PASSWORD)

VECTOR_WORKSPACE = "dss_vector"   # Area, STP_Village, Village_population, industries, ...
RASTER_WORKSPACE = "dss_raster"   # rainfall_2015..2024, recharge_gw, arth_*, gyan_*, ...
STP_WORKSPACE = "raster_work"     # STP suitability / priority layers and their SLD styles

MEDIA = Path(__file__).resolve().parent.parent / "media"

# ================= VECTOR ZIP DIRECTORIES =================
ZIP_DIRS = [
    MEDIA / "gwa_data" / "shp_zip",
    MEDIA / "shape_file" / "nirmal",
    MEDIA / "shape_file" / "jan",
]

# ================= TIFF DIRECTORIES =================
# Layer name is "<folder>_<file>" (e.g. arth_agriculture, flow_direction_1),
# except rainfall/recharge which keep the file name (rainfall_2024, recharge_gw).
TIFF_DIRS = [
    MEDIA / "files" / "aviral" / "Rainfall",
    MEDIA / "files" / "aviral" / "Recharge",
    MEDIA / "files" / "aviral" / "slope",
    MEDIA / "files" / "aviral" / "flow_direction",
    MEDIA / "files" / "aviral" / "river_flow",
    MEDIA / "files" / "aviral" / "drain_flow",
    MEDIA / "files" / "aviral" / "channel",
    MEDIA / "files" / "nirmal",
    MEDIA / "files" / "arth",
    MEDIA / "files" / "gyan",
    MEDIA / "files" / "jeevant",
    MEDIA / "files" / "jan",
]

# ================= STP RASTERS + SLD =================
# CSV columns: layer_name, file_path, sld_path (paths start with "media/")
STP_CSVS = [
    MEDIA / "Rajat_data" / "csv_file_stp" / "stp_suitability_visual_raster.csv",
    MEDIA / "Rajat_data" / "csv_file_stp" / "stp_priority_visual_raster.csv",
    MEDIA / "Rajat_data" / "csv_file_stp" / "gwz_visual.csv",
    MEDIA / "Rajat_data" / "csv_file_stp" / "gwpl_visual.csv",
    MEDIA / "Rajat_data" / "csv_file_stp" / "mar_suitability_visual_raster.csv",
]


def _ok(response, label):
    if response.status_code in (200, 201, 202):
        print(f"[✓] {label}")
        return True
    print(f"[!] {label} failed ({response.status_code}): {response.text[:300]}")
    return False


def _media_path(path_from_csv: str) -> Path:
    return MEDIA / path_from_csv.removeprefix("media/")


# ================= WORKSPACE =================
def create_workspace(workspace):
    response = requests.post(
        f"{GEOSERVER_URL}/workspaces",
        auth=AUTH,
        headers={"Content-Type": "text/xml"},
        data=f"<workspace><name>{workspace}</name></workspace>",
    )
    if response.status_code in (201, 409):
        print(f"[✓] Workspace '{workspace}' ready.")
    else:
        print(f"[!] Workspace error ({workspace}): {response.text}")


# ================= SHAPEFILE ZIP UPLOAD =================
def upload_shapefile(zip_path: Path, workspace=VECTOR_WORKSPACE):
    store_name = zip_path.stem
    with open(zip_path, "rb") as f:
        response = requests.put(
            f"{GEOSERVER_URL}/workspaces/{workspace}/datastores/{store_name}/file.shp",
            auth=AUTH,
            headers={"Content-type": "application/zip"},
            data=f,
        )
    _ok(response, f"Shapefile {workspace}:{store_name}")


# ================= TIFF UPLOAD =================
def upload_tiff(tiff_path: Path, layer_name: str, workspace=RASTER_WORKSPACE):
    with open(tiff_path, "rb") as f:
        response = requests.put(
            f"{GEOSERVER_URL}/workspaces/{workspace}/coveragestores/{layer_name}/file.geotiff",
            # coverageName keeps the layer name equal to the store name the backend asks for
            params={"coverageName": layer_name},
            auth=AUTH,
            headers={"Content-type": "image/tiff"},
            data=f,
        )
    return _ok(response, f"TIFF {workspace}:{layer_name}")


def tiff_layer_name(tiff_path: Path) -> str:
    folder_name = tiff_path.parent.name.lower()
    if folder_name in ("rainfall", "recharge"):
        return tiff_path.stem
    return f"{folder_name}_{tiff_path.stem}"


# ================= SLD STYLE =================
def upload_style(sld_path: Path, style_name: str, workspace: str):
    sld = sld_path.read_bytes()
    headers = {"Content-Type": "application/vnd.ogc.sld+xml"}
    url = f"{GEOSERVER_URL}/workspaces/{workspace}/styles"
    exists = requests.get(f"{url}/{style_name}.json", auth=AUTH).status_code == 200
    if exists:
        response = requests.put(f"{url}/{style_name}", auth=AUTH, headers=headers, data=sld)
    else:
        response = requests.post(url, params={"name": style_name}, auth=AUTH, headers=headers, data=sld)
    return _ok(response, f"Style {workspace}:{style_name}")


def set_default_style(layer_name: str, style_name: str, workspace: str):
    response = requests.put(
        f"{GEOSERVER_URL}/layers/{workspace}:{layer_name}",
        auth=AUTH,
        json={"layer": {"defaultStyle": {"name": style_name, "workspace": workspace}}},
    )
    _ok(response, f"Default style {workspace}:{layer_name} -> {style_name}")


# ================= STEPS =================
def push_vectors():
    print("\n=== Uploading Shapefiles ===")
    create_workspace(VECTOR_WORKSPACE)
    for zip_dir in ZIP_DIRS:
        if not zip_dir.exists():
            print(f"[!] ZIP directory not found: {zip_dir}")
            continue
        print(f"\n--- {zip_dir.relative_to(MEDIA)} ---")
        for zip_file in sorted(zip_dir.glob("*.zip")):
            upload_shapefile(zip_file)


def push_rasters():
    print("\n=== Uploading TIFF Files ===")
    create_workspace(RASTER_WORKSPACE)
    for tiff_dir in TIFF_DIRS:
        if not tiff_dir.exists():
            print(f"[!] TIFF directory not found: {tiff_dir}")
            continue
        print(f"\n--- {tiff_dir.relative_to(MEDIA)} ---")
        for tif in sorted(tiff_dir.glob("*.tif")):
            upload_tiff(tif, tiff_layer_name(tif))


def push_stp_layers():
    print("\n=== Uploading STP rasters with SLD styles ===")
    create_workspace(STP_WORKSPACE)
    for csv_path in STP_CSVS:
        if not csv_path.exists():
            print(f"[!] CSV not found: {csv_path}")
            continue
        print(f"\n--- {csv_path.name} ---")
        with open(csv_path, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                layer_name = row["layer_name"].strip()
                tif = _media_path(row["file_path"].strip())
                sld = _media_path(row["sld_path"].strip())
                if not tif.exists():
                    print(f"[-] skip {layer_name}: missing {tif.relative_to(MEDIA)}")
                    continue
                if not upload_tiff(tif, layer_name, STP_WORKSPACE):
                    continue
                if sld.exists() and upload_style(sld, layer_name, STP_WORKSPACE):
                    set_default_style(layer_name, layer_name, STP_WORKSPACE)
                elif not sld.exists():
                    print(f"[-] no SLD for {layer_name}: missing {sld.relative_to(MEDIA)}")


# ================= MAIN =================
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Push backend/media data to GeoServer")
    parser.add_argument("--only", choices=["vector", "raster", "stp"], help="push only one group")
    args = parser.parse_args()

    print(f"========= GEOSERVER UPLOAD -> {GEOSERVER_URL} =========")
    print(f"media: {MEDIA}")

    if args.only in (None, "vector"):
        push_vectors()
    if args.only in (None, "raster"):
        push_rasters()
    if args.only in (None, "stp"):
        push_stp_layers()

    print("\n========= UPLOAD COMPLETED =========")
