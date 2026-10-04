<div align="center">

# wasm-gerber-viewer

本项目是一个基于 WASM/WebGL2 的 Gerber 文件查看器，适用于 PCB 可视化场景。

![WASM Gerber Viewer preview](demo/preview.png)

<br/>

[**`English`**](README.md) · **`简体中文`** · [**`繁體中文`**](README.zh-Hant.md) · [**`한국어`**](README.kr.md)

</div>

---

在线体验：

- [查看器](https://dsafdsaf132.github.io/wasm-gerber-viewer/) / [镜像站点](https://wasm-gerber-viewer.vercel.app/)
- [Sample 1: KLP-5e ESP32 Sensor Board](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fraw.githubusercontent.com%2Ffutureshocked%2FKLP-5e-ESP32-sensor-board%2Fmain%2FKiCad%2520project%2Fdfm%2Fgerber.zip)
- [Sample 2: Xassette-Asterisk](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fprocessor-cdn.kitspace.org%2Fv6%2FSdtElectronics%2FXassette-Asterisk%2F6ccd88501c99e2339571de744d003d571be47fad%2F_%2FXassette-Asterisk-6ccd885-gerbers.zip)
- [Sample 3: OtterCastAmp](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fprocessor-cdn.kitspace.org%2Fv6%2FOttercast%2FOtterCastAmp%2F0b5f7f9a8e4e43a5d39048b9a1fa03e5cf7fc9f7%2F_%2FOtterCastAmp-0b5f7f9-gerbers.zip)
- [Sample 4: Zaius EVT3 Motherboard (ODB++)](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fmedia.githubusercontent.com%2Fmedia%2Fopencomputeproject%2Fzaius-barreleye-g2%2Fmaster%2FHW%2FEE%2FGBR%2FEVT%2FMB%2FZaius-EVT3-LAYOUT-MB-ODB-X02-20161226-Final.zip)
- [功能测试](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fwasm-gerber-viewer.vercel.app%2Fdemo%2Fgerber-feature-test.gbr)
- 性能测试 - Stars: [1K](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fwasm-gerber-viewer.vercel.app%2Fdemo%2Fperformance-test-stars-1K.gbr), [10K](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fwasm-gerber-viewer.vercel.app%2Fdemo%2Fperformance-test-stars-10K.gbr), [100K](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fw2f6wchhvqyk5cap.public.blob.vercel-storage.com%2Fdemo%2Fperformance-test-stars-100K.gbr), [1M](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fw2f6wchhvqyk5cap.public.blob.vercel-storage.com%2Fdemo%2Fperformance-test-stars-1M.gbr), [5M](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fw2f6wchhvqyk5cap.public.blob.vercel-storage.com%2Fdemo%2Fperformance-test-stars-1M.gbr&repeat=5&repeatOffsetX=70), [10M](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fw2f6wchhvqyk5cap.public.blob.vercel-storage.com%2Fdemo%2Fperformance-test-stars-1M.gbr&repeat=10&repeatOffsetX=70), [20M](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fw2f6wchhvqyk5cap.public.blob.vercel-storage.com%2Fdemo%2Fperformance-test-stars-1M.gbr&repeat=20&repeatOffsetX=70), [50M](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fw2f6wchhvqyk5cap.public.blob.vercel-storage.com%2Fdemo%2Fperformance-test-stars-1M.gbr&repeat=50&repeatOffsetX=70), [100M](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fw2f6wchhvqyk5cap.public.blob.vercel-storage.com%2Fdemo%2Fperformance-test-stars-1M.gbr&repeat=100&repeatOffsetX=0.007)
- 性能测试 - Single region: [72K](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fwasm-gerber-viewer.vercel.app%2Fdemo%2Fperformance-test-region-72K.gbr), [648K](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fw2f6wchhvqyk5cap.public.blob.vercel-storage.com%2Fdemo%2Fperformance-test-region-648K.gbr), [1.8M](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fw2f6wchhvqyk5cap.public.blob.vercel-storage.com%2Fdemo%2Fperformance-test-region-1.8M.gbr)
- 性能测试 - Arc region: [1.3M](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fw2f6wchhvqyk5cap.public.blob.vercel-storage.com%2Fdemo%2Fperformance-test-arc-region-1.3M.gbr)
- Memory64 测试 - Pads，使用超过 4 GiB 内存: [24M](https://wasm-gerber-viewer.vercel.app/?url=https%3A%2F%2Fwasm-gerber-viewer.vercel.app%2Fdemo%2Fmemory64-test-pads-24M.gbr)

## 功能特性

- 面向大型 Gerber 文件（10 MB 以上）优化的高性能渲染
- 基于 WASM 与 WebGL2 的硬件加速渲染
- 在支持 WebAssembly memory64 的浏览器中可加载超过 4 GiB 的图层数据
- 支持 RS-274X Gerber 渲染
- 支持 NC drill 叠加渲染
- 支持导入 ODB++ 作业（`.zip`、`.tgz`、`.tar.gz`、`.tar`）
- 支持移动设备触控操作
- 支持按层控制颜色、透明度和可见性
- Composite Layer 支持 Union、Intersection、Difference 和自定义 coverage
  组合
- 支持要素拾取和选中区域高亮
- 支持水平/垂直翻转
- 标尺测量支持 mm/inch 单位切换
- 可按分辨率导出截图，并可包含标尺覆盖层

## 快速开始

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

在浏览器中打开 `http://localhost:8000`，然后上传 Gerber 文件。

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

在浏览器中打开 `http://localhost:8000`，然后上传 Gerber 文件。

</details>

## 本地构建

如果不使用预构建的 Release 产物，可以按以下方式在本地重新构建 WASM 包。

环境要求：

- **Rust stable** - 使用 [rustup](https://rustup.rs/) 安装
- **wasm-pack** - `cargo install wasm-pack`

```bash
rustup target add wasm32-unknown-unknown
wasm-pack build wasm --target web --out-dir pkg --release
```

### memory64 构建（可选）

在支持 WebAssembly memory64 的浏览器中，查看器会为主实例加载 `wasm/pkg64`
中的第二个构建。没有 `wasm/pkg64` 时，所有位置都使用 wasm32 构建。

```bash
./scripts/build-wasm64.sh
```

`wasm64-unknown-unknown` 没有预构建的标准库，因此脚本会安装固定日期的 nightly
工具链和 `rust-src`，从源码构建 `std`，并运行与 `wasm/Cargo.lock` 版本一致的
`wasm-bindgen` CLI。模块使用 binaryen 133 的 `wasm-opt` 优化；如果已安装的
`wasm-opt` 不接受 memory64 模块（wasm-pack 自带的版本就是如此），脚本会自行
下载。

## npm 包

[wasm-gerber-renderer](packages/wasm-gerber-renderer/README.zh-Hans.md)

该包可在 JavaScript、Node.js 和 CLI 中将 Gerber 文件渲染为 PNG。
Node.js 和 CLI 渲染通过
[`node-gles-webgl2`](https://github.com/dsafdsaf132/node-gles-webgl2) 支持。

## 项目结构

Rust/WASM 管线及模块详情请参阅
[wasm/README.md](wasm/README.md)。

```text
wasm-gerber-viewer/
├── index.html                         # 应用外壳
├── package.json                       # 项目元数据和脚本
├── css/                               # UI 样式
├── js/
│   ├── main.js                        # 浏览器入口
│   ├── core/                          # GerberViewer 状态和流程编排
│   ├── loading/                       # 文件、压缩包、URL、repeat 和 worker 加载
│   ├── layers/                        # 图层列表 UI、过滤、颜色和 composite bitset
│   │   └── composite-layers.js        # preset、source slot 和 visible-area bitset
│   ├── rendering/                     # viewport 计算、测量和截图导出
│   └── ui/                            # dialog、DOM 查询、通知、诊断和选项
│       └── composite-layer-dialog.js   # Composite 创建、编辑和重命名 dialog
├── vendor/                            # 内置浏览器第三方库
├── packages/
│   └── wasm-gerber-renderer/          # npm 包和 Node CLI
├── wasm/
│   ├── Cargo.toml                     # Rust crate manifest
│   ├── README.md                      # Rust/WASM 管线说明
│   ├── pkg/                           # 生成的 wasm-pack 输出（wasm32）
│   ├── pkg64/                         # 生成的 memory64 构建（scripts/build-wasm64.sh）
│   └── src/
│       ├── lib.rs                     # WASM API 入口
│       ├── tests.rs                   # crate 级测试
│       ├── geometry/                  # 共享 geometry 模型和 region contour
│       ├── parser/                    # Gerber 解析、aperture、命令处理和测试
│       ├── drill/                     # Excellon/NC drill 解析和测试
│       ├── interaction/               # picking、compact payload 和高亮数据
│       ├── renderer/                  # Gerber/composite mask、GPU 资源、shader 和测试
│       │   ├── composite.rs           # membership、lookup、outline、cache 和 picking 状态
│       │   └── shaders/composite_*.frag.glsl
│       └── util/                      # 格式化和工具函数
├── demo/                              # 示例和性能测试 Gerber
├── docs/                              # README assets
├── scripts/                           # 构建和部署脚本
└── .github/workflows/                 # CI、部署和 release workflow
```

## 浏览器要求

需要支持 WebGL2 和 WebAssembly SIMD 的现代浏览器。

- Chrome 96+, Firefox 114+, Safari 16.4+, Edge 96+
- iOS Chrome：iOS 16.4+（使用 WebKit，支持情况取决于 iOS 版本）

### 超过 4 GiB 的内存

在支持 WebAssembly memory64 的浏览器（Chrome 和 Edge 133+、Firefox 134+）中，
保存所有已加载图层拾取数据的主实例会运行 memory64 构建，可以从 4 GiB 增长到约
16 GiB。解析 worker 仍使用解析更快的 wasm32；只有当 wasm32 解析器因内存不足而
失败时，该图层才会在 memory64 worker 中重新解析。Safari 和旧版浏览器与之前
一样，全部运行 wasm32；在这些浏览器中打开需要超过 4 GiB 的文件时，查看器会提示
浏览器不受支持，并列出可以打开该文件的浏览器。浏览器也可能在加载过程中关闭页面
（iOS Safari 内存不足时会关闭页面再重新打开），重新打开的页面不会再次加载同一个
`?url=`，而是说明发生了什么。

| 浏览器 | 主实例 | 主实例内存上限 |
|-|-|-|
| Chrome、Edge 133+（桌面、Android） | memory64（解析 worker 为 wasm32） | 约 15.5 GiB |
| Firefox 134+（桌面、Android） | memory64（解析 worker 为 wasm32） | 约 15.5 GiB |
| Chrome、Edge 96–132，Firefox 114–133 | wasm32 | 约 3.5 GiB |
| Safari 16.4+（macOS） | wasm32 | 约 3.5 GiB |
| iPhone、iPad 上的所有浏览器（iOS 16.4+） | wasm32（均使用 WebKit） | 约 3.5 GiB；iOS 可能更早关闭页面 |

上限是查看器停止接受新图层的位置，比引擎允许的大小（wasm32 为 4 GiB，memory64
为 16 GiB）少 512 MiB；实际上设备内存可能先耗尽。在 `navigator.deviceMemory`
报告小于 8 GiB 的设备上，memory64 上限会降到该值（不低于 3.5 GiB）。memory64 的
支持版本依据 MDN 兼容性数据（`webassembly.memory64`）：Opera、Samsung Internet
等基于 Chromium 133+ 的浏览器与 Chrome 相同，Safari 目前仅在 Technology Preview
中支持 memory64。

在查看器 URL 后加上 `?wasm=32` 或 `?wasm=64`，可以让所有实例都运行同一个构建。
单个文件 300 MiB 的限制以及 WebGL 对单个缓冲区的限制保持不变。

`demo/memory64-test-pads-24M.gbr` 是用于验证该行为的示例：15 KiB 的文件会展开为
2400 万个焊盘，加载后主实例约占 5 GiB。加载它需要 16 GiB 机器的大部分内存，
并且在 wasm32 下会失败。可用
`node scripts/generate-memory64-sample.mjs [焊盘数（百万）]` 生成其他大小。

## 示例来源

示例压缩包从各自的上游项目加载，不包含在本仓库中。

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

## 开源协议

[MIT License](LICENSE)
