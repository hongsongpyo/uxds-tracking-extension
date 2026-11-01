# 통합 및 검증 보고 (2026-10-18)

## 출처
1. `ux-extension-logger 복사본 3.zip` — UXDS Project ID 연결, Supabase `validate-project`, `ingest-mouse-events`, 마우스/클릭/스크롤/탭/페이지 이벤트, 버퍼 및 재전송 정책.
2. `eye-tracker-source-20261015-1640(4).zip` — MediaPipe/WebEyeTrack/L2CS, Face Positioning, Calibration, Independent Validation, Quick Recalibration, AOI, Fixation, IndexedDB, CSV/JSON Export, MV3 Background/Offscreen 구조.
3. `eye-tracker-accuracy-upgrade(2).zip` — 22개 파일을 원본 Eye 소스 및 테스트에 적용. 수정된 파일(서비스워커 포함)은 통합 브리지에 맞게 추가 편집. 원본 패치에 포함된 `quickRecalibrationTransaction`, `calibrationTargetGroups`, `runtimeDeepSourceAlignment` 등 테스트 파일도 그대로 보존.

## 적용 흐름 및 계약
- `Project ID` 검증 및 연결: 기존 UXDS API 스펙 보존, 형식 `prj_` + 12자리 hex.
- UI에서 통합 수집 시작을 누르면 **armed** 상태만 먼저 저장, Eye Tracker 초기화/카메라/Face Positioning으로 진행.
- 보정·독립 검증 후 Eye 상태가 READY에 도달해야 통합 `UXDS_MOUSE_START`를 발행. 그전에는 Mouse Content Script의 `isTracking=false`.
- 기존 Eye `sessionManager`가 발급한 `sessionId`를 Mouse/Upload에 재사용; 독자적인 마우스 세션을 만들지 않음.
- `pageId`가 바뀌면 Mouse에 `UXDS_MOUSE_PAGE_CHANGED` 전송. SPA/탭 탐색 지원, 기본 새 탭 복원 기존 코드 유지.
- Eye AOI_HIT gaze sample을 동일 시간축의 `gaze` 타입 API payload로 변환하여 로컬 지속 전송 대기열에 저장. 실제 Eye IndexedDB 기록은 그대로 유지.
- Mouse 기존 수집 데이터는 기존 `page_events`; Eye는 신규 `uxds_eye_events`로 분리하여 기존 대시보드 호환성을 보존.
- 개발용 `chrome.runtime.onMessage` 중복 수신 충돌 방지를 위해 Mouse Content Script는 `UXDS_*` 전용 메시지에만 응답.
- 통신 중단 시 캘리브레이션 전에 프로젝트를 검증했으면 검증 완료 직후 서버 재검증 없이 수집 시작 가능, outbox 재시도 처리.

## 실행 검증 (실측/모의 구분)
| 항목 | 상태 | 범위 |
|---|---|---|
| Node 브리지 모의 단위/통합 테스트 | PASS | 프로젝트 검증·무장·검증 후 활성화·공유 세션/페이지·시선 배치 업로드·중지·비대상 탭 거절·네트워크 오류 대기열 복구 (6개) |
| Manifest/메시지/배치 정적 연결 검사 | PASS | `npm run verify:integration` 12개 검사 |
| TypeScript 구문 변환 | PASS | 글로벌 TS Compiler를 이용한 `.ts` 113개 구문 파싱 (타입 검사 아님) |
| JavaScript 구문 검사 | PASS | `node --check` 2개 통합 JS |
| `npm ci` | BLOCKED | 외부 npm 네트워크 접근 불가, 오프라인 npm cache 일부 패키지 없음 |
| `npm run typecheck` | NOT RUN TO COMPLETION | `@types/chrome` 의존성 부재 |
| `npm run lint`, `npm test`, `npm run build` | NOT VERIFIED | npm 의존성 및 필수 대용량 모델/wasm 누락 |
| 실제 Chrome/웹캠 독립 검증 | NOT VERIFIED | 사용자 카메라/실행 환경 미접근 |
| Supabase migration/Edge Function 배포, UXDS 웹 대시보드 반영 | NOT VERIFIED / NOT INCLUDED | DB 배포 권한 없음, 웹 대시보드 소스 미제공 |

## 누락된 입력과 해소 방식
세 ZIP에는 `face_landmarker.task`, MediaPipe WASM `.wasm`, WebEyeTrack weight `.bin`, ONNX Runtime WASM `.wasm`, L2CS Gaze360 `.onnx`와 원본 `.pkl`이 모두 존재하지 않습니다. 임의 바이너리/가짜 모델은 넣지 않았습니다. `scripts/prepare-unified-extension.sh`에 npm 설치, MediaPipe+WebEyeTrack+ONNX vendor 다운로드/검증, 공식 L2CS 체크포인트 → ONNX 변환, TS·Lint·Vitest·Build를 연결했습니다. 모든 모델과 라이선스를 확보해야 실제 dist 빌드 가능.

## 보안/운영 상 주의
- UXDS 기존 mouse API가 Project ID만 검증하는 방식이므로 새 Eye API도 데모 호환을 위해 해당 인증 수준을 따릅니다. 외부 배포 시 project-scoped 토큰 인증과 업로드 제한, 명시적인 참가자 동의가 필요합니다.
- 기존 UXDS React 웹사이트 소스가 제공되지 않아 화면 차트/히트맵 등은 직접 수정하지 못했습니다. 서버 측 조회 예시 `integration/uxds-dashboard-query.ts`를 제공했습니다.
- 결과 ZIP은 **전체 통합 소스**이며, 즉시 설치 가능한 `dist` 번들이 아닙니다. 실사용 전 로컬 빌드가 필요합니다.
- 정확도 패치 적용은 코드 수준으로 확인했습니다. 실제 mean/P95/region hit 및 여러 사용자·카메라 성능 향상을 보장하거나 계측했다고 주장하지 않습니다.
