# WASM default-colour regression qualification

The Lapis Server review found that OSC 10/11 could not update default colours:
the WASM response stream had no allocator, and its colour action handler ignored
requests. The WASM bridge now uses an allocator and delegates colour operations
to Ghostty's existing readonly handler, marking palette state dirty. This keeps
existing default cells in sync while preserving explicit background colours.

The source change is in `patches/ghostty-wasm-api.patch`; generated WASM and npm
archives are local build outputs, not committed substitutes for source.

Validation on 2026-11-19:

- `bun test lib/default-colors.test.ts`: initially 1 failed / 0 passed; rebuilt
  source passes 1 / 0 with four assertions, including explicit-colour retention.
- `bun run fmt`, `bun run lint`, `bun run typecheck`: pass.
- `bun test`: 360 passed / 0 failed, 4569 assertions.
- `bun run build`: passes with Zig 0.15.2 compiling the pinned Ghostty source to
  WASM inside a disposable Linux container, then the normal Vite library build.
  Zig runs through an external command-scoped tooling adapter because the macOS
  SDK 27.2 attempt failed while linking the native build runner. Earlier Linux
  setup attempts lacked a mounted compiler and `xz`; both setup issues were
  corrected before the successful build. One compiler attempt lacked the colour
  action's terminator field; passing the complete action fixed that error.
- The packed public output feeds Lapis Terminal plugin browser acceptance:
  five checks pass, including live theme pixel matching and repeated narrow
  renderer replacement. Server keeps independent Storybook reload acceptance.

No upstream PR, registry publication or tag was created. This source/archive
cohort is a local validation prerequisite until upstream delivery is agreed.
