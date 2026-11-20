"""경기 남부 5개 병원 이동시간/접근성 프로토타입 (Kakao API)."""
from __future__ import annotations

import math
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from typing import Any

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request

from recommendations import DEPARTMENTS, CONDITIONS, ranked_recommendations
from specialties import SPECIALTIES

load_dotenv()
app = Flask(__name__)

KAKAO_JS_KEY = os.getenv("KAKAO_JAVASCRIPT_KEY", "").strip()
KAKAO_REST_KEY = os.getenv("KAKAO_REST_API_KEY", "").strip()
LIMIT_MINUTES = float(os.getenv("ACCESSIBILITY_LIMIT_MINUTES", "180"))
if LIMIT_MINUTES <= 0:
    raise ValueError("ACCESSIBILITY_LIMIT_MINUTES는 0보다 커야 합니다.")

HEADERS = {"Authorization": f"KakaoAK {KAKAO_REST_KEY}"}
LOCAL_BASE = "https://dapi.kakao.com"
CAR_BASE = "https://apis-navi.kakaomobility.com"
TIMEOUT = 12


@dataclass(frozen=True)
class Hospital:
    id: str
    name: str
    address: str
    lat: float
    lng: float


# 고정 WGS84 좌표: 각 병원의 도로명주소 위치를 근거로 한 대표점.
# 자동차 진입구/외래동 출입구가 아니므로, 실제 서비스 전에 카카오맵에서
# 수단별(차량·도보 등) 진입 좌표를 직접 검증하고 필요시 조정할 것.
HOSPITALS = [
    Hospital("ajou", "아주대학교병원", "경기 수원시 영통구 월드컵로 164", 37.2794612, 127.0476837),
    Hospital("vincent", "가톨릭대학교 성빈센트병원", "경기 수원시 팔달구 중부대로 93", 37.2768855, 127.0267533),
    Hospital("yongin", "용인세브란스병원", "경기 용인시 기흥구 동백죽전대로 363", 37.2708050, 127.1485144),
    Hospital("snubh", "분당서울대학교병원", "경기 성남시 분당구 구미로173번길 82", 37.3516694, 127.1234066),
    Hospital("cha", "분당차병원", "경기 성남시 분당구 야탑로 59", 37.4102384, 127.1254535),
]
HOSPITAL_LOOKUP = {h.id: h for h in HOSPITALS}
MODES = {"car", "transit", "walk", "bike"}

# 사용자 위치는 DB/파일에 저장하지 않습니다. 단기 결과 캐시만 사용합니다.
_cache_lock = threading.Lock()
_cache: dict[Any, tuple[float, Any]] = {}


def cached(key: Any, ttl: int, get_value):
    now = time.monotonic()
    with _cache_lock:
        result = _cache.get(key)
        if result and result[0] > now:
            return result[1]
    value = get_value()
    with _cache_lock:
        _cache[key] = (time.monotonic() + ttl, value)
    return value


def kakao_get(url: str, params: dict[str, Any]) -> dict[str, Any]:
    if not KAKAO_REST_KEY:
        raise ValueError(".env에 KAKAO_REST_API_KEY를 설정하세요.")
    response = requests.get(url, params=params, headers=HEADERS, timeout=TIMEOUT)
    if not response.ok:
        try:
            data = response.json()
            detail = data.get("msg") or data.get("message") or data.get("error_message") or ""
        except ValueError:
            detail = ""
        raise RuntimeError(f"Kakao API HTTP {response.status_code}: {detail or '요청 실패'}")
    try:
        return response.json()
    except ValueError as exc:
        raise RuntimeError("Kakao API에서 JSON 응답을 받지 못했습니다.") from exc


def hospital_location(hospital: Hospital) -> dict[str, Any]:
    """추가 Geocoding 요청 없이 저장된 병원 위·경도를 반환."""
    return asdict(hospital)


def straight_line_km(start_lat: float, start_lng: float, dest_lat: float, dest_lng: float) -> float:
    """길찾기 API 실패 시 정보 제공용 직선거리. 도로 이동거리가 아님."""
    radius = 6371.0088
    phi1, phi2 = math.radians(start_lat), math.radians(dest_lat)
    dphi = phi2 - phi1
    dlambda = math.radians(dest_lng - start_lng)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return round(radius * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a)), 2)


def validate_coordinates(obj: dict[str, Any]) -> tuple[float, float]:
    try:
        lat = float(obj["lat"])
        lng = float(obj["lng"])
    except (ValueError, TypeError, KeyError) as exc:
        raise ValueError("출발지의 lat(위도), lng(경도)가 필요합니다.") from exc
    if not (math.isfinite(lat) and math.isfinite(lng) and 33 <= lat <= 39 and 124 <= lng <= 132):
        raise ValueError("대한민국 내의 유효한 위도·경도를 입력하세요.")
    return lat, lng


def accessibility_score(duration_seconds: float, max_minutes: float = LIMIT_MINUTES) -> float:
    """시간을 정규화한 0~1 점수. 임시 기준시간 초과는 0점."""
    return round(max(0.0, 1.0 - (duration_seconds / 60.0) / max_minutes), 4)


def extract_step_path(steps: list[dict[str, Any]]) -> list[list[float]]:
    coordinates: list[list[float]] = []
    for step in steps:
        points = (step.get("path") or {}).get("points", [])
        for pair in points:
            if isinstance(pair, list) and len(pair) >= 2:
                coordinates.append([float(pair[1]), float(pair[0])])  # Kakao[x,y] → 지도[lat,lng]
    return coordinates[:5000]


def parse_route(data: dict[str, Any], mode: str) -> dict[str, Any]:
    """공식 응답에서 예상 소요시간(초), 거리(m), 경로 좌표를 추출."""
    if mode == "car":
        routes = data.get("routes") or []
        route = next((r for r in routes if r.get("result_code") == 0), None)
        if route is None:
            reason = routes[0].get("result_msg") if routes else "경로 없음"
            raise RuntimeError(f"자동차 경로 조회 실패: {reason}")
        summary = route.get("summary") or {}
        duration = summary.get("duration")
        distance = summary.get("distance")
        points = []
        for section in route.get("sections", []):
            for road in section.get("roads", []):
                vertices = road.get("vertexes") or []
                points.extend([[float(vertices[i + 1]), float(vertices[i])] for i in range(0, len(vertices) - 1, 2)])
        path = points[:5000]
        url = None  # 자동차는 주소 기반 Kakao Maps 링크를 프런트에서 구성
    elif mode == "transit":
        status = data.get("status")

        if status == "NO_RESULTS":
            raise RuntimeError(
                "현재 출발지에서 해당 병원까지 "
                "대중교통 경로가 검색되지 않습니다. "
                "가까운 거리라면 도보 경로를 확인하거나 "
                "출발지를 변경해 주세요."
            )

        if status != "OK":
            raise RuntimeError(
                f"대중교통 경로 조회 실패: {status}"
            )
        routes = data.get("routes") or []
        if not routes:
            raise RuntimeError("대중교통 경로가 없습니다.")
        # 실제 추천된 경로들 중 가장 짧은 예상 소요시간 선택
        route = min(routes, key=lambda r: r.get("properties", {}).get("totalTime", float("inf")))
        props = route.get("properties") or {}
        duration = props.get("totalTime")
        distance = props.get("totalDistance")
        path = extract_step_path(route.get("steps", []))
        url = (data.get("properties") or {}).get("landingURL")
    else:
        if data.get("status") != "OK":
            raise RuntimeError(f"경로 조회 결과: {data.get('status', '알 수 없음')}")
        route = data.get("route") or {}
        props = route.get("properties") or {}
        duration = props.get("totalTime")
        distance = props.get("totalDistance")
        path = []
        for leg in route.get("legs", []):
            path.extend(extract_step_path(leg.get("steps", [])))
        path = path[:5000]
        url = props.get("landingUrl")

    if duration is None or distance is None:
        raise RuntimeError("API 응답에 이동시간 또는 이동거리가 없습니다.")
    seconds = float(duration)
    if seconds < 0:
        raise RuntimeError("비정상적인 이동시간입니다.")
    return {
        "duration_seconds": round(seconds),
        "duration_minutes": round(seconds / 60, 1),
        "distance_km": round(float(distance) / 1000, 2),
        "score": accessibility_score(seconds),
        "score_100": round(accessibility_score(seconds) * 100, 1),
        "path": path,
        "kakao_route_url": url,
    }


def get_route(mode: str, start_lat: float, start_lng: float, dest_lat: float, dest_lng: float):
    if mode == "car":
        url = f"{CAR_BASE}/v1/directions"
        params = {
            "origin": f"{start_lng},{start_lat}",
            "destination": f"{dest_lng},{dest_lat}",
            "priority": "TIME",  # 가장 빠른 차량 경로
            "summary": "false",  # 지도에 경로를 그릴 상세 좌표 포함
        }
    else:
        endpoint = {"transit": "publictraffic", "walk": "walk", "bike": "bicycle"}[mode]
        url = f"{LOCAL_BASE}/v2/routing/{endpoint}"
        params = {
            "start_x": start_lng,
            "start_y": start_lat,
            "end_x": dest_lng,
            "end_y": dest_lat,
            "input_coord": "WGS84",
            "output_coord": "WGS84",
        }
        if mode == "walk":
            params["route_mode"] = "SHORTEST"
        if mode == "bike":
            params["route_mode"] = "SHORTEST"

    def lookup():
        raw = kakao_get(url, params)
        return parse_route(raw, mode)
    # 동일 위치 + 교통수단 반복 조회 시 2분 캐시
    key = ("route", mode, round(start_lat, 5), round(start_lng, 5), round(dest_lat, 5), round(dest_lng, 5))
    return cached(key, 120, lookup)


@app.get("/")
def index():
    return render_template("index.html", kakao_js_key=KAKAO_JS_KEY, limit_minutes=LIMIT_MINUTES)


@app.get("/api/hospitals")
def hospitals():
    # API 키 없이도 사용 가능한 고정 병원 좌표: 주소→좌표 변환 호출이 없음.
    return jsonify({"hospitals": [hospital_location(h) for h in HOSPITALS],
                    "score_limit_minutes": LIMIT_MINUTES})


@app.get("/api/specialties")
def specialties():
    """첫 화면의 진료과/부위/질환 옵션. 질환명은 현재 UI 입력 용도입니다."""
    return jsonify({"departments": SPECIALTIES, "data_source": "demo"})


@app.get("/api/recommendations")
def recommendations():
    """전문성 기준 가상 교수 순위. 이동거리·시간은 /api/evaluate 결과와 UI에서 결합."""
    department = request.args.get("department", "정형외과")
    condition = request.args.get("condition", "무릎")
    if department not in DEPARTMENTS:
        return jsonify({"error": "지원하지 않는 진료과입니다."}), 400
    if condition not in CONDITIONS[department]:
        return jsonify({"error": "선택한 진료과의 세부 분야를 확인하세요."}), 400
    items = ranked_recommendations(department, condition)
    return jsonify({"department": department, "condition": condition,
                    "data_source": "demo", "is_demo": True,
                    "weight_fitness": 0.8, "weight_career": 0.2,
                    "results": items, "total": len(items)})


@app.get("/api/search")
def search_location():
    keyword = request.args.get("q", "").strip()
    if len(keyword) < 2 or len(keyword) > 80:
        return jsonify({"error": "검색어를 2~80자로 입력하세요."}), 400
    try:
        result = kakao_get(f"{LOCAL_BASE}/v2/local/search/keyword.json", {"query": keyword, "size": 10})
        items = [
            {"name": p.get("place_name"), "address": p.get("road_address_name") or p.get("address_name"),
             "lat": float(p["y"]), "lng": float(p["x"])}
            for p in result.get("documents", [])
        ]
        return jsonify({"results": items})
    except (ValueError, RuntimeError, requests.RequestException) as exc:
        return jsonify({"error": str(exc)}), 502


def evaluate_one(hospital: Hospital, mode: str, lat: float, lng: float) -> dict[str, Any]:
    info = {**asdict(hospital)}
    info["direct_distance_km"] = straight_line_km(lat, lng, hospital.lat, hospital.lng)
    try:
        # 주소 Geocoding API 호출 없음: 고정 좌표 사용
        info.update({"lat": hospital.lat, "lng": hospital.lng})
        result = get_route(mode, lat, lng, hospital.lat, hospital.lng)
        info.update(result)
        info["status"] = "ok"
    except (ValueError, RuntimeError, requests.RequestException, KeyError) as exc:
        info["status"] = "unavailable"
        info["error"] = str(exc)
        info["score"] = None  # 조회 실패를 0점으로 처리하지 않음
        info["score_100"] = None
    return info


@app.post("/api/route")
def route_to_selected_hospital():
    """단일 교수 카드의 병원까지 경로 조회. 임의의 목적지 좌표는 받지 않습니다."""
    body = request.get_json(silent=True) or {}
    if not isinstance(body, dict):
        return jsonify({"error": "JSON 객체 형식으로 요청해 주세요."}), 400
    try:
        lat, lng = validate_coordinates(body)
        mode = body.get("mode")
        if not isinstance(mode, str) or mode not in MODES:
            return jsonify({"error": "mode는 car, transit, walk, bike 중 하나여야 합니다."}), 400
        hospital_id = body.get("hospital_id")
        hospital = HOSPITAL_LOOKUP.get(hospital_id) if isinstance(hospital_id, str) else None
        if hospital is None:
            return jsonify({"error": "지원하지 않는 병원입니다."}), 400
        if not KAKAO_REST_KEY:
            return jsonify({"error": "서버에 KAKAO_REST_API_KEY를 설정하세요."}), 503
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    result = evaluate_one(hospital, mode, lat, lng)
    return jsonify({"mode": mode, "origin": {"lat": lat, "lng": lng},
                    "hospital": result, "score_limit_minutes": LIMIT_MINUTES})


@app.post("/api/evaluate")
def evaluate():
    body = request.get_json(silent=True) or {}
    try:
        lat, lng = validate_coordinates(body)
        mode = body.get("mode")
        if mode not in MODES:
            return jsonify({"error": "mode는 car, transit, walk, bike 중 하나여야 합니다."}), 400
        if not KAKAO_REST_KEY:
            return jsonify({"error": "서버의 .env에 REST API 키를 입력하세요."}), 503
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    with ThreadPoolExecutor(max_workers=5) as pool:
        futures = {pool.submit(evaluate_one, hospital, mode, lat, lng): hospital.id for hospital in HOSPITALS}
        results = [future.result() for future in as_completed(futures)]
    order = {h.id: idx for idx, h in enumerate(HOSPITALS)}
    results.sort(key=lambda r: (r["status"] != "ok", r.get("duration_seconds", float("inf")), order[r["id"]]))
    rank = 0
    for item in results:
        if item["status"] == "ok":
            rank += 1
            item["rank"] = rank
    return jsonify({"mode": mode, "origin": {"lat": lat, "lng": lng},
                    "score_limit_minutes": LIMIT_MINUTES, "results": results})


if __name__ == "__main__":
    # 교육용 로컬 개발 서버. 외부 공개 용도로 실행하면 안 됩니다.
    app.run(host="127.0.0.1", port=5000, debug=False)
