/** Small whole-grid visual baselines, backed by independent semantic/pixel assertions. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENES, type Scene } from './scenes/catalogue';
import { GlyphOracles, checkGlyphs } from './scenes/oracle';
import { THEME, expect, expectSameCells, test } from './support/fixture';
import { expectedHighlight, highlightMap, viewportLines } from './support/interaction';
import { EXACT, cellInterior, decodePng, encodePng, uniformColor } from './support/pixels';

const BASELINES = fileURLToPath(new URL('./scenes/baselines/', import.meta.url));
const CONTAINER =
  'mcr.microsoft.com/playwright:v1.64.0-noble@sha256:06a9939e57531807f8d5fd76ce44b53165ffb7d7501d87ab10e285c20b1e971f';
const candidatePath = process.env.GHOSTTY_SCENE_CANDIDATES;

function candidates(): string | undefined {
  if (!candidatePath) return undefined;
  if (process.env.CI) throw new Error('Scene candidate generation is forbidden in normal CI');
  if (process.env.GHOSTTY_SCENE_ENVIRONMENT !== CONTAINER) {
    throw new Error('Generate candidates with scripts/test-browser-container.sh --candidates');
  }
  if (!isAbsolute(candidatePath)) throw new Error('GHOSTTY_SCENE_CANDIDATES must be absolute');
  mkdirSync(candidatePath, { recursive: true });
  const directory = realpathSync(candidatePath);
  mkdirSync(BASELINES, { recursive: true });
  const relation = relative(realpathSync(BASELINES), directory);
  if (!relation || (!relation.startsWith('..') && !isAbsolute(relation))) {
    throw new Error('Candidates must not overwrite committed scene baselines');
  }
  return directory;
}

function fingerprint(scene: Scene): string {
  return createHash('sha256').update(JSON.stringify(scene)).digest('hex');
}

for (const scene of SCENES) {
  test(`scene ${scene.id} matches its reviewed baseline`, async ({ harness }) => {
    const font = harness.info.fonts[scene.fontRole ?? 'primary'];
    const fontSize = scene.fontSize ?? 15;
    const theme = { ...THEME, ...scene.theme };
    const term = await harness.create({
      cols: scene.cols,
      rows: scene.rows,
      fontFamily: font.family,
      fontSize,
      theme,
      cursorStyle: scene.cursorStyle,
      cursorBlink: false,
    });
    await term.writeAndSettle(scene.input);
    if (scene.action?.kind === 'selection') {
      await term.select(scene.action.col, scene.action.row, scene.action.length);
      await term.settle();
      expect(await term.selection(), 'selected-text').toStrictEqual(scene.action.text);
    } else if (scene.action?.kind === 'history') {
      await term.scrollLines(scene.action.lines);
      await harness.page.waitForFunction(
        (id) => window.__ghosttyHarness.scrollbarState(id).opacity === 1,
        term.id
      );
      await term.settle();
      expect((await term.viewport()).viewportY, 'history-offset').toStrictEqual(
        -scene.action.lines
      );
    } else if (scene.action?.kind === 'resize') {
      await term.resize(scene.action.cols, scene.action.rows);
      await term.settle();
    }
    const capture = await term.capture();
    const { image, grid, raw } = capture;
    expect(raw.dpr, 'baseline-dpr').toStrictEqual(1);
    if (scene.lines) {
      const lines = await Promise.all(scene.lines.map((_, row) => term.bufferLineText(row)));
      expect(lines, 'scene-text').toStrictEqual(scene.lines);
    }
    if (scene.action?.kind === 'history') {
      expect(viewportLines(image, grid), 'visible-history-rows').toStrictEqual(
        Array.from({ length: scene.rows }, (_, row) =>
          scene.action!.kind === 'history' ? scene.action!.first + row : -1
        )
      );
    } else {
      // Empty bottom-right cell: a direct independent background oracle.
      expect(
        uniformColor(image, cellInterior(grid, grid.rows - 1, grid.cols - 3)),
        'background'
      ).toStrictEqual(theme.background);
    }
    if (scene.action?.kind === 'selection') {
      expect(highlightMap(image, grid), 'whole-highlight-map').toStrictEqual(
        expectedHighlight(grid.rows, grid.cols, { row: 1, col: 2 }, { row: 2, col: 4 })
      );
    }
    if (scene.id === 'bar-cursor') {
      const x = 7 * grid.cellW;
      const y = 4 * grid.cellH;
      expect(
        uniformColor(image, { x0: x, x1: x + 2, y0: y, y1: y + grid.cellH }),
        'bar-cursor'
      ).toStrictEqual(theme.cursor);
    }
    if (scene.glyph) {
      expect(
        await checkGlyphs(new GlyphOracles(harness), capture, await term.cellMetrics(), raw.dpr, [
          {
            ...scene.glyph,
            fontFamily: font.family,
            fontSize,
            foreground: theme.foreground,
            background: theme.background,
          },
        ]),
        'independent-glyph-oracle'
      ).toStrictEqual([]);
    }

    const metadata = {
      scene: scene.id,
      description: scene.description,
      scenarioSha256: fingerprint(scene),
      browser: harness.page.context().browser()!.version(),
      container: CONTAINER,
      font: { family: font.family, sha256: font.sha256, size: fontSize },
      dpr: raw.dpr,
      width: image.width,
      height: image.height,
      grid,
    };
    const output = candidates();
    if (output) {
      writeFileSync(resolve(output, `${scene.id}.png`), encodePng(image));
      writeFileSync(
        resolve(output, `${scene.id}.json`),
        `${JSON.stringify({ ...metadata, observedWasmSha256: harness.info.wasm.sha256 }, null, 2)}\n`
      );
      test.info().annotations.push({ type: 'candidate-only', description: output });
      return;
    }
    const imagePath = resolve(BASELINES, `${scene.id}.png`);
    const metadataPath = resolve(BASELINES, `${scene.id}.json`);
    if (!existsSync(imagePath) || !existsSync(metadataPath)) {
      throw new Error(
        `Missing reviewed scene baseline: ${scene.id}; generate candidates separately, never auto-update`
      );
    }
    const { observedWasmSha256: _provenanceOnly, ...expectedMetadata } = JSON.parse(
      readFileSync(metadataPath, 'utf8')
    );
    // A backend upgrade may change the WASM hash; it must not silently change the scene.
    expect(metadata, 'scene-environment').toStrictEqual(expectedMetadata);
    await expectSameCells(
      'reviewed-scene-pixels',
      image,
      decodePng(readFileSync(imagePath)),
      grid,
      EXACT
    );
  });
}
