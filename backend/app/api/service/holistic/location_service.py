from pathlib import Path

import pandas as pd

from app.api.exception.exceptions import JsonError
from app.api.service.holistic.geo_utils import MEDIA_DIR


def _read_csv_with_fallback(paths: list[Path]) -> pd.DataFrame:
    for csv_path in paths:
        if csv_path.exists():
            return pd.read_csv(csv_path)
    raise FileNotFoundError(f"Could not find any CSV in: {paths}")


def _clean_code(value) -> str:
    if pd.isna(value):
        return ""
    text = str(value).strip()
    if not text:
        return ""
    if text.endswith(".0"):
        text = text[:-2]
    if text.isdigit():
        return str(int(text))
    return text


def _as_code(code: str):
    return int(code) if code.isdigit() else code


class Location_service:

    def states() -> list[dict]:
        state_df = _read_csv_with_fallback([
            MEDIA_DIR / "location_csv" / "states_new.csv",
            MEDIA_DIR / "gwa_data" / "gwa_csv" / "states.csv",
        ])

        # Normalize possible column naming variants.
        state_code_col = "state_code" if "state_code" in state_df.columns else "STATE_CODE"
        state_name_col = "state_name" if "state_name" in state_df.columns else "STATE_NAME"
        if state_name_col not in state_df.columns:
            state_name_col = "State" if "State" in state_df.columns else "state"

        result = []
        for _, row in state_df[[state_code_col, state_name_col]].dropna().iterrows():
            code = _clean_code(row[state_code_col])
            name = str(row[state_name_col]).strip()
            if not code or not name:
                continue
            result.append({"state_code": _as_code(code), "state_name": name})

        # De-duplicate and sort.
        dedup = {(item["state_code"], item["state_name"]): item for item in result}
        return sorted(dedup.values(), key=lambda x: str(x["state_name"]).lower())

    def districts(state_code_raw) -> list[dict]:
        if state_code_raw is None:
            raise JsonError(400, detail="state_code is required")
        target_state_code = _clean_code(state_code_raw)
        if not target_state_code:
            raise JsonError(400, detail="state_code is required")

        district_df = _read_csv_with_fallback([
            MEDIA_DIR / "location_csv" / "districts_new.csv",
            MEDIA_DIR / "gwa_data" / "gwa_csv" / "districts.csv",
        ])

        state_code_col = "state_code" if "state_code" in district_df.columns else "STATE_CODE"
        district_code_col = "district_code" if "district_code" in district_df.columns else "DISTRICT_C"
        district_name_col = "district_name" if "district_name" in district_df.columns else "DISTRICT"

        district_df[state_code_col] = district_df[state_code_col].map(_clean_code)
        filtered = district_df[district_df[state_code_col] == target_state_code]

        result = []
        for _, row in filtered[[district_code_col, district_name_col, state_code_col]].dropna().iterrows():
            district_code = _clean_code(row[district_code_col])
            district_name = str(row[district_name_col]).strip()
            state_code = _clean_code(row[state_code_col])
            if not district_code or not district_name or not state_code:
                continue
            result.append({
                "district_code": _as_code(district_code),
                "district_name": district_name,
                "state_code": _as_code(state_code),
            })

        dedup = {(item["district_code"], item["district_name"]): item for item in result}
        return sorted(dedup.values(), key=lambda x: str(x["district_name"]).lower())
