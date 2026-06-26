import { describe, expect, test } from 'bun:test';
import { injectAfterHeader, renderEditorial } from './sections';

describe('renderEditorial', () => {
  test('renders flattened summary and linked highlights', () => {
    expect(
      renderEditorial({
        summary: 'First line\n## not a heading',
        highlights: [
          { text: 'Adds rendering fix\nwith details', prNumber: 42 },
          { text: 'No PR link', prNumber: null },
        ],
      })
    ).toBe(
      'First line ## not a heading\n\n**Highlights**\n\n- Adds rendering fix with details (#42)\n- No PR link'
    );
  });

  test('omits an empty highlight list', () => {
    expect(renderEditorial({ summary: 'Only summary', highlights: [] })).toBe('Only summary');
  });
});

describe('injectAfterHeader', () => {
  test('injects editorial notes immediately below the version heading', () => {
    expect(injectAfterHeader('## [1.0.0](link)\n\n### Features\n- one', 'Summary')).toBe(
      '## [1.0.0](link)\n\nSummary\n\n### Features\n- one'
    );
  });

  test('falls back safely when release-please notes have no heading', () => {
    expect(injectAfterHeader('### Features\n- one', 'Summary')).toBe(
      'Summary\n\n### Features\n- one'
    );
  });
});
