# UXDS 통합 확장 프로그램 ESLint 18개 오류 수정 보고

원본: UXDS_Eye_Mouse_Integrated_Full_Source_20261018.zip

## 수정 파일 (실제 실행 코드·검사 구성만 변경)
1. `eslint.config.js`: 빌드/실행에 사용하지 않는 `provenance/**` 원본 보관 디렉터리를 lint 검사에서 제외. 원본 보관 파일은 그대로 유지.
2. `src/background/uxdsMouseBridge.js`: HTTP JSON 응답 파싱의 불필요한 초기화/대입과 빈 catch 제거. 비-JSON 에러 응답일 때 HTTP 상태 메시지 유지.
3. `src/content/contentScript.ts`: Quick Recalibration 중 rollback 오류가 나면 rollback 에러를 `cause`로 보존하고, 원래 재보정 실패 메시지도 남김.
4. `tests/unit/offscreen/quickRecalibrationTransaction.test.ts`: `Reflect.get` 결과를 `unknown`으로 취급하고 테스트용 private 메서드의 타입을 검증하여 unsafe any 전파 제거.

## 확인
- `node --test integration/tests/bridge.test.mjs`: 6개 PASS
- `node --check src/background/uxdsMouseBridge.js`: PASS
- `node --check eslint.config.js`: PASS
- **`npm run typecheck`, `npm run lint`, Vitest, build`: 작업 환경에서 npm 레지스트리 네트워크 연결(EAI_AGAIN) 실패로 실행하지 못함. 사용자 컴퓨터에서 실행·확인 필요.**
- `node scripts/verify-integration.mjs`: 소스 연결 검사는 PASS. 모델 실행 자산(원본 ZIP에 없는 ONNX/WASM 등) 검사에서는 MISSING; 사용자 컴퓨터에 이미 생성된 자산은 패치 적용 시 그대로 유지됨.

## 사용법
기존 `UXDS_Eye_Mouse_Integrated_Source` 폴더에서 실행:

```bash
cd ~/Documents/GitHub/UXDS_Eye_Mouse_Integrated_Source
unzip -o ~/Downloads/UXDS_Integrated_Lint18_Fix_20261018.zip -d .
npm run typecheck
npm run lint
npm test
npm run test:uxds
npm run build
```

`.venv_l2cs_export`, `node_modules`, `public/models/l2cs/*.onnx`, `public/wasm`은 수정/삭제하지 않습니다. `unzip` 명령을 실행하기 전에 ZIP이 Downloads에 있는지 확인하십시오.

추가 주의: L2CS Gaze360 기반 ONNX 체크포인트는 연구용 라이선스 검토 대상이며 재배포/상업 이용은 별도 권리가 필요합니다.
