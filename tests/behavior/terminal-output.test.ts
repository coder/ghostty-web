/** Feed real terminal input and assert the resulting screen and cursor. */
import { describe, expect, test } from 'bun:test';
import fixtures from '../regression/fixtures/vt.json';
import { screenLines, withTerminal } from './session';

for (const fixture of fixtures) {
  describe(fixture.description, () => {
    for (const delivery of ['whole', 'fragmented'] as const) {
      test(`${fixture.id}: ${delivery} input`, async () => {
        // Exercise both single-byte boundaries and packets containing complete
        // sequences alongside incomplete UTF-8 or escape sequences.
        const schedules = delivery === 'whole' ? [null] : [[1], [1, 3, 2, 5]];
        for (const sizes of schedules) {
          await withTerminal({ cols: fixture.cols, rows: fixture.rows }, (terminal) => {
            if (sizes === null) terminal.write(fixture.input);
            else {
              const bytes = new TextEncoder().encode(fixture.input);
              let offset = 0;
              let packet = 0;
              while (offset < bytes.length) {
                const end = Math.min(bytes.length, offset + sizes[packet++ % sizes.length]);
                terminal.write(bytes.subarray(offset, end));
                offset = end;
              }
            }
            expect(screenLines(terminal)).toEqual(fixture.expectedLines);
            if (fixture.expectedCursor) {
              const { x, y } = terminal.wasmTerm!.getCursor();
              expect({ x, y }).toEqual(fixture.expectedCursor);
            }
          });
        }
      });
    }
  });
}
