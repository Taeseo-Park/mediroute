"""진료 전문성 추천 엔진/DB 연결 지점.

현재는 학습·UI 확인용 가상 교수만 반환합니다. 실제 의료진/예약 정보가 아닙니다.
추후 DB 연동 시 load_professors()를 실제 조회 결과로 대체하고, 진료적합성은
환자 질환·증상과 전문 분야 매칭 모듈이 정량화하여 0~1로 공급해야 합니다.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

DEPARTMENTS = ("정형외과", "신경과", "소화기내과")
CONDITIONS = {
    "정형외과": ("무릎", "어깨", "척추"),
    "신경과": ("두통", "어지럼증", "뇌졸중"),
    "소화기내과": ("위장", "간", "대장"),
}

# 해당 직급·연차 점수는 확정 연구 기준이 아닌 시연용 가정.
DEMO_POSITION_SCORES = {"교수": 0.8, "부교수": 0.6, "조교수": 0.4}
DEMO_CAREER_MAX_YEARS = 30


def load_professors(department: str) -> list[dict[str, Any]]:
    """[DB 교체 지점] 현재는 data/mock_professors.json 사용.

    실제 DB 연동 시 반환해야 할 필드:
      id, hospital_id, name, department, specialty, career_years (nullable),
      position (nullable), fit_by_condition 또는 계산된 fit_score (0~1).
    병원은 app.HOSPITALS의 id와 연결하며, 서버는 사용자 위치를 저장하지 않습니다.
    """
    path = Path(__file__).parent / "data" / "mock_professors.json"
    records = json.loads(path.read_text(encoding="utf-8"))
    return [record for record in records if record.get("department") == department]


def career_score(years: Any, position: str | None) -> tuple[float, str]:
    if years is not None and years != "":
        try:
            numeric = float(years)
        except (TypeError, ValueError):
            pass
        else:
            if numeric >= 0:
                return round(min(1, numeric / DEMO_CAREER_MAX_YEARS), 4), "연차 기준(데모)"
    if position in DEMO_POSITION_SCORES:
        return DEMO_POSITION_SCORES[position], "직급 기준(데모)"
    return 0.5, "정보 없음(0.5)"


def score_record(record: dict[str, Any], condition: str) -> dict[str, Any]:
    fit = record.get("fit_score")
    if fit is None:
        fit = (record.get("fit_by_condition") or {}).get(condition)
    if fit is None:
        raise ValueError(f"{record.get('id')}의 진료적합성 값이 없습니다.")
    fit = float(fit)
    if not 0 <= fit <= 1:
        raise ValueError("진료적합성 점수는 0~1이어야 합니다.")
    career, basis = career_score(record.get("career_years"), record.get("position"))
    expertise = round(0.8 * fit + 0.2 * career, 4)
    return {"id": record["id"], "hospital_id": record["hospital_id"],
            "name": record["name"], "department": record["department"],
            "specialty": record["specialty"], "fitness_score": round(fit, 4),
            "career_score": career, "career_basis": basis,
            "expertise_score": expertise, "expertise_score_100": round(100 * expertise, 1),
            "reservation_available": None}  # 예약 연동 전이므로 사실 여부 표시 금지


def ranked_recommendations(department: str, condition: str) -> list[dict[str, Any]]:
    rows = [score_record(record, condition) for record in load_professors(department)]
    rows.sort(key=lambda r: (-r["expertise_score"], r["id"]))
    for rank, item in enumerate(rows, start=1):
        item["rank"] = rank
    return rows
