#!/usr/bin/env bash
# Build the pre-migration ("legacy") engine pinned in ghostty-build.json:
# Ghostty 5714ed07 + patches/legacy/ghostty-wasm-api.patch with Zig 0.15.2, in an
# isolated, owned work dir (never the ghostty/ submodule). Publishes
# ghostty-vt-legacy.wasm (default: repo root) only after its exact sha256 matched.
#
# Usage: scripts/build-legacy-wasm.sh [--work-dir DIR] [--out-dir DIR]
# Compiler: $ZIG_0_15_BIN or `zig` on PATH (must be exactly 0.15.2).
# See scripts/build-wasm.sh --help for every option.
set -euo pipefail
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/build-wasm.sh" legacy "$@"
