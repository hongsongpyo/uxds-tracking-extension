# UXDS 프로젝트 연결 실패 / Runtime protocol collision 수정

## 관찰한 증상

- 프로젝트 ID `prj_bb707aa1bce3` 입력 후 연결 상태가 갱신되지 않음.
- BACKGROUND에 `INCOMPATIBLE_MESSAGE_PROTOCOL` 경고 발생.
- 팝업의 UXDS 명령은 `{type: "UXDS_CONNECT_PROJECT", projectId: "..."}` 형식이며, Eye 메시지는 `{protocolVersion: 5, type, meta, payload}` 형식.

## 코드로 확인한 원인

`serviceWorker.ts`의 Eye 수신기는 `meta.target`이 없는 모든 메시지도 수신했습니다. 그 결과 Chrome의 동일 `onMessage` 호출에 **UXDS 리스너와 Eye 리스너가 동시에 응답**했습니다. Eye 리스너는 `protocolVersion`이 없는 UXDS 명령을 `INCOMPATIBLE_MESSAGE_PROTOCOL`로 거절합니다. 이 오류가 Supabase 검증 응답보다 먼저 도착할 수 있습니다.

## 수정 사항

- `src/background/backgroundMessageTarget.ts` 신규: `UXDS_*` 메시지는 Eye 수신기가 반환값 `false`로 무시.
- `src/background/serviceWorker.ts`: 새 필터 사용, 기존 Eye 메시지 대상 필터 로직은 그대로 유지.
- `tests/unit/background/backgroundMessageTarget.test.ts` 신규: 프로젝트 연결·상태조회·시작/중지·전송 명령과 버전이 지정된 Eye 상태 조회 메시지 경계 테스트.

## 적용

원본 파일을 덮어쓸 경우 기존 로컬 수정사항을 먼저 백업하세요. 통합 확장 소스 프로젝트 루트에서:

```bash
unzip -o ~/Downloads/UXDS_Project_Connection_Protocol_Fix_20261018.zip -d .
nvm use 22
npm run typecheck && npm run lint && npm test && npm run test:uxds && npm run build
```

Chrome `chrome://extensions`에서 이 확장의 새로고침 버튼을 누른 다음 팝업을 **닫고 다시 열어** 연결합니다. 이미 열린 오래된 팝업과 서비스 워커가 혼용되지 않도록 합니다.

## 별개 원인 가능성

로그에는 `GET_TRACKER_STATE` 버전 불일치도 포함됩니다. 같은 `dist`로 재빌드한 후 확장을 새로고침해도 계속된다면 콘솔에서 오류 상세의 `receivedProtocolVersion`과 `expectedProtocolVersion`을 확인하고, 중복 설치·이전 버전 팝업을 조사해야 합니다.

이 패치는 Supabase 서버의 프로젝트 존재 또는 `validate-project` 함수 배포 여부를 확인하거나 변경하지 않습니다. 패치 후에도 서버에서 거절되면 응답 HTTP status 및 `validate-project` 함수 로그를 점검하세요.

**검증 범위:** 소스 정적 확인. 사용자 macOS의 실제 Chrome/웹캠/Supabase 환경에서 재검증 필요. 원본 패치에 포함되지 않은 95MB L2CS 체크포인트 또는 ONNX 파일은 이번 ZIP에 포함하지 않습니다.
