import json
import time
import zlib
from datetime import datetime

from sqlalchemy.orm import Session

from app.api.exception.exceptions import JsonError
from app.database.models import User, User_Session, User_Phase_Raster

STAGE_NAMES = ["aviral", "nirmal", "jan", "arth", "gyan", "jeevant"]


def pack(data: dict) -> bytes:
    return zlib.compress(json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8"), 6)


def unpack(blob: bytes) -> dict:
    return json.loads(zlib.decompress(blob).decode("utf-8"))


def _summary(data: dict) -> dict:
    """Small listing fields so the history tab never has to inflate the state blobs."""
    return {
        "startedAt": data.get("startedAt"),
        "lastActivityAt": data.get("lastActivityAt"),
        "zones": (data.get("zones") or [])[:50],
        "criteria": (data.get("criteria") or [])[:50],
        "activeModule": data.get("activeModule"),
        "hasPolygon": bool(data.get("drawnPolygon")),
        "marks": len(data.get("marks") or []),
        "stickyNotes": len(data.get("stickyNotes") or []),
        "messages": len(data.get("messages") or []),
    }


def _session_out(row: User_Session) -> dict:
    return {
        "sessionId": row.session_key,
        "title": row.title,
        "module": row.module,
        "stateSize": row.state_size,
        "updatedAt": int(row.last_activity_at.timestamp() * 1000),
        **row.summary,
    }


class Phase_raster_service:
    """Phase rasters are kept per user so two people generating the same stage don't overwrite each other."""

    def _row(db: Session, user: User, stage_index: int) -> User_Phase_Raster:
        row = db.query(User_Phase_Raster).filter_by(user_id=user.id, stage_index=stage_index).first()
        if row is None:
            raise JsonError(404, detail="No saved raster for this stage")
        return row

    def save(db: Session, user: User, stage_index: int, stage_name: str | None, criteria: str, weights: str, tiff: bytes) -> dict:
        meta = {
            "stage_index": stage_index,
            "stage_name": stage_name or f"Stage {stage_index + 1}",
            "criteria": json.loads(criteria),
            "weights": json.loads(weights),
            "generated_at": int(time.time() * 1000),
        }
        row = db.query(User_Phase_Raster).filter_by(user_id=user.id, stage_index=stage_index).first()
        if row is None:
            row = User_Phase_Raster(user_id=user.id, stage_index=stage_index)
            db.add(row)
        row.meta = meta
        row.tiff = tiff
        db.commit()
        return {"ok": True, "stage_index": stage_index, "saved_at": meta["generated_at"]}

    def meta(db: Session, user: User, stage_index: int) -> dict | None:
        """None when nothing was generated yet; /split polls this, so it isn't an error."""
        row = db.query(User_Phase_Raster).filter_by(user_id=user.id, stage_index=stage_index).first()
        return row.meta if row else None

    def tiff(db: Session, user: User, stage_index: int) -> bytes:
        return Phase_raster_service._row(db, user, stage_index).tiff


class Session_service:
    """Split workspaces saved per user; the full state is stored compressed as bytes."""

    def save(db: Session, user: User, data: dict) -> dict:
        session_key = str(data.get("sessionId") or "").strip()[:100]
        if not session_key:
            raise JsonError(400, detail="sessionId required")
        blob = pack(data)
        row = db.query(User_Session).filter_by(user_id=user.id, session_key=session_key).first()
        if row is None:
            row = User_Session(user_id=user.id, session_key=session_key, module=data.get("module") or "split")
            db.add(row)
        row.title = (data.get("title") or row.title or "")[:255] or None
        row.summary = _summary(data)
        row.state = blob
        row.state_size = len(blob)
        row.last_activity_at = datetime.now()
        db.commit()
        return {"ok": True, "sessionId": session_key, "stateSize": len(blob)}

    def list(db: Session, user: User, limit: int = 100) -> dict:
        rows = (
            db.query(User_Session)
            .filter_by(user_id=user.id)
            .order_by(User_Session.last_activity_at.desc())
            .limit(limit)
            .all()
        )
        return {"sessions": [_session_out(r) for r in rows]}

    def get(db: Session, user: User, session_key: str) -> dict:
        row = db.query(User_Session).filter_by(user_id=user.id, session_key=session_key).first()
        if row is None:
            raise JsonError(404, detail="Session not found")
        return unpack(row.state)

    def latest(db: Session, user: User) -> dict:
        row = (
            db.query(User_Session)
            .filter_by(user_id=user.id)
            .order_by(User_Session.last_activity_at.desc())
            .first()
        )
        return {"session": unpack(row.state) if row else None}

    def rename(db: Session, user: User, session_key: str, title: str) -> dict:
        row = db.query(User_Session).filter_by(user_id=user.id, session_key=session_key).first()
        if row is None:
            raise JsonError(404, detail="Session not found")
        row.title = title.strip()[:255] or None
        db.commit()
        return _session_out(row)

    def delete(db: Session, user: User, session_key: str) -> dict:
        db.query(User_Session).filter_by(user_id=user.id, session_key=session_key).delete()
        db.commit()
        return {"ok": True}
