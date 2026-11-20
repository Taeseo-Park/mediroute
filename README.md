# 메디루트 | 3단계 진료 교수 추천 · 병원 길찾기

경기 남부 5개 대학병원 대상 산업공학종합설계 **시연용 프로토타입**입니다.

## 변경된 사용자 흐름

1. **진료 분야 선택**: 진료과 → 부위/분야 → 세부 증상 선택.
2. **추천 교수 결과**: 진료 전문성(0.8×진료적합성 + 0.2×경력점수) 높은 순으로 가상 교수 카드 표시. 각 카드에 **길찾기** 버튼. 위치 권한을 허용한 경우 출발지와 병원 대표점의 **직선거리** 표시.
3. **병원 길찾기**: 카드의 교수 소속 병원으로 목적지 고정. 내 현재 위치·장소 검색·지도 클릭으로 출발지 선택 → 자동차/대중교통/도보/자전거 선택 → API 경로 소요시간·이동거리 및 접근성 점수 조회. 별도의 카카오맵으로 열기도 가능.

현재 **예약하기 버튼을 구현하지 않았습니다.** 교수/진료적합성/경력 데이터는 `data/mock_professors.json`의 가상 테스트 값입니다. 실제 임상 적합성을 주장하지 않습니다.

## VS Code 기존 `mediroute-clean` 프로젝트에 업데이트

**업데이트 전 기존 폴더를 백업하세요.** 다운로드한 `mediroute-three-step-update.zip` 압축을 해제한 뒤, 압축 속 파일/폴더를 아래 폴더에 합쳐 복사합니다.

```text
C:\Users\subak\mediroute-clean\
├── .env                  ← 유지 (덮어쓰거나 GitHub에 업로드 금지)
├── .venv/                ← 유지
├── .git/                 ← 유지
├── .gitignore
├── app.py                ← 업데이트
├── recommendations.py   ← 기존 DB 연동 지점 유지
├── specialties.py       ← 새 파일
├── data/
│   └── mock_professors.json
├── templates/
│   └── index.html       ← 업데이트
├── static/
│   ├── app.js           ← 업데이트
│   └── style.css        ← 업데이트
├── tests/
│   └── test_app.py
└── requirements.txt
```

`.env`, `.venv/`, `.git/`는 **복사/덮어쓰기/삭제하지 않습니다.** 업데이트 압축에는 이 3개가 포함되지 않습니다.

### 1. 로컬 실행

PowerShell에서 `mediroute-clean` 폴더를 열고:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
.\.venv\Scripts\python.exe app.py
```

브라우저: <http://localhost:5000>

`requirements.txt`가 이미 설치되어 있다면 첫 명령어는 생략 가능합니다. PowerShell 활성화 스크립트를 실행할 필요 없이 `.venv`의 Python을 직접 사용합니다.

### 2. 카카오 키 설정

로컬 `.env` (기존 값을 유지하거나 유효한 키로 설정):

```env
KAKAO_JAVASCRIPT_KEY=발급받은_JavaScript_키
KAKAO_REST_API_KEY=발급받은_REST_API_키
ACCESSIBILITY_LIMIT_MINUTES=180
```

서버의 REST 키는 HTML/JavaScript에 노출하지 않습니다. 카카오 개발자센터의 JavaScript SDK 허용 도메인에 로컬 URL과 Render URL이 모두 등록되어야 지도 표시가 됩니다. 키 없이도 진료 분야 선택 및 가상 교수 목록은 확인할 수 있지만 장소 검색/실제 경로·지도는 제한됩니다.

### 3. 실제 화면 확인 순서

1. 진료과 `정형외과` → 부위 `무릎` → 세부 항목을 하나 선택 → `추천 교수 보기`.
2. `가상 교수 A`의 `길찾기` → **아주대학교병원**이 도착지로 고정되는지 확인.
3. `내 현재 위치 사용` 또는 `수원역` 장소 검색 → 자동차/대중교통/도보/자전거 선택 → `경로·이동시간 확인`.
4. 경로 결과의 예상 시간, **실제 이동거리**, 접근성 점수(`180`분 기준)를 확인.
5. `추천 교수 목록으로` → 다른 교수의 `길찾기`를 눌러 도착지가 바뀌는지 확인.

**주의:** 추천 카드의 `직선거리`와 길찾기 화면의 `실제 이동거리`는 서로 다른 수치입니다. 거리 표시는 위치 허용 또는 출발지 입력이 있을 때만 제공하며, 값을 모를 때 임의로 채우지 않습니다.

## GitHub → Render 자동 반영

1. VS Code에서 `Ctrl + Shift + G` → 변경 파일 Stage → Commit → Sync Changes(Push).
2. Render의 Auto-Deploy가 `On Commit`이고 연결 브랜치가 `main`이라면 자동 배포됩니다.
3. 이번 기능 변경만으로 **Render Environment 값을 바꿀 필요는 없습니다.** 신규 키/기준시간을 바꿀 경우에만 Environment를 수정합니다.
4. 배포 사이트 접속 후 강력 새로고침(`Ctrl + Shift + R`).

## 백엔드 API / DB 연결

| HTTP | 경로 | 기능 |
|---|---|---|
| GET | `/api/specialties` | 진료과/부위/세부 질환 UI 옵션 |
| GET | `/api/recommendations?department=정형외과&condition=무릎` | 전문성순 가상 교수 목록 |
| GET | `/api/hospitals` | 고정된 5개 병원 위도·경도 |
| GET | `/api/search?q=수원역` | 카카오 장소 검색 |
| POST | `/api/route` | **선택한 병원 한 곳의 경로** 조회 |
| POST | `/api/evaluate` | 이전 5개 병원 비교 API (호환성 유지) |

`POST /api/route` 요청 예시:

```json
{"hospital_id":"ajou","lat":37.25,"lng":127.05,"mode":"car"}
```

`hospital_id`만으로 목적지를 결정하므로 프런트에서 임의 병원 좌표를 보내지 않습니다. `app.py`의 `HOSPITALS`에 기존의 고정 좌표 5개를 사용합니다. 실제 병원 출입구로 확인·보정한 뒤 운영할 것을 권장합니다.

실제 교수 DB 연동 시 `recommendations.py`의 `load_professors()`를 DB 질의로 교체하세요. 필요한 필드는 기존 파일 주석에 기록돼 있습니다. `specialties.py`의 세부 질환 입력은 현재 UI 시연용이며, 진료적합도 점수는 **부위/분야 단위**의 가상 값입니다. 질환 단위 정확도를 주장하려면 DB에 진료 분야별 상세 매핑을 구현해야 합니다.

## 확인 및 제약

- Python 및 JavaScript 구문 검사, 카탈로그·추천 순위 정렬, 목업 API를 사용한 3화면 브라우저 테스트를 실시했습니다.
- 실제 API 키가 없으므로 **카카오 SDK 지도, 길찾기 REST API 실호출, Render 통합 배포**는 사용자 환경에서 추가 검증해야 합니다.
- 위치 정보는 파일/DB에 저장하지 않고, 경로 조회 시에만 서버로 전송합니다. 프로덕션 운영 시 로그/보존 정책도 검토해 주세요.
- 연구용 접근성 점수: `max(0, 1 - 이동시간(분)/180)`; 카드 UI에서 100배 점수로 표시.
