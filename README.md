# wasm-gerber-viewer — memory64 개발 브랜치

이 저장소는 [dsafdsaf132/wasm-gerber-viewer](https://github.com/dsafdsaf132/wasm-gerber-viewer)의
포크로, WebAssembly memory64(wasm64)로 4 GiB를 넘는 메모리를 쓰는 기능을 검증하기 위한
개발 브랜치입니다. 안정 버전이 아니며 예고 없이 바뀌거나 사라질 수 있습니다.

**뷰어를 사용하시려면 업스트림을 이용해 주세요.**

- 뷰어: https://wasm-gerber-viewer.vercel.app/
- 미러: https://dsafdsaf132.github.io/wasm-gerber-viewer/
- 저장소: https://github.com/dsafdsaf132/wasm-gerber-viewer

## 현재 배포 내용

업스트림 main(`d6891bd`, SIMD 파서 포함)에, 업스트림에 리뷰를 요청한 두 PR을 더한 상태입니다.

- [memory64 메인 인스턴스로 4 GiB를 넘는 레이어 지원](https://github.com/dsafdsaf132/wasm-gerber-viewer/pull/112)
- [큰 레이어의 파싱 진행률 표시](https://github.com/dsafdsaf132/wasm-gerber-viewer/pull/113)

업스트림 리뷰로 PR이 바뀌면 이 브랜치에도 다시 반영합니다.

## 데모

업스트림 README의 데모를 이 포크 배포본에서 엽니다. memory64를 지원하는 브라우저에서는 메인
인스턴스가 memory64로 동작하고, 큰 파일은 로딩 창에서 파싱 진행률을 볼 수 있습니다.

- 실제 보드
  - [KLP-5e ESP32 센서 보드](https://bumbumei.github.io/wasm-gerber-viewer/?url=https%3A%2F%2Fraw.githubusercontent.com%2Ffutureshocked%2FKLP-5e-ESP32-sensor-board%2Fmain%2FKiCad%2520project%2Fdfm%2Fgerber.zip)
  - [Xassette-Asterisk](https://bumbumei.github.io/wasm-gerber-viewer/?url=https%3A%2F%2Fprocessor-cdn.kitspace.org%2Fv6%2FSdtElectronics%2FXassette-Asterisk%2F6ccd88501c99e2339571de744d003d571be47fad%2F_%2FXassette-Asterisk-6ccd885-gerbers.zip)
  - [OtterCastAmp](https://bumbumei.github.io/wasm-gerber-viewer/?url=https%3A%2F%2Fprocessor-cdn.kitspace.org%2Fv6%2FOttercast%2FOtterCastAmp%2F0b5f7f9a8e4e43a5d39048b9a1fa03e5cf7fc9f7%2F_%2FOtterCastAmp-0b5f7f9-gerbers.zip)
  - [Zaius EVT3 메인보드 (ODB++)](https://bumbumei.github.io/wasm-gerber-viewer/?url=https%3A%2F%2Fmedia.githubusercontent.com%2Fmedia%2Fopencomputeproject%2Fzaius-barreleye-g2%2Fmaster%2FHW%2FEE%2FGBR%2FEVT%2FMB%2FZaius-EVT3-LAYOUT-MB-ODB-X02-20161226-Final.zip)
- [기능 테스트](https://bumbumei.github.io/wasm-gerber-viewer/?url=https%3A%2F%2Fbumbumei.github.io%2Fwasm-gerber-viewer%2Fdemo%2Fgerber-feature-test.gbr)
- 성능 테스트 - 별 모양: [1K](https://bumbumei.github.io/wasm-gerber-viewer/?url=https%3A%2F%2Fbumbumei.github.io%2Fwasm-gerber-viewer%2Fdemo%2Fperformance-test-stars-1K.gbr), [10K](https://bumbumei.github.io/wasm-gerber-viewer/?url=https%3A%2F%2Fbumbumei.github.io%2Fwasm-gerber-viewer%2Fdemo%2Fperformance-test-stars-10K.gbr), [100K](https://bumbumei.github.io/wasm-gerber-viewer/?url=https%3A%2F%2Fw2f6wchhvqyk5cap.public.blob.vercel-storage.com%2Fdemo%2Fperformance-test-stars-100K.gbr), [1M](https://bumbumei.github.io/wasm-gerber-viewer/?url=https%3A%2F%2Fw2f6wchhvqyk5cap.public.blob.vercel-storage.com%2Fdemo%2Fperformance-test-stars-1M.gbr), [5M](https://bumbumei.github.io/wasm-gerber-viewer/?url=https%3A%2F%2Fw2f6wchhvqyk5cap.public.blob.vercel-storage.com%2Fdemo%2Fperformance-test-stars-1M.gbr&repeat=5&repeatOffsetX=70), [10M](https://bumbumei.github.io/wasm-gerber-viewer/?url=https%3A%2F%2Fw2f6wchhvqyk5cap.public.blob.vercel-storage.com%2Fdemo%2Fperformance-test-stars-1M.gbr&repeat=10&repeatOffsetX=70), [20M](https://bumbumei.github.io/wasm-gerber-viewer/?url=https%3A%2F%2Fw2f6wchhvqyk5cap.public.blob.vercel-storage.com%2Fdemo%2Fperformance-test-stars-1M.gbr&repeat=20&repeatOffsetX=70), [50M](https://bumbumei.github.io/wasm-gerber-viewer/?url=https%3A%2F%2Fw2f6wchhvqyk5cap.public.blob.vercel-storage.com%2Fdemo%2Fperformance-test-stars-1M.gbr&repeat=50&repeatOffsetX=0.007)
- 성능 테스트 - 단일 region: [72K](https://bumbumei.github.io/wasm-gerber-viewer/?url=https%3A%2F%2Fbumbumei.github.io%2Fwasm-gerber-viewer%2Fdemo%2Fperformance-test-region-72K.gbr), [648K](https://bumbumei.github.io/wasm-gerber-viewer/?url=https%3A%2F%2Fw2f6wchhvqyk5cap.public.blob.vercel-storage.com%2Fdemo%2Fperformance-test-region-648K.gbr), [1.8M](https://bumbumei.github.io/wasm-gerber-viewer/?url=https%3A%2F%2Fw2f6wchhvqyk5cap.public.blob.vercel-storage.com%2Fdemo%2Fperformance-test-region-1.8M.gbr)
- 성능 테스트 - arc region: [1.3M](https://bumbumei.github.io/wasm-gerber-viewer/?url=https%3A%2F%2Fw2f6wchhvqyk5cap.public.blob.vercel-storage.com%2Fdemo%2Fperformance-test-arc-region-1.3M.gbr)
- memory64: [패드 2,400만 개 (4 GiB 초과)](https://bumbumei.github.io/wasm-gerber-viewer/?url=https%3A%2F%2Fbumbumei.github.io%2Fwasm-gerber-viewer%2Fdemo%2Fmemory64-test-pads-24M.gbr) (아래 절 참고)

## 지원 브라우저

| 브라우저 | 동작 방식 | 메인 인스턴스 메모리 한도 |
|-|-|-|
| Chrome·Edge 133 이상 (Windows, macOS, Linux, Android) | 혼합: 메인 memory64, 파싱 워커 wasm32 | 약 15.5 GiB |
| Firefox 134 이상 (데스크톱, Android) | 혼합 | 약 15.5 GiB |
| Chrome·Edge 96–132, Firefox 114–133 | wasm32 | 약 3.5 GiB |
| Safari 16.4 이상 (macOS) | wasm32 | 약 3.5 GiB |
| iPhone·iPad의 모든 브라우저 (iOS 16.4 이상) | wasm32 (모두 Safari 엔진) | 약 3.5 GiB, 실제로는 iOS가 그 전에 탭을 종료할 수 있음 |
| WebGL2나 WebAssembly SIMD를 지원하지 않는 브라우저 | 동작하지 않음 | — |

- memory64 지원 버전은 MDN 호환성 데이터(`webassembly.memory64`) 기준입니다. Chromium 133 이상을
  쓰는 다른 브라우저(Opera, Samsung Internet 등)도 혼합 방식으로 동작합니다. Safari는 아직
  Technology Preview에서만 지원합니다.
- wasm32 쪽 최소 버전은 업스트림이 밝힌 WebGL2와 WebAssembly SIMD 요구 사항(Chrome·Edge 96,
  Firefox 114, Safari·iOS 16.4) 그대로입니다.
- 메모리 한도는 뷰어가 레이어를 더 받지 않는 지점입니다(4 GiB·16 GiB 엔진 상한에서 512 MiB 여유).
  실제로는 기기 RAM이 먼저 한계가 될 수 있고, `navigator.deviceMemory`가 8 GiB 미만으로 보고되는
  기기에서는 memory64 한도도 그 값으로 낮춥니다(최소 3.5 GiB).
- wasm32로 동작하는 브라우저에서 한도를 넘는 파일을 열면, 지원되지 않는 브라우저라는 안내와
  memory64 지원 브라우저(Chrome·Edge 133 이상, Firefox 134 이상)를 보여 줍니다. iPhone·iPad에서는
  컴퓨터에서 열라고 안내합니다.
- `?wasm=32` 또는 `?wasm=64`를 주소에 붙이면 모든 인스턴스를 한 빌드로 고정할 수 있습니다.

## memory64 검증용 샘플

- [패드 2,400만 개 샘플 열기](https://bumbumei.github.io/wasm-gerber-viewer/?url=https%3A%2F%2Fbumbumei.github.io%2Fwasm-gerber-viewer%2Fdemo%2Fmemory64-test-pads-24M.gbr)
  (`demo/memory64-test-pads-24M.gbr`, 로드하면 메인 인스턴스가 약 5 GiB를 씁니다)
- Chrome·Edge 133 이상 또는 Firefox 134 이상이 필요합니다. Safari와 iPhone·iPad의 모든
  브라우저에서는 열리지 않습니다.
- 로드하는 동안 16 GiB 장비 RAM의 대부분을 씁니다. 파싱하는 동안 로딩 창에 진행률이 표시됩니다.

## 업스트림 대비 측정

memory64 PR의 세 가지 동작 방식을 업스트림 main과 같은 조건에서 비교했습니다. 파싱 진행률
PR은 파서 단독 시간을 바꾸지 않았습니다(같은 실행에서 교대로 잰 값의 차이가 2% 안쪽).

| 구성 | 설명 |
|-|-|
| 업스트림 | dsafdsaf132/wasm-gerber-viewer `d6891bd`(SIMD 파서), wasm32 빌드 하나 |
| wasm32 | memory64 미지원 브라우저(Safari)에서, 또는 `?wasm=32`로 열었을 때 |
| wasm64 | `?wasm=64`: 메인 인스턴스와 파싱 워커 모두 memory64 |
| 혼합 | memory64 지원 브라우저의 기본값: 메인 인스턴스 memory64, 파싱 워커 wasm32 |

- 환경: Intel Iris Xe 노트북(Direct3D 11), Windows 11, Chromium 151. 값은 모두 7회 측정의 중앙값입니다.
- 데이터: 생성한 Gerber 레이어 4개(flash 40만 개 7.7 MiB, track 30만 개 5.9 MiB,
  다각형 region 2만 개 15.9 MiB, pad 20만 개 3.8 MiB)와 drill 파일 1개.
- 재현: `WASM_BENCHMARK_BASELINE_DIR=<업스트림 체크아웃> node scripts/benchmark-wasm-variants.mjs`

### 로딩 시간 (ms, 파일 선택부터 로딩 창이 닫힐 때까지)

| 작업 | 업스트림 | wasm32 | wasm64 | 혼합 |
|-|-:|-:|-:|-:|
| 레이어 4개 (병렬 파싱) | 2123 | 1687 | 2006 | 1695 |
| 레이어 1개 | 993 | 991 | 1057 | 1018 |
| 레이어 4개 + drill (순차 파싱) | 3101 | 3035 | 3603 | 3090 |

### 그리기 시간 (ms, 로드한 화면 한 프레임을 GPU가 끝낼 때까지)

| 화면 | 업스트림 | wasm32 | wasm64 | 혼합 |
|-|-:|-:|-:|-:|
| 레이어 4개 | 14.9 | 14.9 | 14.6 | 14.8 |
| 레이어 1개 | 3.2 | 3.0 | 3.4 | 3.2 |

### 메모리 사용량 (MiB, WebAssembly 선형 메모리)

| 항목 | 업스트림 | wasm32 | wasm64 | 혼합 |
|-|-:|-:|-:|-:|
| 메인 인스턴스, 레이어 4개 | 195 | 222 | 260 | 260 |
| 메인 인스턴스, 레이어 1개 | 123 | 123 | 173 | 71 |
| 메인 인스턴스, 레이어 4개 + drill | 290 | 290 | 272 | 260 |
| 파싱 워커 하나의 최대, 레이어 4개 | 169 | 169 | 200 | 169 |

레이어 1개일 때 혼합 구성은 파싱을 wasm32 워커에서 하므로 메인 인스턴스가 작습니다.

### 파서 단독 (ms, 같은 파일을 한 인스턴스에서 반복 파싱)

| 파일 | 업스트림 | wasm32 | wasm64 |
|-|-:|-:|-:|
| flash 40만 개 | 472 | 473 | 691 |
| track 30만 개 | 378 | 381 | 546 |
| region 2만 개 | 535 | 507 | 686 |
| pad 20만 개 | 230 | 241 | 327 |

### 4 GiB를 넘는 샘플 (`memory64-test-pads-24M.gbr`)

| | 업스트림 | wasm32 | 혼합 |
|-|-|-|-|
| 결과 | 10초 후 실패 (`unreachable`) | 실패 (`unreachable`) | 37초에 로드, picking 정상 |
| 메인 인스턴스 메모리 | 3.23 GiB (실패 시점) | 3.23 GiB (실패 시점) | 5.13 GiB |

이 표만 SIMD 이전 업스트림(`a147e04`) 기준입니다. RAM 여유가 부족해 다시 재지 못했고,
`?wasm=64`로도 재지 않았습니다.

### 요약

- **혼합(기본값)**: 파싱은 업스트림처럼 wasm32 워커에서 합니다(레이어 4개 워커 시간 합계 3,589 ms 대 3,339 ms).
  레이어 4개 로드는 업스트림보다 20% 빠릅니다. picking 인덱스를 만들기 전에 메모리를 한 번에
  예약해, 업스트림에서 771 ms 걸리던 인덱스 구축이 263 ms로 줄었기 때문입니다. 메인 인스턴스
  메모리는 33% 더 씁니다(64비트 포인터와 예약 여유분).
- **wasm32(Safari 등)**: 같은 예약으로 레이어 4개 로드가 21% 빠르고, 메인 메모리는 14% 늘었습니다.
  4 GiB 한도는 업스트림과 같습니다.
- **wasm64 전부**: SIMD 파서 기준으로 memory64 파서가 wasm32보다 35–46% 느려서 기본값으로 쓰지
  않습니다.
- **그리기**: 네 구성이 같습니다. 그리기 시간은 GPU가 결정합니다.

---

**English.** This fork is a development branch for validating WebAssembly memory64
support (more than 4 GiB of memory) in wasm-gerber-viewer. It is not a stable release.
To use the viewer, go to the upstream project:
[viewer](https://wasm-gerber-viewer.vercel.app/) ·
[repository](https://github.com/dsafdsaf132/wasm-gerber-viewer).
It currently runs upstream `d6891bd` plus the two pull requests under review upstream
(memory64 main instance, parse progress for large layers).
The demo list above opens upstream's demos in this fork's deployment.
The memory64 sample above needs Chrome or Edge 133+, or Firefox 134+.
Supported browsers: Chrome and Edge 133+ and Firefox 134+ (desktop and Android) run the
memory64 main instance (up to about 15.5 GiB); older Chrome, Edge and Firefox with WebGL2
and WebAssembly SIMD, Safari 16.4+ and every browser on iPhone and iPad (iOS 16.4+) run
wasm32 (up to about 3.5 GiB).
Measured against upstream `d6891bd` (tables above; Intel Iris Xe, Chromium 151, medians
of 7): the default mixed setup still parses in wasm32 workers, loads four layers about 20%
faster and uses about a third more main-instance memory; drawing time is unchanged.
