<div align="center">

# wasm-gerber-viewer

PCB 시각화를 위한 WASM/WebGL2 기반 Gerber 파일 뷰어입니다.

![WASM Gerber Viewer preview](demo/preview.png)

<br/>

[**`English`**](README.md) · [**`简体中文`**](README.zh-Hans.md) · [**`繁體中文`**](README.zh-Hant.md) · **`한국어`**

</div>

---

웹사이트:

- [Viewer](https://wasm-gerber-viewer.vercel.app/) / [Mirror](https://dsafdsaf132.github.io/wasm-gerber-viewer/)
- [Sample 1: KLP-5e ESP32 Sensor Board](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fraw.githubusercontent.com%2Ffutureshocked%2FKLP-5e-ESP32-sensor-board%2Fmain%2FKiCad%2520project%2Fdfm%2Fgerber.zip)
- [Sample 2: Xassette-Asterisk](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fprocessor-cdn.kitspace.org%2Fv6%2FSdtElectronics%2FXassette-Asterisk%2F6ccd88501c99e2339571de744d003d571be47fad%2F_%2FXassette-Asterisk-6ccd885-gerbers.zip)
- [Sample 3: OtterCastAmp](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fprocessor-cdn.kitspace.org%2Fv6%2FOttercast%2FOtterCastAmp%2F0b5f7f9a8e4e43a5d39048b9a1fa03e5cf7fc9f7%2F_%2FOtterCastAmp-0b5f7f9-gerbers.zip)
- [Sample 4: Zaius EVT3 Motherboard (ODB++)](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fmedia.githubusercontent.com%2Fmedia%2Fopencomputeproject%2Fzaius-barreleye-g2%2Fmaster%2FHW%2FEE%2FGBR%2FEVT%2FMB%2FZaius-EVT3-LAYOUT-MB-ODB-X02-20161226-Final.zip)
- [Feature test](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fwasm-gerber-viewer.vercel.app%2Fdemo%2Fgerber-feature-test.gbr)
- Performance test - Stars: [1K](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fwasm-gerber-viewer.vercel.app%2Fdemo%2Fperformance-test-stars-1K.gbr), [10K](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fwasm-gerber-viewer.vercel.app%2Fdemo%2Fperformance-test-stars-10K.gbr), [100K](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fw2f6wchhvqyk5cap.public.blob.vercel-storage.com%2Fdemo%2Fperformance-test-stars-100K.gbr), [1M](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fw2f6wchhvqyk5cap.public.blob.vercel-storage.com%2Fdemo%2Fperformance-test-stars-1M.gbr), [5M](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fw2f6wchhvqyk5cap.public.blob.vercel-storage.com%2Fdemo%2Fperformance-test-stars-1M.gbr&repeat=5&repeatOffsetX=70), [10M](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fw2f6wchhvqyk5cap.public.blob.vercel-storage.com%2Fdemo%2Fperformance-test-stars-1M.gbr&repeat=10&repeatOffsetX=70), [20M](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fw2f6wchhvqyk5cap.public.blob.vercel-storage.com%2Fdemo%2Fperformance-test-stars-1M.gbr&repeat=20&repeatOffsetX=70), [50M](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fw2f6wchhvqyk5cap.public.blob.vercel-storage.com%2Fdemo%2Fperformance-test-stars-1M.gbr&repeat=50&repeatOffsetX=70), [100M](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fw2f6wchhvqyk5cap.public.blob.vercel-storage.com%2Fdemo%2Fperformance-test-stars-1M.gbr&repeat=100&repeatOffsetX=0.007)
- Performance test - Single region: [72K](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fwasm-gerber-viewer.vercel.app%2Fdemo%2Fperformance-test-region-72K.gbr), [648K](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fw2f6wchhvqyk5cap.public.blob.vercel-storage.com%2Fdemo%2Fperformance-test-region-648K.gbr), [1.8M](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fw2f6wchhvqyk5cap.public.blob.vercel-storage.com%2Fdemo%2Fperformance-test-region-1.8M.gbr)
- Performance test - Arc region: [1.3M](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fw2f6wchhvqyk5cap.public.blob.vercel-storage.com%2Fdemo%2Fperformance-test-arc-region-1.3M.gbr)
- Memory64 test - Pads, 4 GiB 이상의 메모리 사용: [24M](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fwasm-gerber-viewer.vercel.app%2Fdemo%2Fmemory64-test-pads-24M.gbr)

## 기능

- 대형 Gerber 파일(10 MB 이상)을 빠르게 렌더링
- WASM과 WebGL2를 이용한 하드웨어 가속 렌더링
- WebAssembly memory64 지원 브라우저에서 4 GiB를 넘는 레이어 데이터 로드
- RS-274X Gerber 렌더링 지원
- NC drill 오버레이 렌더링 지원
- ODB++ 잡 가져오기 지원 (`.zip`, `.tgz`, `.tar.gz`, `.tar`)
- 모바일 기기 터치 조작 지원
- 레이어별 색상, 투명도, 표시 여부 제어
- Union, Intersection, Difference 및 사용자 지정 coverage 조합을 지원하는
  Composite Layer
- 도형 선택과 선택 영역 강조 표시 지원
- 좌우/상하 반전 제어
- mm/inch 단위 전환이 가능한 자 측정
- 자 오버레이를 포함한 해상도별 스크린샷 내보내기

## 빠른 시작

<details>
<summary>Bash</summary>

```bash
viewer_url="$(
  curl -fsSL https://api.github.com/repos/dsafdsaf132/wasm-gerber-viewer/releases/latest |
  sed -n '/"browser_download_url": .*\/wasm-gerber-viewer-.*\.tar\.gz"/ {
    s/.*"browser_download_url": *"\([^"]*\)".*/\1/p
    q
  }'
)"

curl -fsSL "$viewer_url" | tar -xz &&
cd wasm-gerber-viewer-* &&
python3 -m http.server 8000
```

브라우저에서 `http://localhost:8000`을 열고 Gerber 파일을 업로드합니다.

</details>

<details>
<summary>PowerShell</summary>

```powershell
$viewerUrl = (
  Invoke-RestMethod -Uri "https://api.github.com/repos/dsafdsaf132/wasm-gerber-viewer/releases/latest"
).assets |
  Where-Object { $_.name -match '^wasm-gerber-viewer-.*\.tar\.gz$' } |
  Select-Object -First 1 -ExpandProperty browser_download_url

Invoke-WebRequest -Uri $viewerUrl -OutFile viewer.tar.gz
tar -xzf viewer.tar.gz
Remove-Item viewer.tar.gz
Set-Location ((Get-ChildItem -Directory -Filter "wasm-gerber-viewer-*" | Select-Object -First 1).FullName)

python -m http.server 8000
```

브라우저에서 `http://localhost:8000`을 열고 Gerber 파일을 업로드합니다.

</details>

## 빌드

미리 빌드된 release artifact 대신 로컬에서 WASM 패키지를 다시 빌드해야 할 때 사용합니다.

요구 사항:

- **Rust stable** - [rustup](https://rustup.rs/)으로 설치
- **wasm-pack** - `cargo install wasm-pack`

```bash
rustup target add wasm32-unknown-unknown
wasm-pack build wasm --target web --out-dir pkg --release
```

### memory64 빌드 (선택)

WebAssembly memory64를 지원하는 브라우저에서는 뷰어가 메인 인스턴스용으로
`wasm/pkg64`의 두 번째 빌드를 불러옵니다. `wasm/pkg64`가 없으면 모든 곳에서
wasm32 빌드를 사용합니다.

```bash
./scripts/build-wasm64.sh
```

`wasm64-unknown-unknown`은 미리 빌드된 표준 라이브러리가 없으므로, 스크립트가
날짜를 고정한 nightly 툴체인과 `rust-src`를 설치해 `std`를 소스에서 빌드하고
`wasm/Cargo.lock`과 버전이 맞는 `wasm-bindgen` CLI를 실행합니다. 모듈은
binaryen 133의 `wasm-opt`로 최적화하며, 설치된 `wasm-opt`가 memory64 모듈을
받아들이지 못하면(wasm-pack에 포함된 버전이 그렇습니다) 스크립트가 직접
내려받습니다.

## npm 패키지

[wasm-gerber-renderer](packages/wasm-gerber-renderer/README.kr.md)

JavaScript, Node.js, CLI에서 Gerber 파일을 PNG로 렌더링하는 패키지입니다.
Node.js와 CLI 렌더링은
[`node-gles-webgl2`](https://github.com/dsafdsaf132/node-gles-webgl2)를 통해 지원됩니다.

## 프로젝트 구조

Rust/WASM pipeline과 module 세부 내용은
[wasm/README.md](wasm/README.md)를 참고하세요.

```text
wasm-gerber-viewer/
├── index.html                         # 애플리케이션 셸
├── package.json                       # 프로젝트 메타데이터와 스크립트
├── css/                               # UI 스타일
├── js/
│   ├── main.js                        # 브라우저 진입점
│   ├── core/                          # GerberViewer 상태와 실행 흐름
│   ├── loading/                       # 파일, 압축, URL, repeat, worker 로딩
│   ├── layers/                        # 레이어 목록 UI, 필터, 색상, composite bitset
│   │   └── composite-layers.js        # preset, source slot, visible-area bitset
│   ├── rendering/                     # viewport 계산, 측정, 스크린샷 내보내기
│   └── ui/                            # dialog, DOM 조회, 알림, 진단, 옵션
│       └── composite-layer-dialog.js   # Composite 생성, 편집, 이름 변경 dialog
├── vendor/                            # vendored 브라우저 라이브러리
├── packages/
│   └── wasm-gerber-renderer/          # npm 패키지와 Node CLI
├── wasm/
│   ├── Cargo.toml                     # Rust crate manifest
│   ├── README.md                      # Rust/WASM 파이프라인 설명
│   ├── pkg/                           # 생성된 wasm-pack 출력 (wasm32)
│   ├── pkg64/                         # 생성된 memory64 빌드 (scripts/build-wasm64.sh)
│   └── src/
│       ├── lib.rs                     # WASM API 진입점
│       ├── tests.rs                   # crate 단위 테스트
│       ├── geometry/                  # 공용 geometry 모델과 region contour
│       ├── parser/                    # Gerber 파서, aperture, 명령 처리, 테스트
│       ├── drill/                     # Excellon/NC drill 파서와 테스트
│       ├── interaction/               # picking, compact payload, highlight 데이터
│       ├── renderer/                  # Gerber/composite mask, GPU 리소스, shader, 테스트
│       │   ├── composite.rs           # membership, lookup, outline, cache, picking 상태
│       │   └── shaders/composite_*.frag.glsl
│       └── util/                      # 포맷팅과 유틸리티
├── demo/                              # 샘플과 성능 테스트 Gerber
├── docs/                              # README assets
├── scripts/                           # 빌드와 배포 스크립트
└── .github/workflows/                 # CI, 배포, release 워크플로
```

## 브라우저 요구 사항

WebGL2와 WebAssembly SIMD를 지원하는 최신 브라우저가 필요합니다.

- Chrome 96+, Firefox 114+, Safari 16.4+, Edge 96+
- iOS Chrome: iOS 16.4+ (WebKit을 사용하므로 iOS 버전에 따라 지원 여부가 결정됩니다.)

### 4 GiB를 넘는 메모리

WebAssembly memory64를 지원하는 브라우저(Chrome·Edge 133+, Firefox 134+)에서는
로드한 모든 레이어의 picking 데이터를 보관하는 메인 인스턴스가 memory64 빌드로
실행되어 4 GiB 대신 약 16 GiB까지 커질 수 있습니다. 파싱 워커는 파싱이 더 빠른
wasm32를 그대로 쓰고, wasm32 파서가 메모리 부족으로 실패한 레이어만 memory64
워커에서 다시 파싱합니다. Safari와 구형 브라우저는 이전과 같이 전부 wasm32로
동작하며, 이런 브라우저에서 4 GiB가 넘게 필요한 파일을 열면 지원되지 않는
브라우저라는 안내와 함께 열 수 있는 브라우저 목록을 보여 줍니다. 로드 중에
브라우저가 페이지를 닫아 버리는 경우도 있는데(iOS Safari는 메모리가 부족하면
페이지를 닫았다가 다시 엽니다), 이때 다시 열린 페이지는 같은 `?url=`을 또
불러오지 않고 무슨 일이 있었는지 안내합니다.

| 브라우저 | 메인 인스턴스 | 메인 인스턴스 메모리 한도 |
|-|-|-|
| Chrome·Edge 133+ (데스크톱, Android) | memory64 (파싱 워커는 wasm32) | 약 15.5 GiB |
| Firefox 134+ (데스크톱, Android) | memory64 (파싱 워커는 wasm32) | 약 15.5 GiB |
| Chrome·Edge 96–132, Firefox 114–133 | wasm32 | 약 3.5 GiB |
| Safari 16.4+ (macOS) | wasm32 | 약 3.5 GiB |
| iPhone·iPad의 모든 브라우저 (iOS 16.4+) | wasm32 (모두 WebKit 사용) | 약 3.5 GiB, iOS가 그 전에 페이지를 닫을 수 있음 |

한도는 뷰어가 레이어를 더 받지 않는 지점으로, 엔진이 허용하는 크기(wasm32는
4 GiB, memory64는 16 GiB)보다 512 MiB 작습니다. 실제로는 기기 RAM이 먼저 부족할
수 있습니다. `navigator.deviceMemory`가 8 GiB 미만으로 보고되는 기기에서는
memory64 한도를 그 값으로 낮춥니다(최소 3.5 GiB). memory64 지원 버전은 MDN 호환성
데이터(`webassembly.memory64`)를 따릅니다. Opera, Samsung Internet처럼 Chromium
133 이상을 쓰는 브라우저도 Chrome과 같이 동작하며, Safari는 아직 Technology
Preview에서만 memory64를 지원합니다.

뷰어 URL에 `?wasm=32` 또는 `?wasm=64`를 붙이면 모든 인스턴스가 한 빌드로
실행됩니다. 파일당 300 MiB 제한과 단일 버퍼에 대한 WebGL 제한은 그대로입니다.

`demo/memory64-test-pads-24M.gbr`는 이 동작을 확인하는 샘플입니다. 15 KiB 파일이
2,400만 개의 패드로 펼쳐지고, 로드 후 메인 인스턴스가 약 5 GiB를 차지합니다.
로드에는 16 GiB 장비의 RAM 대부분이 필요하며 wasm32에서는 실패합니다.
`node scripts/generate-memory64-sample.mjs [패드 수(백만)]`로 다른 크기를 만들 수
있습니다.

## 출처

샘플 압축 파일은 각 원본 출처에서 로드하며 이 저장소에 포함하지 않습니다.

<details>
<summary>Sample 1: KLP-5e ESP32 Sensor Board</summary>

- Project: [KLP-5e ESP32 Sensor Board](https://github.com/futureshocked/KLP-5e-ESP32-sensor-board)
- Copyright: Copyright (c) 2025, Peter Dalmaris
- License: CERN-OHL-S v2.0
- Archive: <https://raw.githubusercontent.com/futureshocked/KLP-5e-ESP32-sensor-board/main/KiCad%20project/dfm/gerber.zip>

</details>

<details>
<summary>Sample 2: Xassette-Asterisk</summary>

- Project: [Xassette-Asterisk](https://github.com/SdtElectronics/Xassette-Asterisk)
- Copyright: SdtElectronics
- License: CERN-OHL-W v2.0
- Archive: <https://processor-cdn.kitspace.org/v6/SdtElectronics/Xassette-Asterisk/6ccd88501c99e2339571de744d003d571be47fad/_/Xassette-Asterisk-6ccd885-gerbers.zip>

</details>

<details>
<summary>Sample 3: OtterCastAmp</summary>

- Project: [OtterCastAmp](https://github.com/Ottercast/OtterCastAmp)
- Copyright: Copyright (c) 2021 Ottercast, Niklas Fauth
- License: MIT License
- Archive: <https://processor-cdn.kitspace.org/v6/Ottercast/OtterCastAmp/0b5f7f9a8e4e43a5d39048b9a1fa03e5cf7fc9f7/_/OtterCastAmp-0b5f7f9-gerbers.zip>

</details>

<details>
<summary>Sample 4: Zaius EVT3 Motherboard (ODB++)</summary>

- Project: [Zaius & Barreleye G2](https://github.com/opencomputeproject/zaius-barreleye-g2)
- Copyright: Copyright International Business Machines Corporation 2015
- License: [Open Compute Project Hardware License-Permissive (OCPHL-P) v1.0](https://raw.githubusercontent.com/opencomputeproject/zaius-barreleye-g2/master/license.md)
- Archive: <https://media.githubusercontent.com/media/opencomputeproject/zaius-barreleye-g2/master/HW/EE/GBR/EVT/MB/Zaius-EVT3-LAYOUT-MB-ODB-X02-20161226-Final.zip>

</details>

## 라이선스

[MIT License](LICENSE)
