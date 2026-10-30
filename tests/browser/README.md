# Browser tests

Playwright tests for what happy-dom cannot see: canvas pixels, device-pixel ratio, fonts,
and trusted keyboard, mouse, focus and clipboard events.

```bash
bun run test:browser               # local Chromium
bun run test:browser:container     # pinned CI image; use this for exact pixels
```

Vite serves `harness.html`, which loads the real library and `ghostty-vt.wasm`. Each test
gets a fresh page and each terminal its own WASM instance; uncaught page errors fail the
test. The harness waits for the vendored fonts before anything is drawn, and DPR is set
through the browser context. Runs have no retries.

| Path                         | Role                                                                      |
| ---------------------------- | ------------------------------------------------------------------------- |
| `*.pw.ts`                    | Specs                                                                     |
| `harness.html`, `harness.ts` | Page-side driver; the only code that reaches into ghostty-web internals   |
| `support/fixture.ts`         | `test`/`expect`, the `harness` fixture, pixel assertions with attachments |
| `support/pixels.ts`          | Decoded-RGBA probes and the per-cell comparator                           |
| `support/interaction.ts`     | Wheel, drag, selection and clipboard helpers                              |
| `scenes/`, `fonts/`          | Reviewed visual baselines and the vendored DejaVu Sans Mono fonts         |

Waits use animation frames or state predicates, never sleeps. Pixel comparisons use
decoded RGBA per cell, not PNG bytes. Never regenerate baselines to make a failure pass.

OS IME and real keyboard layouts, screen readers, clipboard permission prompts, touch/pen
hardware, Firefox and WebKit are outside these tests.
