# UXDS Eye + Mouse Tracker

**UXDS Eye + Mouse Tracker**는 웹사이트에서 사용자의 시선(Eye-tracking)과 마우스 움직임(Mouse-tracking)을 수집하기 위한 Chrome 확장프로그램입니다.

웹캠 기반 시선 추적과 마우스 클릭, 이동, 스크롤 및 페이지 이동 정보를 수집하며, UXDS 웹 분석 플랫폼과 연동하여 사용자 행동 데이터를 기록합니다.

## 1. 설치 준비

- **브라우저:** Google Chrome 116 이상
- **운영체제:** Windows / macOS 등 Chrome 지원 환경
- **필요 장비:** 웹캠 (Eye-tracking 사용 시)
- **다운로드:** [UXDS Tracking Extension GitHub](https://github.com/hongsongpyo/uxds-tracking-extension)

별도의 Python, Node.js 설치나 소스코드 빌드 없이 저장소에 포함된 `dist` 폴더를 이용해 확장프로그램을 설치할 수 있습니다.

## 2. 확장프로그램 다운로드

1. [GitHub 저장소](https://github.com/hongsongpyo/uxds-tracking-extension)에 접속합니다.
2. 상단의 초록색 **Code** 버튼을 클릭합니다.
3. **Download ZIP**을 선택합니다.
4. 다운로드한 `uxds-tracking-extension-main.zip` 파일의 압축을 해제합니다.
5. 압축 해제한 폴더에서 `dist` 폴더를 찾습니다.

폴더 구조는 다음과 같습니다.

```text
uxds-tracking-extension-main/
├── dist/                  ← Chrome에 설치할 폴더
│   ├── manifest.json
│   ├── background/
│   ├── content/
│   ├── popup/
│   ├── offscreen/
│   ├── models/
│   ├── wasm/
│   └── ...
├── src/                   ← 개발용 소스코드
├── public/
├── scripts/
├── package.json
└── README_KO.md
```

**중요:** Chrome에 등록할 폴더는 `dist`입니다. ZIP 파일이나 `uxds-tracking-extension-main` 폴더 전체를 선택하지 마세요.

또한 `dist/models`, `dist/wasm` 등 내부 파일은 시선 추적 기능에 필요할 수 있으므로 삭제하거나 분리하지 마세요.

## 3. Chrome 확장프로그램 설치

### Step 1. 확장프로그램 관리 페이지 열기

Chrome 주소창에 다음 주소를 입력합니다.

`chrome://extensions`

### Step 2. 개발자 모드 활성화

확장프로그램 관리 페이지 오른쪽 상단의 **개발자 모드(Developer mode)** 스위치를 켭니다.

### Step 3. 확장프로그램 불러오기

1. 왼쪽 상단의 **압축해제된 확장 프로그램을 로드합니다(Load unpacked)** 버튼을 클릭합니다.
2. 앞서 다운로드하고 압축을 해제한 폴더로 이동합니다.
3. `uxds-tracking-extension-main/dist` 폴더를 선택합니다.
4. **선택** 버튼을 클릭합니다.

### Step 4. 설치 확인

확장프로그램 목록에 **UXDS Eye + Mouse Tracker**가 표시되면 설치된 것입니다.

Chrome 상단의 퍼즐 모양 확장프로그램 아이콘을 클릭하고, UXDS 확장프로그램을 고정하면 편리하게 사용할 수 있습니다.

## 4. UXDS 웹사이트 연결 및 데이터 수집

1. [UXDS 웹사이트](https://uxds-web.vercel.app/)에 접속합니다.
2. 로그인한 후 프로젝트를 생성하거나 기존 프로젝트를 선택합니다.
3. 해당 프로젝트에서 발급된 **Project ID**를 확인합니다.
4. Chrome에서 데이터를 수집할 HTTPS 웹사이트를 엽니다.
5. UXDS 확장프로그램을 실행하고 Project ID를 입력해 프로젝트를 연결합니다.
6. 수집을 시작하고 웹캠 권한을 허용합니다.
7. 화면 안내에 따라 얼굴 위치 확인, 시선 캘리브레이션 및 정확도 검증을 완료합니다.
8. 준비가 완료되면 시선과 마우스 데이터를 수집합니다.
9. 실험이 끝나면 확장프로그램에서 수집을 중지합니다.

**참고:** 시선 캘리브레이션과 검증이 완료되기 전에는 통합 마우스 수집이 시작되지 않을 수 있습니다. 또한 서버 데이터 저장에는 정상적으로 설정된 UXDS 프로젝트 및 Supabase 연동 환경이 필요합니다.

## 5. 설치 및 사용 중 발생할 수 있는 문제

### 확장프로그램이 설치되지 않는 경우

- `dist` 폴더를 선택했는지 확인합니다.
- `dist/manifest.json` 파일이 존재하는지 확인합니다.
- Chrome 개발자 모드가 활성화되어 있는지 확인합니다.
- ZIP 압축을 완전히 해제했는지 확인합니다.

### 카메라 또는 시선 추적이 작동하지 않는 경우

- 웹캠이 다른 프로그램에서 사용 중인지 확인합니다.
- Chrome의 카메라 접근 권한을 확인합니다.
- 확장프로그램에서 안내하는 캘리브레이션 절차를 다시 진행합니다.

### 데이터가 수집되지 않는 경우

- 올바른 UXDS Project ID를 입력했는지 확인합니다.
- 캘리브레이션 및 검증 절차를 완료했는지 확인합니다.
- 확장프로그램 설치 후 실험할 웹페이지를 새로고침합니다.
- 네트워크 연결과 UXDS 서버 상태를 확인합니다.

## 6. 확장프로그램 업데이트

새 버전이 GitHub에 업로드되면 다음과 같이 업데이트할 수 있습니다.

1. GitHub에서 최신 ZIP 파일을 다운로드합니다.
2. 압축을 해제합니다.
3. 기존에 설치했던 `dist` 폴더의 파일을 새 버전 파일로 교체합니다.
4. `chrome://extensions`에 접속합니다.
5. UXDS 확장프로그램 카드의 **새로고침(⟳)** 버튼을 클릭합니다.

기존 확장프로그램 폴더 경로를 유지하는 것을 권장합니다.

## 7. 개발자 안내

소스코드를 수정하거나 직접 빌드하려는 경우 저장소의 `src`, `public`, `scripts` 폴더와 `package.json`을 이용할 수 있습니다.

의존성 및 모델 파일이 준비된 개발 환경에서는 다음 명령어로 빌드할 수 있습니다.

```bash
npm ci
npm run build
```

빌드 결과물은 `dist` 폴더에 생성됩니다. 모델 및 외부 실행 자산을 새로 준비해야 하는 환경에서는 `README_KO.md`의 별도 설정 절차를 참고하세요.

## 8. 주의사항

본 확장프로그램은 UX 연구 및 사용자 행동 분석을 목적으로 개발되었습니다.

- 웹캠 및 웹사이트 활동 정보 수집 전 참가자의 동의를 받아야 합니다.
- 민감한 개인정보가 포함된 웹사이트에서는 수집에 주의해야 합니다.
- 연구 목적 외 사용 시 개인정보 보호 관련 법규와 모델·라이브러리 라이선스를 확인해야 합니다.
- Chrome 웹스토어가 아닌 GitHub에서 직접 설치하는 개발자용 확장프로그램입니다.

---

**UXDS — User Experience Data System**

[UXDS Web Platform](https://uxds-web.vercel.app/) | [GitHub Repository](https://github.com/hongsongpyo/uxds-tracking-extension)
