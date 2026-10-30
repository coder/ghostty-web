# Reviewed terminal scenes

Eight small DPR-1 scenes supplement the analytic pixel and interaction tests:

| Scene                 | What is checked before comparing its whole image                                       |
| --------------------- | -------------------------------------------------------------------------------------- |
| `dark-styles`         | Expected text, background; normal/bold/italic/underline and RGB appearance             |
| `light-theme`         | Expected text and a distinctive non-default light background                           |
| `alternate-font`      | Expected text and an independent canvas glyph oracle using the requested vendored font |
| `multiline-selection` | Exact selected text and the complete selected/unselected cell map                      |
| `history-viewport`    | Viewport offset and all visible line identities decoded from fixture color markers     |
| `wrapped-text`        | Exact text on each wrapped row                                                         |
| `bar-cursor`          | Expected text and an independently specified bar rectangle/color                       |
| `resized-grid`        | Text preservation after resize, background and whole-grid layout                       |

These are **finding-free positive examples**, not screenshots of known bugs promoted to expected behavior. Known font clipping, runtime-theme, Unicode-selection and fractional-DPR seam defects remain separate tests, tracked outside these baselines. All scene glyphs are in the vendored fonts; system-font CJK/emoji fallback is not part of the goldens.

## Environment and comparisons

- Playwright 1.64.0 / Chromium 156.0.8078.4, Node 22.19.0, Bun 1.2.15.
- Canonical image: `mcr.microsoft.com/playwright:v1.64.0-noble@sha256:06a9939e57531807f8d5fd76ce44b53165ffb7d7501d87ab10e285c20b1e971f`.
- Vendored font family/digest, size, browser, DPR, grid and a scenario fingerprint are recorded in each JSON file.
- `observedWasmSha256` is provenance only: a backend upgrade must not require regenerating identical-looking images.
- Comparisons use decoded RGBA and every cell with **zero tolerance**, not compressed PNG size or a global percentage threshold.
- Missing images fail normal runs. There is no automatic snapshot creation/update.

## Run exactly as CI does

After installing the locked dependencies and building the shipping WASM:

```bash
# Linux x86_64 with Docker; source is mounted read-only and copied into the container.
bun run test:browser:container tests/browser/scenes.pw.ts
```

The ordinary `bun run test:browser` also includes the scenes. If a local OS/browser rasterizes differently, use the canonical container rather than weakening the comparator. CI uses that same image digest.

## Generate candidates safely

```bash
# Writes to a NEW temporary evidence directory, not to scenes/baselines.
bun run test:browser:scene-candidates
```

Set `TEST_ARTIFACT_DIR` to choose the parent of the new evidence directory (outside the checkout, or under ignored `test-results/`). The command prints its path. It runs the independent assertions, writes candidate PNGs and metadata. It never changes this directory's committed baselines. Candidate mode is forbidden in ordinary CI and requires the canonical container acknowledgement.

Before manually copying candidates into `baselines/`:

1. Check that all analytic, text and option tests pass for the intended behavior.
2. Inspect each changed scene at native resolution; inspect diff images when updating an existing scene.
3. Explain each change: a deliberate appearance change, a proven fix, or a separately reviewed font/browser environment update.
4. Review the PNG and JSON changes together, then run the normal comparison mode.

Do not accept an image merely because it is what the current implementation produced. Do not regenerate goldens just to get an upstream upgrade through CI. The initial baselines were generated in the canonical image, independently asserted, and visually inspected as a montage before promotion.
