# UXDS Eye + Mouse — 캘리브레이션 시작 반복 수정

## 사용자 로그에서 확인한 사실
- 카메라와 MediaPipe, WebEyeTrack, L2CS ONNX inference session 초기화 성공.
- FACE_POSITIONING 이후 CALIBRATING으로 진입했으나 `Calibration runtime started`가 서로 다른 calibrationId로 반복.
- `Calibration UI started after pre-calibration completion.` 성공 로그가 확인되지 않음.
- 따라서 모델 로딩보다 `BACKGROUND` → `CONTENT` 보정 화면 시작 전달 및 확인 절차를 우선 조사.

## 원인 및 수정
기존 `src/content/contentScript.ts`의 `START_CALIBRATION` 처리기는 메시지를 받은 후 보정 루틴을 시작하지만 `sendResponse`를 호출하지 않았습니다. `src/background/serviceWorker.ts`는 `chrome.tabs.sendMessage()`의 반환을 기다리고 있었고, 응답 채널이 정상 완료되지 않는 환경에서는 송신 실패로 처리되어 FACE_POSITIONING으로 돌아갈 수 있었습니다. 이후 얼굴 위치 READY가 지속 보고되면서 새로운 보정 ID가 여러 번 생성되는 경로가 존재했습니다.

1. `MESSAGE_TYPES.CALIBRATION_UI_READY` 및 응답 payload 정의 추가.
2. 콘텐츠가 실제 오버레이를 표시한 후에만 같은 session/page/calibrationId를 포함한 응답 반환.
3. 같은 calibrationId가 재전달되면 새 모델 보정 세션을 만들지 않고 ACK만 반환.
4. 백그라운드가 ACK의 protocolVersion/source/target/sessionId/pageId/calibrationId를 검증.
5. 콘텐츠 응답이 없는 경우 재시도하며, 12회 전송 실패 후 2초 간격으로 재시도하여 무한 고속 초기화 반복 방지. 경고 로그에 오류 원인 포함.
6. 순수 ACK 검증을 위한 Vitest 회귀 테스트 4개 추가.

## 적용 방법
기존 설치된 통합 프로젝트에서 ZIP을 덮어씌우고 다음 명령을 실행:

```bash
cd ~/Documents/GitHub/UXDS_Eye_Mouse_Integrated_Source
unzip -o ~/Downloads/UXDS_Calibration_Start_Handshake_Fix_20261018.zip -d .
nvm use 22
npm run typecheck && npm run lint && npm test && npm run test:uxds && npm run build
```

Chrome `chrome://extensions`에서 설치된 UXDS Eye + Mouse 확장 프로그램의 **새로고침**을 누르고 추적할 `https://` 웹페이지도 새로고침한 다음 다시 수집 시작. 기존 세션 상태가 남으면 팝업의 Refresh State로 초기화한 뒤 재시도.

**기존 L2CS ONNX 모델과 마우스 기록/프로젝트 인증 코드는 그대로 유지됩니다.**

## 검증 범위 및 잔여 확인
- 새 코드 5개 TS 파일의 TypeScript 구문 검사: 통과.
- ACK 유효·누락·이전 ID·이전 페이지·다른 세션·잘못된 발신자·버전·거절 응답: 독립 런타임 검사 8개 통과.
- npm 의존성을 이 실행 환경에서 완전 설치하지 못하므로 전체 `npm run typecheck`/`npm run lint`/`npm test`/`npm run build`는 실제 통과를 주장하지 않음.
- 실기기 Chrome + 웹캠 + 실사이트 보정 UI는 로컬 적용 후 재확인 필요.
- 연구용 Gaze360 기반 L2CS 체크포인트/ONNX는 ZIP에 포함하지 않음. 기존 로컬 모델 재사용.
