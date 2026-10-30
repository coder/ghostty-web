# Baseline validation

Validated in the parent research worktree before report publication, on 2026-10-08.

- ghostty-web: `1858a5947767a3e1c9e98dbf53b2ff87fedb2aab`
- Pinned Ghostty: `5714ed07a1012573261b7b7e3ed2add9c1504496`
- Bun: `1.2.15`; Node: `22.19.0`; Zig installed temporarily in research scratch: `0.15.2`.
- Initially no `node_modules`, no root `ghostty-vt.wasm`, and no `zig` on PATH. These were setup gaps, not blockers remaining after validation.

## Commands and results

| Check                                                                                                                           | Result                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `bun install --frozen-lockfile`                                                                                                 | PASS; 278 packages installed; no lockfile change                                                                                           |
| `bun run fmt`                                                                                                                   | PASS before adding reports                                                                                                                 |
| `bun run lint`                                                                                                                  | PASS; 80 files checked                                                                                                                     |
| `bun run typecheck`                                                                                                             | PASS                                                                                                                                       |
| `git apply --check patches/ghostty-wasm-api.patch` (absolute patch path in a disposable clone of the pinned Ghostty)            | PASS                                                                                                                                       |
| Apply the existing patch in that disposable clone, then `zig build lib-vt -Dtarget=wasm32-freestanding -Doptimize=ReleaseSmall` | PASS with Zig 0.15.2; resulting WASM approximately 415 KiB                                                                                 |
| Copy built `ghostty-vt.wasm` to the ignored root artifact, then `bun test`                                                      | PASS: **372 tests, 0 failures, 4,584 assertions across 16 files**; reported test-suite duration 6.33 seconds (not a performance benchmark) |
| `bun run build:lib`                                                                                                             | PASS; production ESM/UMD bundles and declarations generated                                                                                |

The in-repository Ghostty submodule was not patched or modified. The validation clone and Zig/cache live only in the workspace scratch directory. The WASM and library build components passed separately; **the full `bun run build` wrapper was not run**. The existing patch emits trailing-whitespace warnings on apply (20 lines). The library build warns that `fs/promises` is externalized for browser compatibility and that the declaration bundler uses TypeScript 5.8.2 while the project uses 5.9.3; neither warning caused failure.

## Limits

Passing tests are not proof of fidelity or absence of bugs. `happydom.ts` mocks Canvas drawing and text measurement, so these tests do not validate real browser pixels, real font shaping, IME/platform input, accessibility, frame time, or end-to-end native Ghostty parity. No throughput benchmarks, browser visual tests, current-upstream build, or full native app build were run by the parent baseline check.

Raw logs remain in workspace scratch as `bun-install.log`, `wasm-build.log`, `baseline-{fmt,lint,typecheck,tests,build-lib}.log`. Later specialist probes are independent evidence and must identify their own commands/results.

## Publication recheck

After publishing the research documents, the parent re-ran `bun run lint`, `bun run typecheck`, `bun test`, and `bun run build:lib`: all passed. The suite again reported **372 passed, 0 failed, 4,584 assertions, 16 files**. The root WASM remained byte-identical to the original pinned build (`sha256: 794191ccd9f469ed0d49ebcb3e6b326d64279b91752b71ad80a3d89ff1f26416`). No experimental backport was installed in the project.

The current-upstream WASM builds, Chromium probes and backport experiments described in reports 02–06 are additional specialist evidence, not part of this initial baseline. In particular, the backport validation's **356 tests** refers to `lib/` only; it is not a conflicting count of the complete **372-test** suite. Production source, the upstream patch, dependency lockfile and the Ghostty submodule were left unchanged.
