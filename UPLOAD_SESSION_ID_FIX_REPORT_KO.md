# UXDS 400 Invalid session ID 수정 보고서 (2026-10-19)

## 실제 로그 원인

`uxdsMouseBridge.js`가 `ingest-mouse-events`에 요청할 때 HTTP 400 `Invalid session ID.`를 반복 반환받았습니다.

- 원래 마우스 확장 프로그램의 Session ID: `session_<13자리 timestamp>_<8자리 base36>`.
- 통합 확장 프로그램의 Session ID: `session_<UUID>` (아이트래커 `createSessionId()`).
- 서버로 실제 보낸 세션 ID는 통합 확장 프로그램의 `session_<UUID>`이므로 기존 마우스 API에서 거절될 수 있습니다.
- 실제 Edge Function `ingest-mouse-events`의 구현은 이 ZIP에 없으므로 세부 검증식은 **원본 마우스 트래커 생성 규칙과 HTTP 400 오류를 바탕으로 추론**한 것입니다. 완전한 서버 호환성은 배포 후 확인 필요.

## 변경

1. `src/shared/utils.ts`: 신규 시선 세션과 페이지 ID를 원본 마우스 트래커 생성 형식으로 발급 (`session_<timestamp>_<8chars>`, `pv_<timestamp>_<8chars>`). 기존 ID 관계/세션 관리 구조는 유지.
2. `src/background/uxdsServerIds.js`: 정규식, 포맷 발급 도우미, 업로드 이벤트 변환.
3. `src/background/uxdsMouseBridge.js`: 모든 마우스/시선 배치 전송에 **공통 업로드 세션 ID**를 사용. 이전 `session_<UUID>`/`page_<UUID>` 배치에는 로컬 저장소에 **영속적인 ID 별칭** (`uxdsUploadIdAliasesV1`)을 기록하여 재전송 중에도 같은 서버 ID를 사용. 기존 큐/원본 이벤트/이벤트 ID를 수정하거나 폐기하지 않음.
4. `integration/tests/bridge.test.mjs`: 원본 서버의 형식 거부를 흉내낸 검사 추가. 새 형식 전송/이전 큐 마이그레이션/시선·마우스 동일 ID/HTTP 실패 시 outbox 보존 검사.

## 테스트

- `node --test integration/tests/bridge.test.mjs`: 8 통과 / 0 실패.
- `node --check src/background/uxdsMouseBridge.js` / `node --check src/background/uxdsServerIds.js`: 통과.
- `node scripts/verify-integration.mjs`: 12개 소스 정적 검사 통과, **5개 대용량 모델/WASM 자산 없음** (원본 소스 ZIP에서도 제외되어 있으며 사용자 컴퓨터에 이미 설치된 경우 보존해야 함).
- `npm ci`: 이 실행 환경에서 네트워크 연결/응답 시간 초과로 실패. 따라서 전체 `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`는 실제 통과 여부를 사용자 컴퓨터에서 확인해야 함.

## 사용자 적용

기존 프로젝트 폴더에서 최소 패치를 풀고 빌드하는 것이 안전합니다. 전체 소스 ZIP을 기존 폴더에 통째로 덮으면 이미 변환한 95 MB ONNX 파일이나 사용자 맞춤 CSS를 덮거나 누락시킬 수 있습니다.

```bash
cd ~/Documents/GitHub/UXDS_Eye_Mouse_Integrated_Source
unzip -o ~/Downloads/UXDS_Upload_Invalid_Session_ID_Fix_20261019.zip -d .
nvm use 22
npm run typecheck && npm run lint && npm test && npm run test:uxds && npm run build
```

확장 프로그램과 **실험 페이지를 모두 새로고침**하고 재시도합니다. 보관된 outbox는 `chrome.storage.local`에 남아 있어 새 확장 프로그램 프로세스에서 재전송할 수 있습니다. 확장 프로그램을 Chrome에서 **삭제 후 재설치하면 로컬 저장소가 삭제될 수 있으므로**, 제거하지 말고 Reload만 할 것.

## 잔여 검증

- 새 수집에서 HTTP 400 `Invalid session ID.` 오류가 더 이상 발생하지 않는지 확인.
- 백로그 마우스/시선 이벤트 수가 줄어드는지 확인.
- 다른 400(예: 이벤트 필드/페이지 ID)로 바뀌면 `ingest-mouse-events` 서버 함수를 실제로 확인할 것. **서버의 형식 검증을 무조건 완화하지 않음.**
- 이 오류 수정은 독립 시선 검증 결과 `POOR` 자체를 개선하지 않음. 품질 경고는 별개 이슈.
