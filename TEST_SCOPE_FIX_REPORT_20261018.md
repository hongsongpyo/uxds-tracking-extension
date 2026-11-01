# UXDS 통합 확장프로그램 — Vitest 테스트 발견 범위 수정 (2026-10-18)

## 로그 원인
- `integration/tests/bridge.test.mjs`는 `node:test`를 사용하고 `npm run test:uxds`로 **별도 실행**합니다. Vitest가 함께 읽으면 `No test suite found`가 발생합니다.
- `provenance/original-accuracy-upgrade/`는 정확도 개선 ZIP의 **원본 보관 사본**입니다. 일부 상대 import 의존성이 생략되어 있어 원본 보관 트리에서 테스트를 실행하면 모듈을 찾지 못합니다. 실제 통합된 파일과 테스트는 `src/`, `tests/`에 있습니다.
- 원본 기록은 절대 삭제하지 않습니다. `vitest.config.mjs`로 Vitest 검색 범위를 `tests/` 아래로 제한합니다.

## 변경 내용
- 추가: `vitest.config.mjs` (Vitest 테스트 검색 범위 한정)
- 제품 코드, 캘리브레이션/검증 알고리즘, UXDS 세션/전송, 기존 테스트 소스 변경 없음
- `npm run test:uxds` 그대로 별도 실행
- `Quick recalibration candidate rejected; previous model restored`는 실패 롤백을 의도적으로 시험하는 테스트의 예상 로그이며, 실제 사용자의 검증 결과를 뜻하지 않습니다.

## macOS 적용 방법 — 기존 빌드/모델/환경 보존
1. `UXDS_Integrated_Vitest5_Scope_Fix_20261018.zip`을 다운로드 폴더에 넣습니다.
2. 다음을 실행합니다.

```bash
cd ~/Documents/GitHub/UXDS_Eye_Mouse_Integrated_Source
unzip -o ~/Downloads/UXDS_Integrated_Vitest5_Scope_Fix_20261018.zip -d .
nvm use 22
npm run typecheck
npm run lint
npm test
npm run test:uxds
npm run build
```

## 테스트 상태 주의
이 제작 환경에서는 npm 의존성이 완비되지 않아 새 설정으로 전체 Vitest 실행은 수행하지 못했습니다. 사용자가 첨부한 실행 로그에서 전체 Vitest 수집 대상 41개 파일 중 36개 파일 및 170개 테스트가 통과했고, 5개 파일은 테스트 검색 범위 문제로 실패했습니다. UXDS 별도 테스트 6개는 PASS했고 Chrome `dist/` 빌드도 성공했습니다. 수정 후에는 `tests/` 아래 33개 테스트 파일만 수집되므로 테스트 개수는 이전과 달라질 수 있습니다. 수정 후 새 설정에서의 실제 통과는 위 명령으로 확인하세요.

정확도 수치는 사용자의 실물 웹캠으로 독립 검증한 결과로만 판단해야 합니다.
