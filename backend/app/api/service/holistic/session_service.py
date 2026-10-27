import json
import re
import time
from pathlib import Path

from app.api.exception.exceptions import JsonError
from app.api.service.holistic.geo_utils import MEDIA_DIR

STAGE_NAMES = ["aviral", "nirmal", "jan", "arth", "gyan", "jeevant"]


def _safe_id(session_id: str) -> str:
    # Sanitise — only allow alphanumeric, dash, underscore
    return re.sub(r"[^a-zA-Z0-9_\-]", "_", session_id)


def _sessions_dir() -> Path:
    d = MEDIA_DIR / "sessions"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _phase_raster_paths(stage_index: int) -> tuple[Path, Path]:
    temp_dir = MEDIA_DIR / "temp"
    temp_dir.mkdir(parents=True, exist_ok=True)
    name = STAGE_NAMES[stage_index] if 0 <= stage_index < len(STAGE_NAMES) else f"phase_{stage_index}"
    return temp_dir / f"{name}.tif", temp_dir / f"{name}.json"


class Phase_raster_service:
    """Saved phase rasters live in media/temp so the /split page can read them."""

    def save(stage_index: int, stage_name: str | None, criteria: str, weights: str, tiff: bytes) -> dict:
        tif_path, meta_path = _phase_raster_paths(stage_index)
        tif_path.write_bytes(tiff)

        meta = {
            "stage_index": stage_index,
            "stage_name": stage_name or f"Stage {stage_index + 1}",
            "criteria": json.loads(criteria),
            "weights": json.loads(weights),
            "generated_at": int(time.time() * 1000),
        }
        meta_path.write_text(json.dumps(meta), encoding="utf-8")
        return {"ok": True, "stage_index": stage_index, "saved_at": meta["generated_at"]}

    def meta(stage_index: int) -> dict:
        _, meta_path = _phase_raster_paths(stage_index)
        if not meta_path.exists():
            raise JsonError(404, detail="No saved raster for this stage")
        return json.loads(meta_path.read_text(encoding="utf-8"))

    def tiff(stage_index: int) -> bytes:
        tif_path, _ = _phase_raster_paths(stage_index)
        if not tif_path.exists():
            raise JsonError(404, detail="No saved raster for this stage")
        return tif_path.read_bytes()


class Session_service:
    """Split-page sessions stored as JSON files in media/sessions."""

    def save(data: dict) -> dict:
        session_id = data.get("sessionId")
        if not session_id:
            raise JsonError(400, detail="sessionId required")
        safe_id = _safe_id(session_id)
        path = _sessions_dir() / f"{safe_id}.json"
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        return {"ok": True, "file": f"sessions/{safe_id}.json"}

    def list() -> dict:
        sessions = []
        for f in sorted(_sessions_dir().glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
            try:
                sessions.append(json.loads(f.read_text(encoding="utf-8")))
            except Exception:
                pass
        return {"sessions": sessions}

    def delete(session_id: str) -> dict:
        path = _sessions_dir() / f"{_safe_id(session_id)}.json"
        if path.exists():
            path.unlink()
        return {"ok": True}
