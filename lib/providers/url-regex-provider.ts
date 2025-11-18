/**
 * URL Regex Link Provider
 *
 * Detects plain text URLs using regex pattern matching.
 * Uses RFC-compliant patterns for robust URL detection.
 *
 * This provider runs after OSC8LinkProvider, so explicit hyperlinks
 * take precedence over regex-detected URLs.
 */

import type { IBufferRange, ILink, ILinkProvider } from '../types';

/**
 * URL Regex Provider
 *
 * Detects plain text HTTP(S) URLs on a single line using regex.
 * Does not support multi-line URLs or file paths.
 *
 * Features:
 * - Matches http:// and https:// URLs
 * - Excludes unsafe characters per RFC3986 and RFC1738
 * - Properly handles trailing punctuation and brackets
 * - Validates URLs using the URL constructor
 *
 * Supported protocols:
 * - https://, http://
 *
 * Character exclusions:
 * - Unsafe from RFC3986: !*'()
 * - Unsafe from RFC1738: {}|\^~[]` (except ~ which is allowed)
 * - Final punctuation: ,.!?
 * - Brackets: ()[]{}<>
 */
export class UrlRegexProvider implements ILinkProvider {
  /**
   * URL regex pattern
   *
   * Matches everything starting with http:// or https://
   * up to first whitespace, quote, or excluded character.
   *
   * The pattern uses negative character classes to exclude:
   * - Whitespace and quotes
   * - Unsafe RFC characters
   * - Common trailing punctuation
   */
  private static readonly URL_REGEX =
    /(https?|HTTPS?):[/]{2}[^\s"'!*(){}|\\^<>`]*[^\s"':,.!?{}|\\^~\[\]`()<>]/g;

  constructor(private terminal: ITerminalForUrlProvider) {}

  /**
   * Validate that a matched string is a proper URL
   *
   * Uses the URL constructor to validate the URL format.
   * Also checks that the URL starts with the parsed protocol+host
   * to avoid false positives.
   */
  private isUrl(urlString: string): boolean {
    try {
      const url = new URL(urlString);
      const parsedBase =
        url.password && url.username
          ? `${url.protocol}//${url.username}:${url.password}@${url.host}`
          : url.username
            ? `${url.protocol}//${url.username}@${url.host}`
            : `${url.protocol}//${url.host}`;
      return urlString.toLowerCase().startsWith(parsedBase.toLowerCase());
    } catch {
      return false;
    }
  }

  /**
   * Provide all regex-detected URLs on the given row
   */
  provideLinks(y: number, callback: (links: ILink[] | undefined) => void): void {
    const links: ILink[] = [];

    const line = this.terminal.buffer.active.getLine(y);
    if (!line) {
      callback(undefined);
      return;
    }

    // Convert line cells to text
    const lineText = this.lineToText(line);

    // Reset regex state (global flag maintains state)
    UrlRegexProvider.URL_REGEX.lastIndex = 0;

    // Find all URL matches in the line
    let match: RegExpExecArray | null = UrlRegexProvider.URL_REGEX.exec(lineText);
    while (match !== null) {
      const url = match[0];

      // Validate that the matched text is a proper URL
      if (!this.isUrl(url)) {
        match = UrlRegexProvider.URL_REGEX.exec(lineText);
        continue;
      }

      const startX = match.index;
      const endX = match.index + url.length - 1; // Inclusive end

      links.push({
        text: url,
        range: {
          start: { x: startX, y },
          end: { x: endX, y },
        },
        activate: (event) => {
          // Open link if Ctrl/Cmd is pressed
          if (event.ctrlKey || event.metaKey) {
            window.open(url, '_blank', 'noopener,noreferrer');
          }
        },
      });

      // Get next match
      match = UrlRegexProvider.URL_REGEX.exec(lineText);
    }

    callback(links.length > 0 ? links : undefined);
  }

  /**
   * Convert a buffer line to plain text string
   */
  private lineToText(line: IBufferLineForUrlProvider): string {
    const chars: string[] = [];

    for (let x = 0; x < line.length; x++) {
      const cell = line.getCell(x);
      if (!cell) {
        chars.push(' ');
        continue;
      }

      const codepoint = cell.getCodepoint();
      // Skip null characters and control characters
      if (codepoint === 0 || codepoint < 32) {
        chars.push(' ');
      } else {
        chars.push(String.fromCodePoint(codepoint));
      }
    }

    return chars.join('');
  }

  dispose(): void {
    // No resources to clean up
  }
}

/**
 * Minimal terminal interface required by UrlRegexProvider
 */
export interface ITerminalForUrlProvider {
  buffer: {
    active: {
      getLine(y: number): IBufferLineForUrlProvider | undefined;
    };
  };
}

/**
 * Minimal buffer line interface for URL detection
 */
interface IBufferLineForUrlProvider {
  length: number;
  getCell(x: number):
    | {
        getCodepoint(): number;
      }
    | undefined;
}
