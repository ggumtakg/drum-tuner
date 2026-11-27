# 드럼 튜너 (Drum Tuner)

휴대폰 마이크를 이용해 드럼 헤드의 목표 주파수를 맞추는 개인용 드럼 튜너 **PWA & Android 앱**입니다.  
합주실처럼 주변 악기 소리나 대화 소음이 섞이는 환경에서도 드럼 타격음을 안정적으로 판별할 수 있도록 소음 억제 파이프라인을 적용했습니다.

## 핵심 기능

- **목표 주파수 시각 튜닝 게이지**: `30~600 Hz` 범위의 목표 주파수에 맞춰 현재 측정 주파수와 편차를 실시간 게이지로 표시합니다. 허용 오차(`±0.2~5.0 Hz`, 기본 `±1.0 Hz`)도 조절할 수 있습니다.
- **주변 소음 대응 DSP 파이프라인**
  - **2초 주변 소음 자동 캘리브레이션**: 2초간 주변 악기·대화 소음 레벨을 수집해 상위 95백분위수(P95) 기준으로 권장 노이즈 게이트(`+10 dB` 헤드룸)를 자동 설정합니다.
  - **트랜지언트(타격) 판별**: 순간 에너지 상승과 어택 기울기를 검증해 지속적인 배경 소음을 거르고 실제 타격만 포착합니다.
  - **피치 일관성 검증**: 타격 후 안정화 구간을 거친 분석 창에서 서브 윈도우 간 피치 일관성과 신뢰도를 교차 검증하며, 과입력(클리핑)도 별도로 안내합니다.
  - **목표 주파수 대역 필터**: 목표 주파수 주변(`±15~80%`, 기본 `±40%`)만 통과시키는 캐스케이드 대역 통과(Band-pass) 필터로 다른 대역의 악기 간섭을 줄입니다.
- **이름-주파수 프리셋**: 스네어·탐·킥 등 자주 쓰는 드럼별 이름과 목표 주파수를 저장·수정·삭제할 수 있습니다.
- **드럼셋 묶음 순차 조율**: 여러 프리셋을 하나의 드럼셋(키트)으로 묶어 정해진 순서대로 빠르게 조율할 수 있습니다.
- **오프라인 지원**: `vite-plugin-pwa` 기반 정적 자산 캐싱과 브라우저 로컬 저장소(`localStorage`)를 사용해 네트워크 연결 없이도 동작하며, 프리셋·드럼셋·설정이 기기에 유지됩니다.

## Android APK 설치 방법

1. [GitHub Releases (`v1.0.0`)](https://github.com/ggumtakg/drum-tuner/releases/tag/v1.0.0)에서 **`drum-tuner.apk`** 파일을 다운로드합니다. (Android 7.0 / API 24 이상 지원)
2. Android 기기에서 다운로드한 APK를 실행해 설치합니다. 최초 설치 시 기기 설정에서 **"출처를 알 수 없는 앱 설치"** 허용이 필요할 수 있습니다.
3. 앱을 처음 실행하고 마이크를 켜면 나타나는 **마이크 권한 요청을 허용**해 주세요.
4. **합주실 사용 팁**: 주변에 다른 악기 소리나 대화가 있을 때는 드럼 타격을 잠시 멈춘 상태에서 상단 **소음 · 튜닝 설정 → `주변 소음 측정 (2초)`**을 먼저 실행하면, 현장 소음에 맞춘 노이즈 게이트가 자동으로 적용됩니다.

## 로컬 개발 · 테스트 · Android APK 빌드

### 사전 요구 사항

- Node.js 및 npm
- Android APK 빌드 시: JDK(`JAVA_HOME` 설정 필요) 및 Android SDK (`android/local.properties`에 `sdk.dir` 구성)

### 웹 개발 및 테스트

```bash
# 의존성 설치
npm install

# 개발 서버 실행
npm run dev

# 단위 테스트 실행 (Vitest)
npm test

# TypeScript 타입 검사
npm run typecheck

# 프로덕션 빌드 (타입 검사 + Vite 번들)
npm run build
```

> 참고: 웹 빌드 결과물을 로컬에서 미리 보려면 `npm run preview`, Capacitor Android 프로젝트 동기화만 수행하려면 `npm run android:sync`를 사용할 수 있습니다.

### Android APK 빌드 (Windows)

`JAVA_HOME`을 JDK 경로로 지정한 뒤 `npm run android:apk`를 실행하면 웹 빌드, Capacitor 동기화, Gradle Debug APK 빌드를 순서대로 수행하고 프로젝트 루트에 `drum-tuner.apk`를 생성합니다.

**PowerShell 예시:**

```powershell
$env:JAVA_HOME = "C:\Program Files\Java\jdk-21"
npm run android:apk
```

## 기술 스택

- **UI / 언어**: React 19, TypeScript 5
- **빌드 / PWA**: Vite 6, `vite-plugin-pwa`
- **오디오 / DSP**: Web Audio API, AudioWorklet (`pcm-worklet.js`, 미지원 환경 시 ScriptProcessor 폴백), TypeScript 기반 자체 DSP(Biquad 대역 통과 필터, 트랜지언트·피치 감지)
- **테스트**: Vitest
- **모바일 패키징**: Capacitor 8 Android (`com.personal.drumtuner`, 앱 이름: `드럼 튜너`)
