/**
 * Comprehensive test suite for FitAddon
 *
 * Note: Most FitAddon tests require DOM APIs (document, window, getComputedStyle).
 * These tests focus on basic functionality that doesn't require DOM.
 * For full integration tests, see examples/terminal-demo.html
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { FitAddon } from './fit';

// ============================================================================
// Mock Terminal Implementation
// ============================================================================

class MockTerminal {
  public element?: HTMLElement;
  public cols = 80;
  public rows = 24;
  public renderer = {
    getMetrics: () => ({ width: 9, height: 16, baseline: 12 }),
  };

  public resize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
  }
}

// ============================================================================
// Test Suite
// ============================================================================

describe('FitAddon', () => {
  let addon: FitAddon;
  let terminal: MockTerminal;

  beforeEach(() => {
    addon = new FitAddon();
    terminal = new MockTerminal();
  });

  afterEach(() => {
    addon.dispose();
  });

  // ==========================================================================
  // Activation & Disposal Tests
  // ==========================================================================

  test('activates successfully', () => {
    expect(() => addon.activate(terminal as any)).not.toThrow();
  });

  test('disposes successfully', () => {
    addon.activate(terminal as any);
    expect(() => addon.dispose()).not.toThrow();
  });

  test('can activate and dispose multiple times', () => {
    addon.activate(terminal as any);
    addon.dispose();
    addon.activate(terminal as any);
    addon.dispose();
  });

  // ==========================================================================
  // proposeDimensions() Tests
  // ==========================================================================

  test('proposeDimensions returns undefined without element', () => {
    addon.activate(terminal as any);
    const dims = addon.proposeDimensions();
    expect(dims).toBeUndefined();
  });

  test('proposeDimensions returns undefined without renderer', () => {
    // Remove renderer
    (terminal as any).renderer = undefined;
    terminal.element = {} as HTMLElement;
    addon.activate(terminal as any);

    const dims = addon.proposeDimensions();
    expect(dims).toBeUndefined();
  });

  // ==========================================================================
  // fit() Tests
  // ==========================================================================

  test('fit() does nothing without element', () => {
    addon.activate(terminal as any);
    const originalCols = terminal.cols;
    const originalRows = terminal.rows;

    addon.fit();

    expect(terminal.cols).toBe(originalCols);
    expect(terminal.rows).toBe(originalRows);
  });

  // ==========================================================================
  // observeResize() Tests
  // ==========================================================================

  test('observeResize() does not throw without element', () => {
    addon.activate(terminal as any);
    expect(() => addon.observeResize()).not.toThrow();
  });

  // ==========================================================================
  // Integration Tests
  // ==========================================================================

  test('fit() after dispose does nothing', () => {
    addon.activate(terminal as any);
    addon.dispose();

    const originalCols = terminal.cols;
    const originalRows = terminal.rows;

    addon.fit();

    expect(terminal.cols).toBe(originalCols);
    expect(terminal.rows).toBe(originalRows);
  });
});

// ==========================================================================
// Dimension Calculation Tests
// ==========================================================================

describe('Dimension Calculation', () => {
  let addon: FitAddon;

  beforeEach(() => {
    addon = new FitAddon();
  });

  afterEach(() => {
    addon.dispose();
  });

  test('fit() calculates correct dimensions from container', () => {
    // Create a mock element with known dimensions
    // FitAddon subtracts 15px for scrollbar, so we need to account for that
    const mockElement = document.createElement('div');
    Object.defineProperty(mockElement, 'clientWidth', { value: 900, configurable: true });
    Object.defineProperty(mockElement, 'clientHeight', { value: 480, configurable: true });

    let resizedCols = 0;
    let resizedRows = 0;

    const mockTerminal = {
      cols: 80,
      rows: 24,
      element: mockElement,
      renderer: {
        // 9px wide chars, 16px tall
        getMetrics: () => ({ width: 9, height: 16, baseline: 12 }),
      },
      resize: (cols: number, rows: number) => {
        resizedCols = cols;
        resizedRows = rows;
        mockTerminal.cols = cols;
        mockTerminal.rows = rows;
      },
    };

    addon.activate(mockTerminal as any);
    addon.fit();

    // Expected: (900 - 15 scrollbar) / 9 = 98 cols, 480 / 16 = 30 rows
    expect(resizedCols).toBe(98);
    expect(resizedRows).toBe(30);
  });

  test('proposeDimensions returns correct values', () => {
    // FitAddon subtracts 15px for scrollbar width
    const mockElement = document.createElement('div');
    Object.defineProperty(mockElement, 'clientWidth', { value: 720, configurable: true });
    Object.defineProperty(mockElement, 'clientHeight', { value: 384, configurable: true });

    const mockTerminal = {
      cols: 80,
      rows: 24,
      element: mockElement,
      renderer: {
        getMetrics: () => ({ width: 8, height: 16, baseline: 12 }),
      },
      resize: () => {},
    };

    addon.activate(mockTerminal as any);
    const dims = addon.proposeDimensions();

    // Expected: (720 - 15 scrollbar) / 8 = 88 cols, 384 / 16 = 24 rows
    expect(dims).toEqual({ cols: 88, rows: 24 });
  });
});
