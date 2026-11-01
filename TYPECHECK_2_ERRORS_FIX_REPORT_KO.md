# UXDS Eye + Mouse — Stop/Start 패치 TypeScript 오류 2개 수정

## 원인과 수정

### 1. src/background/serviceWorker.ts (기존 4142행)

`context.senderTabId`는 `number | null`인데 `Number.isFinite(context.senderTabId)`만으로는 TypeScript가 `null`을 배제하지 못합니다.

변경: `typeof context.senderTabId !== "number" || !Number.isFinite(context.senderTabId)`를 검증 조건에 추가했습니다. 다른 메타데이터 검증은 그대로 유지합니다.

### 2. src/popup/popup.ts (기존 1309행)

`currentState !== IDLE` 분기에서 TypeScript는 `currentState`가 IDLE이 아닌 상태로 좁혀졌다고 판단합니다. 이후 비동기 함수가 전역 값을 갱신해도 TS가 그 부작용을 반영하지 않아, 같은 변수와 `IDLE`을 다시 비교하면 TS2367이 발생합니다.

변경: `refreshTrackerState()`가 실제로 반환하는 값을 `previousState`, `resetState`에 각각 저장하고, 리셋 뒤 **새로 조회된** `resetState`가 IDLE인지 검사합니다. 리셋에 실패하면 새 세션 시작을 중단하는 기존 안전 게이트를 유지합니다.

### 3. scripts/check-restart-fix.mjs

이전 문자열 일치 검사가 변경 전 구문을 요구하므로, 반환 상태값 기준의 검사를 하도록 업데이트했습니다.

## 검증

실행 완료:
- `node scripts/check-restart-fix.mjs`: PASS (구문 확인, 콘텐츠 주입 4가지 시나리오 및 재시작 불변 조건)
- `node --test integration/tests/bridge.test.mjs`: 6/6 PASS

작업 환경 제한:
- `npm ci` 설치가 시간 초과되어 `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`를 이 환경에서 완료하지 못했습니다. 실제 사용자의 Mac에서 재실행해야 합니다.
- 실제 Chrome 반복 실행 및 카메라·독립 검증·Supabase 전송까지의 종단 간 시험은 수행하지 않았습니다.

## 적용

이 패치는 바로 이전 `UXDS_Stop_Start_Restart_Stability_Fix_20261018.zip`을 적용한 폴더 위에 덮어쓰도록 작성했습니다. UXDS 웹사이트 폴더, ONNX 모델, Supabase DB는 변경하지 않습니다.

```
cd ~/Documents/GitHub/UXDS_Eye_Mouse_Integrated_Source
unzip -o ~/Downloads/UXDS_Restart_TypeScript_2Error_Fix_20261019.zip -d .
nvm use 22
npm run typecheck && npm run lint && npm test && npm run test:uxds && npm run build
```

성공했다면 Chrome `chrome://extensions`에서 UXDS 확장 프로그램을 새로고침한 뒤 실험 탭도 새로고침하세요.
