# UXDS Eye + Mouse — 중지 후 재시작 안정화 검사 (2026-10-18)

## 제공 로그에서 사실로 확인된 상태

- `Experiment session ended`, `Tab associations cleared`, `Offscreen Document closed`, `Tracker hard-reset to IDLE`가 모두 기록되어 기존 실험 세션과 Offscreen이 일단 종료된 것으로 확인됩니다.
- 그 이후 `Experiment session started`, `Camera started`, MediaPipe, WebEyeTrack, L2CS 초기화, `Calibration UI started after pre-calibration completion`이 확인됩니다.
- 첫 세 개의 보정 지점은 READY였습니다. 4번은 한 번 `TIMED_OUT accepted=0` 후 재측정 READY, 5번은 `TIMED_OUT accepted=4` 후 READY였습니다.
- 5번 보정 중간에 `Tracked tab committed a new document`가 확인됩니다. 이 뒤에는 점 6, 검증, RECORDING 또는 서버 수집 확인 로그가 없습니다.
- 따라서 **전체 보정 완료, 검증 통과, 마우스/시선 실수집 성공은 아직 확인 불가**입니다. 로그만으로 초기화 자체가 실패했다고 말할 수도 없습니다.

## 소스에서 확인한 위험 지점과 수정

1. `serviceWorker.ts`: 보정 메시지를 재전달할 때마다 `executeScript()`로 eye + mouse Content Script를 둘 다 재주입했습니다. 이미 설치된 스크립트에 다시 주입하면 이벤트 리스너·타이머와 측정 상태가 복제될 수 있습니다. 이제 Eye의 기존 버전 프로토콜 PING/PONG 및 Mouse의 기존 UXDS_PING으로 활성 리스너를 먼저 확인한 뒤 **부재한 스크립트만 최상위 프레임에 한 번 주입**합니다.
2. `serviceWorker.ts`: 보정 중 `onCommitted`가 발생해도 `transitionType === 'reload'`가 아닌 일반 문서 이동은 보정 재시작에서 빠졌습니다. 지금은 **새 최상위 문서로 실제 전환되면 준비/보정/검증(READY 포함) 흐름을 얼굴 위치 확인부터 다시 시작**하며, RECORDING에서는 기존 세션의 페이지 이동 처리만 유지합니다.
3. `serviceWorker.ts`: Hard reset이 보류 중인 보정 UI 확인 요청 및 재시도 냉각 상태를 정리하지 않았습니다. 초기화 시 오래된 확인 대기자/재시도 타이머 상태를 무효화합니다.
4. `contentScript.ts`: 이미 활성화된 스크립트가 PING에 PONG을 반환해 Background가 존재를 확인할 수 있도록 변경했습니다. 기존 보정·검증·정확도 모델 로직은 유지합니다.
5. `popup.ts`: `수집 시작`에서 이전 세션 초기화 실패를 `.catch(() => undefined)`로 무시한 뒤 진행하는 경로를 수정했습니다. 실제 IDLE을 확인하지 못하면 새 수집을 진행하지 않습니다.

## 실행 검증

- Node 기본 테스트 `node --test integration/tests/bridge.test.mjs`: 6 passed, 0 failed
- `node scripts/check-restart-fix.mjs`: TS 3개 구문 파싱, 주입 모의검사 4가지, 재시작 코드 불변 조건 검사 통과
- 이번 작업 환경은 npm dev dependencies 실행 파일 부재로 실제 `tsc --noEmit`, `eslint`, `vitest`, `esbuild` 전체 실행을 확인하지 못했습니다. 사용자 기기에서 반드시 검사하세요.
- 실제 Chrome에서 중지→시작→25점 보정→독립 검증→RECORDING 및 UXDS 업로드까지 테스트하지 못했습니다.

## 적용 / 재검증

```bash
cd ~/Documents/GitHub/UXDS_Eye_Mouse_Integrated_Source
unzip -o ~/Downloads/UXDS_Stop_Start_Restart_Stability_Fix_20261018.zip -d .
nvm use 22
npm run typecheck && npm run lint && npm test && npm run test:uxds && npm run build
```

이후 `chrome://extensions`에서 **해당 확장 프로그램 재로드** → **실험 탭 새로고침** → 팝업 `프로젝트 연결` 확인 → `수집 시작`. 보정 중에는 새 문서로 이동하지 마세요. 멈추고 다시 시작할 때는 `수집 중지` 후 `수집 시작`을 누르되 팝업에서 오류가 있는지 확인하세요. 기존 `public/models/l2cs/*.onnx` 체크포인트를 재변환할 필요는 없습니다.

## 관찰할 중요한 로그

- 기존 세션 중지: `Experiment session ended`, `Offscreen Document closed for tracker reset`, `Tracker hard-reset to IDLE`
- 새 세션: `Experiment session started`, `Camera started`, `Calibration UI started after pre-calibration completion`
- 전체 25점 완료, independent validation 완료와 품질, RECORDING 시작, UXDS mouse + gaze 업로드 성공 여부는 **새 로그에서 별도 확인 필요**.

사용자 `uxds 5` 웹사이트의 소스나 Supabase 설정은 수정하지 않았습니다.
