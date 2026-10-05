#!/usr/bin/env bash
# Builds the memory64 package into wasm/pkg64, next to the wasm32 package that
# vercel-build.sh writes to wasm/pkg. The viewer loads wasm/pkg64 for its main
# instance in browsers with WebAssembly memory64 and keeps wasm/pkg elsewhere.
#
# wasm64-unknown-unknown is a Tier 3 target without a prebuilt std, so this
# compiles std with a date-pinned nightly and runs the wasm-bindgen CLI itself:
# `wasm-pack build -- --target wasm64-unknown-unknown` stops at
# `rustup target add`.
#
# Environment:
#   WASM64_RUST_TOOLCHAIN  nightly to build with (default: the pinned date)
#   WASM_BINDGEN           wasm-bindgen CLI matching wasm/Cargo.lock
#   WASM_OPT               wasm-opt that accepts 64-bit tables (binaryen 133 does)
#   WASM64_SKIP_WASM_OPT   set to 1 to ship the module without wasm-opt
#   WASM64_TOOLS_DIR       where downloaded tools are kept
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -z "${CARGO_HOME:-}" && -f /rust/env ]]; then
  export CARGO_HOME="/rust"
fi
if [[ -z "${RUSTUP_HOME:-}" && -f /rust/env ]]; then
  export RUSTUP_HOME="/rust"
fi
export CARGO_HOME="${CARGO_HOME:-$HOME/.cargo}"
export RUSTUP_HOME="${RUSTUP_HOME:-$HOME/.rustup}"
export PATH="$CARGO_HOME/bin:$PATH"
WASM64_RUST_TOOLCHAIN="${WASM64_RUST_TOOLCHAIN:-nightly-2026-10-02}"
WASM64_TARGET="wasm64-unknown-unknown"
BINARYEN_VERSION="133"

for rust_env in "$CARGO_HOME/env" "$RUSTUP_HOME/env" /rust/env; do
  if [[ -f "$rust_env" ]]; then
    # shellcheck disable=SC1090
    . "$rust_env"
    break
  fi
done

to_unix_path() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -u "$1"
  else
    printf '%s\n' "$1"
  fi
}

target_dir="$(to_unix_path "${CARGO_TARGET_DIR:-$REPO_ROOT/wasm/target}")"
tools_dir="$(to_unix_path "${WASM64_TOOLS_DIR:-$target_dir/wasm64-tools}")"
wasm_pkg_dir="$REPO_ROOT/wasm/pkg64"

wasm_package_hash() {
  (
    cd "$REPO_ROOT"
    {
      printf '%s\0' scripts/build-wasm64.sh wasm/Cargo.lock wasm/Cargo.toml
      find wasm/src -type f -print0 | sort -z
    } | xargs -0 sha256sum
    printf '%s\n' "$WASM64_RUST_TOOLCHAIN" "${WASM64_SKIP_WASM_OPT:-0}"
  ) | sha256sum | cut -d ' ' -f1
}

wasm_hash="$(wasm_package_hash)"

if [[
  -f "$wasm_pkg_dir/.source-hash" &&
  -f "$wasm_pkg_dir/wasm_gerber_processor.js" &&
  -f "$wasm_pkg_dir/wasm_gerber_processor_bg.wasm" &&
  "$(cat "$wasm_pkg_dir/.source-hash")" == "$wasm_hash"
]]; then
  echo "Reusing cached wasm/pkg64 for source hash $wasm_hash"
  exit 0
fi

host_triple() {
  local arch
  case "$(uname -m)" in
    x86_64 | amd64) arch="x86_64" ;;
    aarch64 | arm64) arch="aarch64" ;;
    *) return 1 ;;
  esac
  case "$(uname -s)" in
    Linux) printf '%s %s\n' "$arch" linux ;;
    Darwin) printf '%s %s\n' "$arch" macos ;;
    MINGW* | MSYS* | CYGWIN*) printf '%s %s\n' "$arch" windows ;;
    *) return 1 ;;
  esac
}

# Downloads $1 to $2 and checks it against the first field of the checksum
# file at $3.
download_verified() {
  local url="$1" output="$2" checksum_url="$3" expected actual
  curl --proto '=https' --tlsv1.2 -fsSL "$url" -o "$output"
  expected="$(curl --proto '=https' --tlsv1.2 -fsSL "$checksum_url" | cut -d ' ' -f1)"
  actual="$(sha256sum "$output" | cut -d ' ' -f1)"
  if [[ -z "$expected" || "$expected" != "$actual" ]]; then
    echo "Checksum mismatch for $url" >&2
    return 1
  fi
}

# --- Rust toolchain -------------------------------------------------------

if ! RUSTUP_TOOLCHAIN="$WASM64_RUST_TOOLCHAIN" rustc --version >/dev/null 2>&1; then
  rustup toolchain install "$WASM64_RUST_TOOLCHAIN" --profile minimal --component rust-src
fi
export RUSTUP_TOOLCHAIN="$WASM64_RUST_TOOLCHAIN"
rust_sysroot="$(to_unix_path "$(rustc --print sysroot)")"
if [[ ! -d "$rust_sysroot/lib/rustlib/src/rust/library" ]]; then
  rustup component add rust-src --toolchain "$WASM64_RUST_TOOLCHAIN"
fi
echo "Building wasm64 with $(rustc --version)"

# --- wasm-bindgen CLI -----------------------------------------------------

# A checkout with CRLF line endings (Windows, read from WSL) still parses.
wasm_bindgen_version="$(
  awk '/^name = "wasm-bindgen"\r?$/ { getline; gsub(/version = |"|\r/, ""); print; exit }' \
    "$REPO_ROOT/wasm/Cargo.lock"
)"
if [[ -z "$wasm_bindgen_version" ]]; then
  echo "Could not read the wasm-bindgen version from wasm/Cargo.lock" >&2
  exit 1
fi

is_matching_wasm_bindgen() {
  [[ -n "$1" && -x "$1" && "$("$1" --version 2>/dev/null)" == "wasm-bindgen $wasm_bindgen_version" ]]
}

find_wasm_bindgen() {
  local candidate cache_root
  local -a candidates=()
  if [[ -n "${WASM_BINDGEN:-}" ]]; then
    candidates+=("$(to_unix_path "$WASM_BINDGEN")")
  fi
  candidates+=("$tools_dir/wasm-bindgen-$wasm_bindgen_version/wasm-bindgen")
  candidates+=("$tools_dir/wasm-bindgen-$wasm_bindgen_version/wasm-bindgen.exe")
  if candidate="$(command -v wasm-bindgen 2>/dev/null)"; then
    candidates+=("$candidate")
  fi
  # wasm-pack keeps the CLI it downloaded for the wasm32 build here.
  for cache_root in \
    "${LOCALAPPDATA:+$(to_unix_path "$LOCALAPPDATA")}" \
    "${XDG_CACHE_HOME:-$HOME/.cache}" \
    "$HOME/Library/Caches"; do
    [[ -n "$cache_root" ]] || continue
    for candidate in "$cache_root"/.wasm-pack/wasm-bindgen-*/wasm-bindgen{,.exe}; do
      candidates+=("$candidate")
    done
  done
  for candidate in "${candidates[@]}"; do
    if is_matching_wasm_bindgen "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

install_wasm_bindgen() {
  local arch os target archive url install_dir tmp
  read -r arch os < <(host_triple) || {
    echo "No prebuilt wasm-bindgen for $(uname -s) $(uname -m); set WASM_BINDGEN" >&2
    return 1
  }
  case "$os" in
    linux) target="${arch}-unknown-linux-musl" ;;
    macos) target="${arch}-apple-darwin" ;;
    windows) target="${arch}-pc-windows-msvc" ;;
  esac
  archive="wasm-bindgen-${wasm_bindgen_version}-${target}.tar.gz"
  url="https://github.com/wasm-bindgen/wasm-bindgen/releases/download/${wasm_bindgen_version}/${archive}"
  install_dir="$tools_dir/wasm-bindgen-$wasm_bindgen_version"
  tmp="$(mktemp -d)"
  download_verified "$url" "$tmp/$archive" "$url.sha256sum"
  tar -xzf "$tmp/$archive" -C "$tmp"
  mkdir -p "$install_dir"
  cp "$tmp/wasm-bindgen-${wasm_bindgen_version}-${target}"/wasm-bindgen* "$install_dir/"
  rm -rf "$tmp"
}

if ! wasm_bindgen="$(find_wasm_bindgen)"; then
  install_wasm_bindgen
  wasm_bindgen="$(find_wasm_bindgen)" || {
    echo "Failed to install wasm-bindgen $wasm_bindgen_version" >&2
    exit 1
  }
fi
echo "Using $("$wasm_bindgen" --version) at $wasm_bindgen"

# --- Build ----------------------------------------------------------------

(
  cd "$REPO_ROOT/wasm"
  # The parser's SIMD paths, as in the wasm32 build (scripts/vercel-build.sh).
  RUSTFLAGS="${RUSTFLAGS:-} -C target-feature=+simd128" \
    cargo build --release --lib --target "$WASM64_TARGET" -Zbuild-std=std,panic_abort
)

stage_dir="$(mktemp -d)"
trap 'rm -rf "$stage_dir"' EXIT
"$wasm_bindgen" --target web --out-dir "$stage_dir" \
  "$target_dir/$WASM64_TARGET/release/wasm_gerber_processor.wasm"

# --- wasm-opt -------------------------------------------------------------

staged_wasm="$stage_dir/wasm_gerber_processor_bg.wasm"

# Older binaryen releases reject the module ("Tables may not be 64-bit"), so a
# candidate only counts once it has optimized this module.
try_wasm_opt() {
  local wasm_opt="$1"
  [[ -n "$wasm_opt" && -x "$wasm_opt" ]] || return 1
  if "$wasm_opt" "$staged_wasm" -o "$stage_dir/optimized.wasm" -O 2>"$stage_dir/wasm-opt.log"; then
    mv "$stage_dir/optimized.wasm" "$staged_wasm"
    echo "Optimized with $("$wasm_opt" --version) at $wasm_opt"
    return 0
  fi
  echo "Skipping $wasm_opt: $(head -n 1 "$stage_dir/wasm-opt.log")" >&2
  rm -f "$stage_dir/optimized.wasm"
  return 1
}

install_binaryen() {
  local arch os archive url release tmp
  local -a members=()
  read -r arch os < <(host_triple) || return 1
  if [[ "$arch" == "aarch64" && "$os" != "linux" ]]; then
    arch="arm64"
  fi
  release="binaryen-version_${BINARYEN_VERSION}"
  archive="${release}-${arch}-${os}.tar.gz"
  url="https://github.com/WebAssembly/binaryen/releases/download/version_${BINARYEN_VERSION}/${archive}"
  tmp="$(mktemp -d)"
  download_verified "$url" "$tmp/$archive" "$url.sha256" || {
    rm -rf "$tmp"
    return 1
  }
  mkdir -p "$tools_dir"
  # Only wasm-opt is needed out of the full toolkit. The macOS build links it
  # against the bundled libbinaryen, so that archive is unpacked whole.
  case "$os" in
    windows) members=("$release/bin/wasm-opt.exe") ;;
    linux) members=("$release/bin/wasm-opt") ;;
  esac
  tar -xzf "$tmp/$archive" -C "$tools_dir" ${members[@]+"${members[@]}"}
  rm -rf "$tmp"
  [[ -d "$tools_dir/$release/bin" ]]
}

run_wasm_opt() {
  local candidate
  local binaryen_bin="$tools_dir/binaryen-version_${BINARYEN_VERSION}/bin"
  local -a candidates=()
  if [[ -n "${WASM_OPT:-}" ]]; then
    candidates+=("$(to_unix_path "$WASM_OPT")")
  fi
  candidates+=("$binaryen_bin/wasm-opt" "$binaryen_bin/wasm-opt.exe")
  if candidate="$(command -v wasm-opt 2>/dev/null)"; then
    candidates+=("$candidate")
  fi
  for candidate in "${candidates[@]}"; do
    if try_wasm_opt "$candidate"; then
      return 0
    fi
  done
  if install_binaryen; then
    for candidate in "$binaryen_bin/wasm-opt" "$binaryen_bin/wasm-opt.exe"; do
      if try_wasm_opt "$candidate"; then
        return 0
      fi
    done
  fi
  return 1
}

if [[ "${WASM64_SKIP_WASM_OPT:-0}" == "1" ]]; then
  echo "WASM64_SKIP_WASM_OPT=1: shipping wasm/pkg64 without wasm-opt"
elif ! run_wasm_opt; then
  echo "No usable wasm-opt found: shipping wasm/pkg64 without wasm-opt" >&2
fi

# --- Publish --------------------------------------------------------------

rm -rf "$wasm_pkg_dir"
mkdir -p "$wasm_pkg_dir"
cp "$stage_dir"/wasm_gerber_processor.js \
  "$stage_dir"/wasm_gerber_processor.d.ts \
  "$stage_dir"/wasm_gerber_processor_bg.wasm \
  "$stage_dir"/wasm_gerber_processor_bg.wasm.d.ts \
  "$wasm_pkg_dir/"
printf '*\n' > "$wasm_pkg_dir/.gitignore"
printf '%s\n' "$wasm_hash" > "$wasm_pkg_dir/.source-hash"
echo "wasm/pkg64 is ready ($(wc -c < "$wasm_pkg_dir/wasm_gerber_processor_bg.wasm") bytes)"
