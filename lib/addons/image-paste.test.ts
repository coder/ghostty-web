/**
 * Test suite for ImagePasteAddon
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ImagePasteAddon } from './image-paste';

// ============================================================================
// Mock Terminal Implementation
// ============================================================================

class MockTerminal {
  public element?: HTMLElement;
  public cols = 80;
  public rows = 24;
}

// ============================================================================
// Test Suite
// ============================================================================

describe('ImagePasteAddon', () => {
  let addon: ImagePasteAddon;
  let terminal: MockTerminal;

  beforeEach(() => {
    addon = new ImagePasteAddon();
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

  test('activates with element and attaches paste listener', () => {
    terminal.element = document.createElement('div');
    expect(() => addon.activate(terminal as any)).not.toThrow();
  });

  test('disposes successfully', () => {
    addon.activate(terminal as any);
    expect(() => addon.dispose()).not.toThrow();
  });

  test('disposes with element cleans up listener', () => {
    terminal.element = document.createElement('div');
    addon.activate(terminal as any);
    expect(() => addon.dispose()).not.toThrow();
  });

  test('can activate and dispose multiple times', () => {
    addon.activate(terminal as any);
    addon.dispose();
    addon = new ImagePasteAddon();
    addon.activate(terminal as any);
    addon.dispose();
  });

  // ==========================================================================
  // Event Tests
  // ==========================================================================

  test('onImagePaste is a subscribable event', () => {
    const disposable = addon.onImagePaste(() => {});
    expect(disposable).toBeDefined();
    expect(typeof disposable.dispose).toBe('function');
    disposable.dispose();
  });

  test('fires onImagePaste when image is pasted', (done) => {
    terminal.element = document.createElement('div');
    addon.activate(terminal as any);

    addon.onImagePaste((data) => {
      expect(data.name).toMatch(/^clipboard_\d+\.png$/);
      expect(data.dataBase64).toBe('aW1hZ2VkYXRh');
      done();
    });

    // Create a mock paste event with an image file
    const mockFile = new File(['imagedata'], 'test.png', { type: 'image/png' });

    // Mock FileReader to return synchronously for testing
    const originalFileReader = globalThis.FileReader;
    class MockFileReader {
      onload: (() => void) | null = null;
      result: string | null = null;

      readAsDataURL(_file: File) {
        this.result = 'data:image/png;base64,aW1hZ2VkYXRh';
        if (this.onload) this.onload();
      }
    }
    globalThis.FileReader = MockFileReader as any;

    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(mockFile);

    const pasteEvent = new ClipboardEvent('paste', {
      clipboardData: dataTransfer,
      bubbles: true,
      cancelable: true,
    });

    terminal.element.dispatchEvent(pasteEvent);

    // Restore
    globalThis.FileReader = originalFileReader;
  });

  test('does not fire for non-image pastes', () => {
    terminal.element = document.createElement('div');
    addon.activate(terminal as any);

    let fired = false;
    addon.onImagePaste(() => {
      fired = true;
    });

    // Paste event with only text
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/plain', 'hello');

    const pasteEvent = new ClipboardEvent('paste', {
      clipboardData: dataTransfer,
      bubbles: true,
      cancelable: true,
    });

    terminal.element.dispatchEvent(pasteEvent);
    expect(fired).toBe(false);
  });

  test('dispose removes paste listener', () => {
    terminal.element = document.createElement('div');
    addon.activate(terminal as any);

    let fired = false;
    addon.onImagePaste(() => {
      fired = true;
    });

    addon.dispose();

    // Dispatch after dispose - should not fire
    const mockFile = new File(['imagedata'], 'test.png', { type: 'image/png' });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(mockFile);

    const pasteEvent = new ClipboardEvent('paste', {
      clipboardData: dataTransfer,
      bubbles: true,
      cancelable: true,
    });

    terminal.element.dispatchEvent(pasteEvent);
    expect(fired).toBe(false);
  });

  // ==========================================================================
  // Integration Tests
  // ==========================================================================

  test('full workflow: activate → subscribe → dispose', () => {
    terminal.element = document.createElement('div');
    addon.activate(terminal as any);

    const disposable = addon.onImagePaste(() => {});
    disposable.dispose();

    addon.dispose();
  });
});
