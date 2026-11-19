# Lapis terminal viewport qualification

FitAddon no longer reserves a 15px gutter for a scrollbar drawn over the canvas.
CanvasRenderer fills the measured content viewport, including partial character
cells, without changing cell metrics. The scrollbar and its hit target meet the
right edge. Canvas dimensions remain owned by the renderer at device pixel ratio.
Theme changes repaint the viewport remainder as well as complete rows.

Regression: `bun test lib/fit-viewport.test.ts` initially failed once; now passes
with six assertions, including a viewport resize that does not change columns.
Two existing FitAddon expectations encoded the removed gutter and were updated
to the overlay contract. `bun test lib/fit-viewport.test.ts lib/addons/fit.test.ts`:
13 passed, zero failures. Full suite: 361 passed, zero failures. Formatting,
lint, TypeScript and the normal library/WASM build passed. WASM used the same
external Docker Zig adapter described in lapis-terminal-colors.md.

These are unpublished local prerequisites. Browser pixel, scrollbar and Server
acceptance are recorded separately in the consuming source repositories.
