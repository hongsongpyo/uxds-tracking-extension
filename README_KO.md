# UXDS 통합 Eye + Mouse Chrome Extension

## 목표·수집 흐름

이 폴더는 **마우스 트래커 + 웹캠 아이트래커 + 2026-10-15 정확도 개선 패치**를 하나로 통합한 **Manifest V3 / TypeScript 소스코드**입니다. `prj_`로 시작하는 16자리 Project ID를 연결한 뒤 수집을 시작합니다.

`프로젝트 연결 → 수집 시작(실험할 HTTPS 탭) → 카메라 권한 → 얼굴 위치 확인 → 17/25점 시선 캘리브레이션 → 독립 검증 → 시선·마우스 동시 수집 → 수집 중지`.

**검증을 끝내기 전에는 UXDS 마우스 이벤트를 기록하지 않습니다.** GOOD/ACCEPTABLE 시 수집하며, 기존 Eye 엔진이 허용하는 POOR 검증은 `degraded_collection=true`로 명시하여 정확도를 과장하지 않습니다. 검증에 실패해 READY에 도달하지 못하면 마우스 수집도 시작하지 않습니다. 추적 중 Quick Recalibration은 기존 정확도 패치의 상태·모델 복구 로직을 유지합니다.

두 데이터 흐름은 **같은 `session_id`**를 사용하며, 웹 탐색 단위도 Eye의 `pageId`를 기준으로 마우스 `page_view_id`와 연계합니다. 마우스는 기존 `public.mouse_tracking_events`, Eye는 신설 `public.uxds_eye_events`에 저장합니다. Eye API는 `projects.public_id`(확장 입력값)를 `projects.id`(UUID)로 변환하여 저장합니다. 같은 `projects.id + session_id`로 합치며, 시간은 클라이언트 Unix epoch milliseconds 기준입니다. Eye 오리지널 실험 기록(품질·AOI·캘리브레이션·fixation 등)은 기존 IndexedDB에도 저장됩니다. 녹화한 원본 웹캠 영상/눈 이미지는 서버로 보내지 않습니다.

## 1. 로컬 환경·빌드 (macOS 터미널)

Node.js 22.x, npm, Python 3, Chrome이 필요합니다. Deep 모델을 사용할 경우 **합법적으로 확보한 공식 L2CSNet Gaze360 `.pkl` 체크포인트**와 Python torch/torchvision/onnx가 필요합니다. 이 체크포인트는 세 ZIP 안에 없습니다. 연구용 데이터셋/모델의 라이선스를 반드시 확인하세요.

```bash
# nvm이 없는 경우 먼저 https://github.com/nvm-sh/nvm 참고
nvm install 22
nvm use 22

# ZIP을 풀고, manifest.json과 package.json이 있는 폴더로 이동
cd ~/Documents/GitHub/UXDS_Eye_Mouse_Integrated_Source

python3 -m venv .venv_l2cs_export
source .venv_l2cs_export/bin/activate
pip install torch torchvision onnx

# 공식 체크포인트를 직접 준비했을 때만 지정 (실제 경로로 변경)
export L2CS_CHECKPOINT="$HOME/Downloads/L2CSNet_gaze360.pkl"

# npm 설치, MediaPipe/WebEyeTrack/ONNX 로컬 자산 준비,
# L2CS 변환 및 검증, typecheck, lint, 테스트, dist 빌드를 한 번에 실행
bash scripts/prepare-unified-extension.sh
```

공식 체크포인트 없이 실행하면 스크립트는 해당 항목에서 의도적으로 중단됩니다. **빈 모델 파일이나 임의 모델을 넣어 우회하지 마세요.** 세 ZIP에 누락된 `face_landmarker.task`, MediaPipe WASM, WebEyeTrack weights, ONNX Runtime WASM은 위 설정 스크립트가 온라인에서 버전 고정 자산으로 준비하도록 구성했습니다. 인터넷이 필요하며, 설치 후 추론은 로컬에서 실행됩니다.

정밀 모델 체크포인트를 준비하기 전 단계에서도 `npm run test:uxds`와 `npm run verify:integration`을 실행하여 통합 로직을 확인할 수 있습니다. `npm run verify:integration`은 파일이 없는 경우 `MISSING`이라고 정확히 표시합니다.

완성된 **`dist/` 폴더**를 Chrome 주소창의 `chrome://extensions` → 개발자 모드 → `압축해제된 확장 프로그램을 로드합니다`에서 선택하세요. **이 ZIP 자체는 `dist/`가 아니라 소스 묶음**입니다. Chrome 설치 후 추적할 실험 사이트 탭을 새로고침하세요.

## 2. UXDS Supabase 서버 적용

기존 UXDS 프로젝트가 실제 사용하는 Supabase 프로젝트에 migration과 새 Edge Function을 배포해야 시선 데이터가 서버에 저장됩니다. 단순 Chrome 확장 설치만으로 서버 DB 테이블이 자동 생성되지는 않습니다. 아래 URL/키는 제공된 마우스 ZIP의 기존 UXDS 설정을 그대로 사용합니다. 다른 프로젝트를 사용할 경우 `src/background/uxdsMouseBridge.js`의 `UXDS_CONFIG`를 수정하세요.

```bash
# Supabase CLI를 사용할 수 있는 환경에서 실행
npx supabase login
npx supabase link --project-ref exburxzvshqhhqbmhesr
npx supabase db push
npx supabase functions deploy ingest-eye-events --project-ref exburxzvshqhhqbmhesr
```

`supabase db push`는 연결된 프로젝트의 전체 로컬 migration을 적용합니다. **프로덕션 DB에서는 백업 후 SQL 변경 사항을 사전 확인**하세요. 이 ZIP에는 Eye 테이블 migration 하나만 포함되며 기존 UXDS `projects`, `mouse_tracking_events`, `validate-project`, `ingest-mouse-events`가 이미 있어야 합니다. `public.uxds_eye_events`가 이미 존재하면 해당 생성 SQL을 다시 실행할 필요는 없습니다. 이번 패치에서는 Edge Function만 재배포하면 됩니다. 환경 변수 `SUPABASE_URL`과 `SUPABASE_SERVICE_ROLE_KEY`는 **Supabase Edge Function 서버**에만 둡니다. Chrome에 서비스 역할 키를 넣으면 안 됩니다.

Supabase SQL Editor로 직접 진행한다면 `supabase/migrations/20261018_uxds_eye_events.sql`을 실행하고, `supabase/functions/ingest-eye-events/index.ts`를 Edge Function으로 배포하세요. `supabase/config.toml`은 프로젝트 ID만 연결하는 **기존 UXDS 공개 API 방식**과 호환되도록 JWT 검증을 끈 테스트용 구성입니다. **Project ID만 아는 사용자가 데이터를 업로드할 위험**이 있습니다. 실제 외부 참가자 연구·상용 배포 전에 프로젝트별 단기 권한 토큰, 사용자 동의, 남용·속도 제한 및 서버 측 권한 검증을 반드시 추가해야 합니다. 현재 구성은 안전한 프로덕션 인증 체계의 대체물이 아닙니다.

## 3. 기존 UXDS 웹 대시보드 연결

**기존 React/Vite UXDS 웹사이트의 소스가 이번 세 ZIP에 포함되지 않았으므로 웹 대시보드 코드는 수정하지 않았습니다.** 데이터베이스에 저장된 Eye 이벤트를 프로젝트별로 불러오는 서버 측 연동 예제는 `integration/uxds-dashboard-query.ts`에 있습니다. 인증된 서버 또는 프로젝트 소유자 RLS 정책을 통해 아래 쿼리와 같은 동작을 연결하면 됩니다.

```sql
-- 예시: public_id로 프로젝트를 지정하지만 저장 시 내부 UUID를 사용
select e.project_id, p.public_id, e.session_id, e.page_id,
       e.occurred_at, e.x, e.y, e.gaze_quality, e.primary_aoi_id
from public.uxds_eye_events e
join public.projects p on e.project_id = p.id::text
where p.public_id = 'prj_012345abcdef'
order by e.occurred_at;

-- 마우스는 원래 UUID로 저장됨
select m.project_id, m.session_id, m.page_view_id, m.occurred_at,
       m.event_type, m.x, m.y
from public.mouse_tracking_events m
join public.projects p on m.project_id = p.id
where p.public_id = 'prj_012345abcdef'
order by m.occurred_at;
```

시선 테이블의 `anon/authenticated` 권한은 기본 차단되어 있습니다. 서비스 역할 인증이 있는 **서버 쪽**에서 조회하거나, 소유자만 읽을 수 있는 RLS 정책을 직접 추가하세요. 클라이언트에 서비스 역할 키를 노출하면 안 됩니다.

## 4. 테스트와 파일 안내

```bash
npm run test:uxds              # Node 모의 Chrome/Supabase 통합 흐름
npm run verify:integration     # 아키텍처 연결과 필수 바이너리 존재 여부
npm run typecheck              # TypeScript strict
npm run lint                   # ESLint
npm test                       # 기존 Vitest + 정확도 패치 테스트
npm run build                  # 실제 로컬 자산 준비 후 최종 dist
```

주요 파일: `src/background/uxdsMouseBridge.js`(프로젝트/전송/세션), `src/uxds/mouseContent.js`(마우스/스크롤/클릭), `src/background/serviceWorker.ts`(검증 후 통합 시작), `src/popup/popup.*`(UXDS UI), `src/offscreen`/`src/calibration`/`src/gaze`(정확도 개선), `supabase/*`(신설 서버), `integration/*`(연동 예시/테스트), `PROVENANCE.json`(원본 및 변경 해시), `MERGE_REPORT.md`(검증 보고).

## 5. 알려진 미검증 항목

이 제작 환경은 npm 레지스트리 접근이 차단되어 의존성 설치를 완료하지 못했습니다. 세 ZIP에 없는 딥 모델 체크포인트 및 일부 로컬 실행 바이너리는 임의로 보충하지 않았습니다. 따라서 이 환경에서 `npm run typecheck`, `npm run lint`, 전체 Vitest, `npm run build`, 실제 웹캠/Chrome 설치 및 Supabase 배포 성공은 **검증되지 않았습니다**. 통합 로직의 Node 모의 테스트와 TypeScript 구문 파싱은 별도로 확인했습니다. 실험 시작 전 사용자 PC에서 완전 빌드와 독립 검증 지표, 실제 업로드를 반드시 시험하세요.

## 6. 실제 DB 프로젝트 매핑 패치 (2026-10-19)

`EYE_PROJECT_UUID_MAPPING_FIX_KO.md` 참고. 이미 시선 테이블이 있다면 SQL은 실행하지 않고 `ingest-eye-events`만 재배포하면 됩니다. 이 패치는 기존 `gaze_tracking_events` 테이블에 자동으로 쓰지 않으며, 기존 웹 대시보드의 시선 화면도 별도 연결이 필요합니다.
