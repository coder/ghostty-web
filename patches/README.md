# Ghostty patches

The shipping `libghostty-vt` target is **unpatched upstream Ghostty**. Its revision,
compiler and verified artifact hash are recorded in `ghostty-build.json`.

`legacy/ghostty-wasm-api.patch` is retained only for the explicit `legacy` backend:
Ghostty `5714ed07a1012573261b7b7e3ed2add9c1504496`, Zig 0.15.2, custom terminal ABI.
Build it with `bun run build:wasm:legacy`. The builder applies and reverts it inside
an owned isolated checkout, never in the production submodule.

## Included legacy safety backport

The PageList section backports upstream
[`420de124f04aa322bf250098cc62d7195db94bfd`](https://github.com/ghostty-org/ghostty/commit/420de124f04aa322bf250098cc62d7195db94bfd):
zero recycled page memory on freestanding targets. It prevents Unicode reset traps
and stale text exposure between terminals sharing a WASM instance. Both allocation
sites and the `builtin` import are required. The old `Screen.zig` workaround is
intentionally retained in this rollback build.

Do not apply the legacy patch to the new submodule revision: its similarly named
exports have different signatures. The bridge identifies and validates each ABI
separately and refuses mismatches rather than silently falling back.
