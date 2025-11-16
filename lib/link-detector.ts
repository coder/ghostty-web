/**
 * Link detection and caching system
 *
 * The LinkDetector coordinates between multiple link providers and caches
 * results for performance. It uses hyperlink_id for intelligent caching
 * since the same hyperlink_id always represents the same link.
 */

import type { IBufferCellPosition, ILink, ILinkProvider } from './types';

/**
 * Manages link detection across multiple providers with intelligent caching
 */
export class LinkDetector {
  private providers: ILinkProvider[] = [];

  // Cache links by hyperlink_id for fast lookups
  // Key format: `h${hyperlinkId}` for OSC 8 links
  // Key format: `r${row}:${startX}-${endX}` for regex links (future)
  private linkCache = new Map<string, ILink>();

  // Track which rows have been scanned to avoid redundant provider calls
  private scannedRows = new Set<number>();

  // Terminal instance for buffer access
  constructor(private terminal: ITerminalForLinkDetector) {}

  /**
   * Register a link provider
   */
  registerProvider(provider: ILinkProvider): void {
    this.providers.push(provider);
    this.invalidateCache(); // New provider may detect different links
  }

  /**
   * Get link at the specified buffer position
   * @param col Column (0-based)
   * @param row Absolute row in buffer (0-based)
   * @returns Link at position, or undefined if none
   */
  async getLinkAt(col: number, row: number): Promise<ILink | undefined> {
    // First, check if this cell has a hyperlink_id (fast path for OSC 8)
    const line = this.terminal.buffer.active.getLine(row);
    if (!line || col < 0 || col >= line.length) {
      return undefined;
    }

    const cell = line.getCell(col);
    if (!cell) {
      return undefined;
    }
    const hyperlinkId = cell.getHyperlinkId();

    if (hyperlinkId > 0) {
      // Fast path: check cache by hyperlink_id
      const cacheKey = `h${hyperlinkId}`;
      if (this.linkCache.has(cacheKey)) {
        return this.linkCache.get(cacheKey);
      }
    }

    // Slow path: scan this row if not already scanned
    if (!this.scannedRows.has(row)) {
      await this.scanRow(row);
    }

    // Check cache again (hyperlinkId or position-based)
    if (hyperlinkId > 0) {
      const cacheKey = `h${hyperlinkId}`;
      const link = this.linkCache.get(cacheKey);
      if (link) return link;
    }

    // Check if any cached link contains this position
    for (const link of this.linkCache.values()) {
      if (this.isPositionInLink(col, row, link)) {
        return link;
      }
    }

    return undefined;
  }

  /**
   * Scan a row for links using all registered providers
   */
  private async scanRow(row: number): Promise<void> {
    this.scannedRows.add(row);

    const allLinks: ILink[] = [];

    // Query all providers
    for (const provider of this.providers) {
      const links = await new Promise<ILink[] | undefined>((resolve) => {
        provider.provideLinks(row, resolve);
      });

      if (links) {
        allLinks.push(...links);
      }
    }

    // Cache all discovered links
    for (const link of allLinks) {
      this.cacheLink(link);
    }
  }

  /**
   * Cache a link for fast lookup
   */
  private cacheLink(link: ILink): void {
    // Try to get hyperlink_id for this link
    const { start } = link.range;
    const line = this.terminal.buffer.active.getLine(start.y);
    if (line) {
      const cell = line.getCell(start.x);
      if (!cell) {
        // Fallback: cache by position range
        const { start: s, end: e } = link.range;
        const cacheKey = `r${s.y}:${s.x}-${e.x}`;
        this.linkCache.set(cacheKey, link);
        return;
      }
      const hyperlinkId = cell.getHyperlinkId();

      if (hyperlinkId > 0) {
        // Cache by hyperlink_id (best case - stable across rows)
        this.linkCache.set(`h${hyperlinkId}`, link);
        return;
      }
    }

    // Fallback: cache by position range
    // Format: r${row}:${startX}-${endX}
    const { start: s, end: e } = link.range;
    const cacheKey = `r${s.y}:${s.x}-${e.x}`;
    this.linkCache.set(cacheKey, link);
  }

  /**
   * Check if a position is within a link's range
   */
  private isPositionInLink(col: number, row: number, link: ILink): boolean {
    const { start, end } = link.range;

    // Check if row is in range
    if (row < start.y || row > end.y) {
      return false;
    }

    // Single-line link
    if (start.y === end.y) {
      return col >= start.x && col <= end.x;
    }

    // Multi-line link
    if (row === start.y) {
      return col >= start.x; // First line: from start.x to end of line
    } else if (row === end.y) {
      return col <= end.x; // Last line: from start of line to end.x
    } else {
      return true; // Middle line: entire line is part of link
    }
  }

  /**
   * Invalidate cache when terminal content changes
   * Should be called on terminal write, resize, or clear
   */
  invalidateCache(): void {
    this.linkCache.clear();
    this.scannedRows.clear();
  }

  /**
   * Invalidate cache for specific rows
   * Used when only part of the terminal changed
   */
  invalidateRows(startRow: number, endRow: number): void {
    // Remove scanned markers
    for (let row = startRow; row <= endRow; row++) {
      this.scannedRows.delete(row);
    }

    // Remove cached links in this range
    // This is conservative - we remove any link that touches these rows
    const toDelete: string[] = [];
    for (const [key, link] of this.linkCache.entries()) {
      const { start, end } = link.range;
      if (
        (start.y >= startRow && start.y <= endRow) ||
        (end.y >= startRow && end.y <= endRow) ||
        (start.y < startRow && end.y > endRow)
      ) {
        toDelete.push(key);
      }
    }

    for (const key of toDelete) {
      this.linkCache.delete(key);
    }
  }

  /**
   * Dispose and cleanup
   */
  dispose(): void {
    this.linkCache.clear();
    this.scannedRows.clear();

    // Dispose all providers
    for (const provider of this.providers) {
      provider.dispose?.();
    }
    this.providers = [];
  }
}

/**
 * Minimal terminal interface required by LinkDetector
 * Keeps coupling low and testing easy
 */
export interface ITerminalForLinkDetector {
  buffer: {
    active: {
      getLine(y: number):
        | {
            length: number;
            getCell(x: number):
              | {
                  getHyperlinkId(): number;
                }
              | undefined;
          }
        | undefined;
    };
  };
}
