# mediroute
Southern_Gyeonggi_Hospital_Access

# 메디루트 — 경기 남부 대학병원 접근성 비교 (Kakao Maps API)

경기 남부 5개 대학병원에 대해 현재 위치 또는 검색한 출발지에서 **자동차/대중교통/도보/자전거** 이동 소요시간을 조회하고, 접근성 점수를 산출하는 산업공학종합설계 프로젝트용 웹앱 프로토타입입니다.

- 대상 병원: 아주대학교병원, 가톨릭대학교 성빈센트병원, 용인세브란스병원, 분당서울대학교병원, 분당차병원
- 출발지: 브라우저 GPS, Kakao 장소 검색 또는 지도 클릭
- 결과: 실제 API가 반환한 예상 이동시간(분), 거리(km), 0~100점 점수 및 5개 병원 순위
- 지도에서 병원·선택 경로 확인, 카카오맵 길찾기 페이지 연결
- 경로 미조회 시 **점수를 0으로 넣지 않고 '조회 불가'** 표시

> **중요:** 카카오 API 키가 필요합니다. 이 예제는 작성 시점의 공개 공식 API 문서에 맞춘 코드이며 실제 카카오 서버의 응답을 키로 검증한 상태는 아닙니다. 프로덕션 서비스로 바로 사용하지 마세요.

## 1. 카카오 앱 생성 및 키 발급

1. https://developers.kakao.com 에 카카오 계정으로 로그인합니다.
2. [앱] → [앱 생성]에서 앱을 등록합니다.
3. 생성한 앱에서 [카카오맵] → [사용 설정] → [상태 ON]을 선택합니다.
4. [앱] → [플랫폼 키] 메뉴에서 **JavaScript 키**와 **REST API 키**를 확인합니다.
5. JavaScript 키의 **JavaScript SDK 도메인**에 `http://localhost:5000`을 등록합니다. 필요하면 `http://127.0.0.1:5000`도 별도로 등록합니다.
6. 무료 쿼터 적용 여부를 확인합니다. 2026-07-21 이후 개발자 계정 기준 **첫 번째**로 카카오맵 API를 활성화한 앱에만 무료 쿼터가 제공되며, 이후 앱/초과 사용은 비즈월렛 및 유료 API 설정이 필요할 수 있습니다.
7. 앱의 REST API 키 설정 및 요청 허용 IP 등의 제한 설정을 확인합니다. REST 키는 타인에게 공개하거나 웹 코드에 직접 넣으면 안 됩니다.

공식 문서:
- 지도 Web SDK: https://apis.map.kakao.com/web/guide/
- Kakao Maps REST API: https://developers.kakao.com/docs/ko/kakaomap/rest-api
- Kakao Mobility 자동차 길찾기: https://developers.kakaomobility.com/guide/navi-api/directions
- 2026년 카카오맵 활성화 변경: https://devtalk.kakao.com/t/api-notice-on-new-kakao-map-api-features-and-free-quota-policy/150222

## 2. 실행 환경 설치 (Windows PowerShell 기준)

Python 3.10 이상과 VS Code가 설치되어 있어야 합니다.

폴더를 VS Code로 열고, 상단 [터미널] → [새 터미널]을 눌러 다음 명령어를 순서대로 입력합니다.

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

PowerShell에서 실행 정책 오류가 날 경우 가상환경을 활성화하지 않고도 다음과 같이 실행할 수 있습니다.

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
.\.venv\Scripts\python.exe app.py
```

macOS/Linux에서 가상환경 실행:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

## 3. API 키 등록

만든 `.env`를 VS Code에서 연 후 다음 2개 값을 실제 카카오 개발자 키로 바꿉니다.

```env
KAKAO_JAVASCRIPT_KEY=실제_JavaScript_키
KAKAO_REST_API_KEY=실제_REST_API_키
ACCESSIBILITY_LIMIT_MINUTES=120
```

**주의:** `.env` 파일을 깃허브에 올리거나 메신저로 공유하지 마세요. `.env.example`만 공유하세요. JS 키는 지도 SDK 로딩 용도로 브라우저에 보이는 것이 정상이며, 반드시 도메인을 제한해야 합니다.

## 4. 실행

```powershell
python app.py
```

(가상환경을 사용하지 않는 경우 `py app.py`)

터미널에 `Running on http://127.0.0.1:5000`가 뜨면 브라우저에 아래 주소를 입력합니다.

**http://localhost:5000**

처음 실행하면 카카오 API를 통해 병원 5개 주소를 좌표로 변환하여 표시합니다.

## 5. 실제 사용 방법

1. `내 현재 위치 사용`을 누르고 브라우저에서 위치 권한을 허용합니다. PC GPS가 부정확하거나 실패하면 `수원역`, `광교중앙역` 등을 검색하거나 지도를 클릭하세요.
2. 자동차/대중교통/도보/자전거 중 하나를 선택합니다.
3. `5개 병원 접근성 비교`를 누릅니다.
4. 모든 병원에 대해 실제 길찾기 API를 호출하고, 예상 이동시간·거리·점수를 계산합니다.
5. 결과 목록에서 병원을 누르면 지도에 경로가 표시됩니다. `카카오맵에서 길찾기 보기` 링크도 이용할 수 있습니다.

> 위치 권한은 일반적으로 **HTTPS 또는 localhost**에서만 동작합니다. 휴대폰에서 LAN의 `http://192.168...` 주소로 접속하면 현재 위치 기능이 제한될 수 있습니다. 또한 이 샘플 서버는 127.0.0.1로 바인딩되어 있어 PC 자체에서만 열 수 있습니다.

## 6. 접근성 점수 계산

```text
이동시간 t (분)
접근성 점수 (0~1) = max(0, 1 − t / 120)
화면 표시 점수 = 접근성 점수 × 100
```

예) 30분→75점, 60분→50점, 90분→25점, 120분 이상→0점. 120분은 **연구용 임시 가정**입니다. 팀의 실험 설계에 맞게 `.env`에서 변경할 수 있습니다. 모든 병원 및 선택한 교통수단에 **같은 기준시간**을 적용합니다.

시간 출처:
- 자동차: Kakao Mobility `routes[0].summary.duration` (초)
- 대중교통: Kakao Maps `routes[].properties.totalTime` (초) 중 최소
- 도보/자전거: Kakao Maps `route.properties.totalTime` (초)

API 경로 데이터는 전체 경로의 일부가 생략되거나 반환되지 않을 수 있습니다. 그 경우 지도에 경로 선이 나타나지 않을 수 있으나, 소요시간 점수는 경로시간이 정상 반환된 경우 계산됩니다.

## 7. 실행 오류가 날 때

| 현상 | 해결 |
| --- | --- |
| 지도 대신 오류 메시지 표시 | JavaScript 키·JS SDK 도메인(`http://localhost:5000`)·카카오맵 활성화 여부 확인 |
| `Kakao API HTTP 401` | REST API 키 오입력 또는 키 제한 설정 확인 |
| `403` | 해당 API 사용 권한, 활성화, REST 키 허용 IP 정책 확인 |
| `429` | 일일 무료 쿼터 소진 또는 호출 제한. 카카오 통계 확인 |
| GPS 위치 오류 | 브라우저 위치 권한 허용, localhost 접속, 지도 클릭/장소 검색 사용 |
| 도보/자전거 `TOO_FAR_AWAY` 등 | 장거리 경로 제한 또는 실제 연결 가능한 경로 없음. 해당 병원은 조회 불가로 표시 |
| 대중교통 경로 없음 | 해당 출발지/목적지에서 경로가 제공되지 않거나 조건에 맞는 경로가 없음 |
| 병원 주소 조회 실패 | REST 키/지도 API 활성화 확인. `app.py` 내 병원 주소가 정확한지 확인 |

## 8. 파일 설명

```text
hospital-access-kakao/
├── app.py                  # Flask API 서버, 카카오 REST 호출 및 점수 계산
├── .env.example            # 키 입력 예시(실제 키 저장 금지)
├── .gitignore              # 비밀 키/가상환경 업로드 제외
├── requirements.txt        # Python 패키지
├── templates/index.html    # 사용자 화면
├── static/style.css        # 앱 스타일
├── static/app.js           # 지도·교통수단·경로 선택 기능
└── tests/test_app.py       # 점수 계산 및 응답 파싱 단위 테스트
```

## 9. 단위 테스트

```powershell
python -m unittest discover -s tests -v
```

실제 카카오 서비스/API를 대상으로 한 통합 테스트는 **카카오 키를 등록하고 호출해 봐야** 확인할 수 있습니다.

## 확장 과제

- 실제 병원 **출입구/주차장/대중교통 승하차 지점** 좌표로 목적지 개선
- 대중교통 탑승 가능 시간, 배차 간격, 도보 구간, 환승 수 분석
- 이동 약자 전용 옵션(휠체어 접근 가능 경로 등)은 검증된 별도 데이터 확보 후 구현
- 시간대별 도착 예상시각 및 실시간 대중교통 정보 연동
- 다른 팀원이 만든 최종 전문성·신속성 평가와 `score` 값을 결합
- 경로/위치 정보 보관 필요 시 사용자 동의 및 최소 수집 설계

## API 사용량

사용자가 교통수단 1개로 5개 병원을 비교할 때 원칙적으로 **병원별 API 경로 조회 5건**이 발생합니다. 이 앱에는 2분 메모리 캐시가 있으므로 같은 위치에서 재조회하면 일부 호출은 생략될 수 있습니다. 카카오에서 안내하는 일별 무료 쿼터와 과금 정책을 확인하세요.
