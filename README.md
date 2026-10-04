<div align="center">

# wasm-gerber-viewer

WASM/WebGL2-based Gerber file viewer for PCB visualization.

![WASM Gerber Viewer preview](demo/preview.png)

<br/>

**`English`** · [**`简体中文`**](README.zh-Hans.md) · [**`繁體中文`**](README.zh-Hant.md) · [**`한국어`**](README.kr.md)

</div>

---

## Websites

- [Viewer](https://wasm-gerber-viewer.vercel.app/) / [Mirror](https://dsafdsaf132.github.io/wasm-gerber-viewer/)
- [Sample 1: KLP-5e ESP32 Sensor Board](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fraw.githubusercontent.com%2Ffutureshocked%2FKLP-5e-ESP32-sensor-board%2Fmain%2FKiCad%2520project%2Fdfm%2Fgerber.zip)
- [Sample 2: Xassette-Asterisk](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fprocessor-cdn.kitspace.org%2Fv6%2FSdtElectronics%2FXassette-Asterisk%2F6ccd88501c99e2339571de744d003d571be47fad%2F_%2FXassette-Asterisk-6ccd885-gerbers.zip)
- [Sample 3: OtterCastAmp](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fprocessor-cdn.kitspace.org%2Fv6%2FOttercast%2FOtterCastAmp%2F0b5f7f9a8e4e43a5d39048b9a1fa03e5cf7fc9f7%2F_%2FOtterCastAmp-0b5f7f9-gerbers.zip)
- [Sample 4: Zaius EVT3 Motherboard (ODB++)](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fmedia.githubusercontent.com%2Fmedia%2Fopencomputeproject%2Fzaius-barreleye-g2%2Fmaster%2FHW%2FEE%2FGBR%2FEVT%2FMB%2FZaius-EVT3-LAYOUT-MB-ODB-X02-20161226-Final.zip)
- [Feature test](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fwasm-gerber-viewer.vercel.app%2Fdemo%2Fgerber-feature-test.gbr)
- Performance test - Stars: [1K](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fwasm-gerber-viewer.vercel.app%2Fdemo%2Fperformance-test-stars-1K.gbr), [10K](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fwasm-gerber-viewer.vercel.app%2Fdemo%2Fperformance-test-stars-10K.gbr), [100K](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fw2f6wchhvqyk5cap.public.blob.vercel-storage.com%2Fdemo%2Fperformance-test-stars-100K.gbr), [1M](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fw2f6wchhvqyk5cap.public.blob.vercel-storage.com%2Fdemo%2Fperformance-test-stars-1M.gbr), [5M](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fw2f6wchhvqyk5cap.public.blob.vercel-storage.com%2Fdemo%2Fperformance-test-stars-1M.gbr&repeat=5&repeatOffsetX=70), [10M](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fw2f6wchhvqyk5cap.public.blob.vercel-storage.com%2Fdemo%2Fperformance-test-stars-1M.gbr&repeat=10&repeatOffsetX=70), [20M](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fw2f6wchhvqyk5cap.public.blob.vercel-storage.com%2Fdemo%2Fperformance-test-stars-1M.gbr&repeat=20&repeatOffsetX=70), [50M](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fw2f6wchhvqyk5cap.public.blob.vercel-storage.com%2Fdemo%2Fperformance-test-stars-1M.gbr&repeat=50&repeatOffsetX=0.007)
- Performance test - Single region: [72K](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fwasm-gerber-viewer.vercel.app%2Fdemo%2Fperformance-test-region-72K.gbr), [648K](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fw2f6wchhvqyk5cap.public.blob.vercel-storage.com%2Fdemo%2Fperformance-test-region-648K.gbr), [1.8M](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fw2f6wchhvqyk5cap.public.blob.vercel-storage.com%2Fdemo%2Fperformance-test-region-1.8M.gbr)
- Performance test - Arc region: [1.3M](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fw2f6wchhvqyk5cap.public.blob.vercel-storage.com%2Fdemo%2Fperformance-test-arc-region-1.3M.gbr)
- Memory64 test - Pads, uses more than 4 GiB of memory: [24M](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fwasm-gerber-viewer.vercel.app%2Fdemo%2Fmemory64-test-pads-24M.gbr)

## Features

- High-performance rendering for large Gerber files (>10 MB)
- WebGL2 hardware-accelerated rendering via WASM
- More than 4 GiB of loaded layer data in browsers with WebAssembly memory64
- RS-274X Gerber rendering support
- NC drill overlay rendering support
- ODB++ job import (`.zip`, `.tgz`, `.tar.gz`, `.tar`)
- Touch support for mobile devices
- Multi-layer rendering with per-layer color and visibility control
- Composite Layers with Union, Intersection, Difference, and custom coverage
  combinations
- Feature picking with selected-area highlighting
- Horizontal/vertical flip controls
- Ruler measurements with mm/inch unit switching
- Screenshot export with resolution options, including ruler overlays

## Quick Start

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

Open `http://localhost:8000` and upload Gerber files.

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

Open `http://localhost:8000` and upload Gerber files.

</details>

## Building

Use this when you need to rebuild the WASM package locally instead of using the
prebuilt release artifact.

Requirements:

- **Rust stable** - install with [rustup](https://rustup.rs/)
- **wasm-pack** - `cargo install wasm-pack`

```bash
rustup target add wasm32-unknown-unknown
wasm-pack build wasm --target web --out-dir pkg --release
```

### memory64 build (optional)

The viewer loads a second build from `wasm/pkg64` for its main instance in
browsers with WebAssembly memory64. Without `wasm/pkg64` it runs the wasm32
build everywhere.

```bash
./scripts/build-wasm64.sh
```

`wasm64-unknown-unknown` has no prebuilt standard library, so the script
installs a date-pinned nightly toolchain with `rust-src`, builds `std` from
source and runs the `wasm-bindgen` CLI that matches `wasm/Cargo.lock`. It
optimizes the module with `wasm-opt` from binaryen 133, which it downloads
when no installed `wasm-opt` accepts a memory64 module (the release bundled
with wasm-pack does not).

## npm Package

[wasm-gerber-renderer](packages/wasm-gerber-renderer/README.md)

JavaScript, Node.js, and CLI package for rendering Gerber files to PNG.
Node.js and CLI rendering are supported via
[`node-gles-webgl2`](https://github.com/dsafdsaf132/node-gles-webgl2).

## Project Structure

For the Rust/WASM pipeline and module details, see
[wasm/README.md](wasm/README.md).

```text
wasm-gerber-viewer/
├── index.html                         # Application shell
├── package.json                       # Project metadata and scripts
├── css/                               # UI styles
├── js/
│   ├── main.js                        # Browser entry point
│   ├── core/                          # GerberViewer state and orchestration
│   ├── loading/                       # File, archive, URL, repeat, and worker loading
│   ├── layers/                        # Layer list UI, filters, colors, and composite bitsets
│   ├── rendering/                     # Viewport math, measurements, and screenshot export
│   └── ui/                            # Dialogs, DOM lookup, notifications, diagnostics, options
├── vendor/                            # Vendored browser libraries
├── packages/
│   └── wasm-gerber-renderer/          # npm package and Node CLI
├── wasm/
│   ├── Cargo.toml                     # Rust crate manifest
│   ├── README.md                      # Rust/WASM pipeline notes
│   ├── pkg/                           # Generated wasm-pack output (wasm32)
│   ├── pkg64/                         # Generated memory64 build (scripts/build-wasm64.sh)
│   └── src/
│       ├── lib.rs                     # WASM API entry point
│       ├── tests.rs                   # Crate-level tests
│       ├── geometry/                  # Shared geometry model and region contours
│       ├── parser/                    # Gerber parser, apertures, commands, and tests
│       ├── drill/                     # Excellon/NC drill parser and tests
│       ├── interaction/               # Picking, compact payloads, and highlight data
│       ├── renderer/                  # Gerber/composite masks, GPU resources, shaders, tests
│       └── util/                      # Formatting and utility helpers
├── demo/                              # Sample and performance Gerbers
├── docs/                              # README assets
├── scripts/                           # Build and deployment scripts
└── .github/workflows/                 # CI, deploy, and release workflows
```

## Browser Requirements

Modern browsers with WebGL2 and WebAssembly SIMD support:

- Chrome 96+
- Firefox 114+
- Safari 16.4+
- Edge 96+
- Chrome for iOS: iOS 16.4+ (WebKit; support depends on the iOS version)

### Memory beyond 4 GiB

In browsers with WebAssembly memory64 (Chrome and Edge 133+, Firefox 134+) the
viewer's main instance, which keeps the picking data of every loaded layer,
runs the memory64 build and can grow to about 16 GiB instead of 4 GiB. Parse
workers stay on wasm32 because it parses faster; a layer is parsed again in a
memory64 worker only when the wasm32 parser runs out of memory on it. Safari
and older browsers run wasm32 for everything, as before; when a file there
needs more than 4 GiB, the viewer says so and lists the browsers that can load
it. A browser may also close the page during such a load (iOS Safari does when
it runs out of memory, then reopens it); the reopened page explains what
happened instead of loading the same `?url=` again.

| Browser | Main instance | Main-instance memory limit |
|-|-|-|
| Chrome, Edge 133+ (desktop, Android) | memory64 (parse workers wasm32) | about 15.5 GiB |
| Firefox 134+ (desktop, Android) | memory64 (parse workers wasm32) | about 15.5 GiB |
| Chrome, Edge 96–132, Firefox 114–133 | wasm32 | about 3.5 GiB |
| Safari 16.4+ (macOS) | wasm32 | about 3.5 GiB |
| Every browser on iPhone and iPad (iOS 16.4+) | wasm32 (all use WebKit) | about 3.5 GiB; iOS may close the page sooner |

The limit is where the viewer stops accepting layers, 512 MiB short of what the
engine allows (4 GiB for wasm32, 16 GiB for memory64); the device can run out
of RAM first. Where `navigator.deviceMemory` reports less than 8 GiB, the
memory64 limit drops to that value (never below 3.5 GiB). memory64 versions
follow MDN's compatibility data (`webassembly.memory64`): other browsers on
Chromium 133+, such as Opera and Samsung Internet, behave like Chrome, and
Safari supports memory64 only in Technology Preview so far.

Add `?wasm=32` or `?wasm=64` to the viewer URL to run every instance on one
build. The 300 MiB limit per file and the WebGL limits on a single buffer are
unchanged.

`demo/memory64-test-pads-24M.gbr` is a sample that exercises this: a 15 KiB
file that expands to 24 million pads and leaves the main instance at about
5 GiB. Loading it takes most of a 16 GiB machine's RAM and fails on wasm32.
`node scripts/generate-memory64-sample.mjs [million pads]` writes other sizes.

## Source

Sample archives are loaded from their upstream sources and are not bundled in
this repository.

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

## License

[MIT License](LICENSE)
