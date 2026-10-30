# Tests

| Location             | Runner                       | What it covers                                                          |
| -------------------- | ---------------------------- | ----------------------------------------------------------------------- |
| `lib/*.test.ts`      | `bun test` (happy-dom)       | Unit tests, colocated with the source; helpers in `lib/test-helpers.ts` |
| `tests/integration/` | `bun test` (happy-dom)       | The public `Terminal`/`Ghostty` API driven end to end on real WASM      |
| `tests/browser/`     | Playwright (Chromium)        | Canvas pixels, fonts, DPR, trusted keyboard/mouse/clipboard input       |
| `tests/packaging/`   | `bun tests/packaging/run.ts` | The packed npm tarball: ESM/CJS exports, types and browser loading      |

```bash
bun run build:wasm                 # tests load ./ghostty-vt.wasm
bun test                           # lib/ and tests/integration/
bun run test:browser               # Chromium (local browser)
bun run test:browser:container     # Chromium in the pinned CI image (canonical pixels)
bun run test:package               # packed-package consumers
```

## Integration tests

Each file in `tests/integration/` is an ordinary `bun:test` file. Shared helpers live in
`tests/integration/support/`: `terminal.ts` opens terminals on a fresh WASM instance and
provides input, observation and resource-tracking helpers; `payloads.ts` holds generated
input; `native-reference.ts` drives the raw libghostty-vt C ABI so a few tests (and
`lib/native-viewport.test.ts`) can compare ghostty-web against it.

## Browser tests

Specs are `tests/browser/*.pw.ts` (the suffix keeps them out of `bun test`). They use the
`test`/`expect` exported by `tests/browser/support/fixture.ts`, whose `harness` fixture loads
`tests/browser/harness.html` through Vite with the vendored fonts and a fresh WASM instance
per terminal. See [browser/README.md](browser/README.md) and
[browser/scenes/README.md](browser/scenes/README.md) for pixel comparison and visual baselines.

Tests target the shipping engine (`ghostty-vt.wasm`). Known limitations are documented in
[the migration notes](../docs/migration-libghostty-vt.md) rather than kept as failing tests.
