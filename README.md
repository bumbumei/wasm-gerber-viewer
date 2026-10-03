# wasm-gerber-viewer — memory64 개발 브랜치

이 저장소는 [dsafdsaf132/wasm-gerber-viewer](https://github.com/dsafdsaf132/wasm-gerber-viewer)의
포크로, WebAssembly memory64(wasm64)로 4 GiB를 넘는 메모리를 쓰는 기능을 검증하기 위한
개발 브랜치입니다. 안정 버전이 아니며 예고 없이 바뀌거나 사라질 수 있습니다.

**뷰어를 사용하시려면 업스트림을 이용해 주세요.**

- 뷰어: https://wasm-gerber-viewer.vercel.app/
- 미러: https://dsafdsaf132.github.io/wasm-gerber-viewer/
- 저장소: https://github.com/dsafdsaf132/wasm-gerber-viewer

## memory64 검증용 샘플

- [패드 2,400만 개 샘플 열기](https://bumbumei.github.io/wasm-gerber-viewer/?url=https%3A%2F%2Fbumbumei.github.io%2Fwasm-gerber-viewer%2Fdemo%2Fmemory64-test-pads-24M.gbr)
  (`demo/memory64-test-pads-24M.gbr`, 로드하면 메인 인스턴스가 약 5 GiB를 씁니다)
- Chrome·Edge 133 이상 또는 Firefox 134 이상이 필요합니다. Safari와 iPhone·iPad의 모든
  브라우저에서는 열리지 않습니다.
- 로드하는 동안 16 GiB 장비 RAM의 대부분을 씁니다.

---

**English.** This fork is a development branch for validating WebAssembly memory64
support (more than 4 GiB of memory) in wasm-gerber-viewer. It is not a stable release.
To use the viewer, go to the upstream project:
[viewer](https://wasm-gerber-viewer.vercel.app/) ·
[repository](https://github.com/dsafdsaf132/wasm-gerber-viewer).
The memory64 sample above needs Chrome or Edge 133+, or Firefox 134+.
