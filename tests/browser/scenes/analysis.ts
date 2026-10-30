/**
 * Pixel analysis for the option/appearance lane (Node side). Everything works
 * on decoded RGBA; nothing here knows how ghostty-web draws.
 */

import { type Image, type Rect, parseHex } from '../support/pixels';

/** True when any channel differs from `background` by more than `threshold`. */
function isInk(
  image: Image,
  x: number,
  y: number,
  bg: [number, number, number],
  threshold: number
) {
  const i = (y * image.width + x) * 4;
  return (
    Math.abs(image.data[i] - bg[0]) > threshold ||
    Math.abs(image.data[i + 1] - bg[1]) > threshold ||
    Math.abs(image.data[i + 2] - bg[2]) > threshold
  );
}

/** Bounding box of ink inside `rect`, or undefined when the rect is blank. */
export function inkBox(
  image: Image,
  rect: Rect,
  background: string,
  threshold = 24
): Rect | undefined {
  const bg = parseHex(background);
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = -1;
  let y1 = -1;
  for (let y = rect.y0; y < rect.y1; y++) {
    for (let x = rect.x0; x < rect.x1; x++) {
      if (!isInk(image, x, y, bg, threshold)) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + 1);
      y1 = Math.max(y1, y + 1);
    }
  }
  return x1 < 0 ? undefined : { x0, y0, x1, y1 };
}

/**
 * Translation-invariant glyph comparison: crop both ink boxes and compare the
 * pixels inside them. Returns undefined when identical (within `tolerance`),
 * otherwise a short reason.
 */
export function compareInk(
  a: Image,
  aRect: Rect,
  b: Image,
  bRect: Rect,
  background: string,
  tolerance = 0
): string | undefined {
  const boxA = inkBox(a, aRect, background);
  const boxB = inkBox(b, bRect, background);
  if (!boxA || !boxB) return `ink ${boxA ? 'present' : 'absent'} vs ${boxB ? 'present' : 'absent'}`;
  const w = boxA.x1 - boxA.x0;
  const h = boxA.y1 - boxA.y0;
  if (w !== boxB.x1 - boxB.x0 || h !== boxB.y1 - boxB.y0) {
    return `ink box ${w}x${h} vs ${boxB.x1 - boxB.x0}x${boxB.y1 - boxB.y0}`;
  }
  let differing = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((boxA.y0 + y) * a.width + boxA.x0 + x) * 4;
      const j = ((boxB.y0 + y) * b.width + boxB.x0 + x) * 4;
      for (let k = 0; k < 3; k++) {
        if (Math.abs(a.data[i + k] - b.data[j + k]) > tolerance) {
          differing++;
          break;
        }
      }
    }
  }
  return differing === 0 ? undefined : `${differing} of ${w * h} ink-box pixels differ`;
}
