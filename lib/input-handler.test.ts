/**
 * Unit tests for InputHandler
 */

import { beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { Ghostty } from './ghostty';
import { InputHandler } from './input-handler';
import { Key, KeyAction, Mods } from './types';

// Mock DOM types for testing
interface MockKeyboardEvent {
  code: string;
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  repeat: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
}

interface MockClipboardEvent {
  type: string;
  clipboardData: {
    getData: (format: string) => string;
    setData: (format: string, data: string) => void;
  } | null;
  preventDefault: () => void;
  stopPropagation: () => void;
}

interface MockHTMLElement {
  addEventListener: (event: string, handler: (e: any) => void) => void;
  removeEventListener: (event: string, handler: (e: any) => void) => void;
}

// Helper to create mock keyboard event
function createKeyEvent(
  code: string,
  key: string,
  modifiers: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } = {}
): MockKeyboardEvent {
  return {
    code,
    key,
    ctrlKey: modifiers.ctrl ?? false,
    altKey: modifiers.alt ?? false,
    shiftKey: modifiers.shift ?? false,
    metaKey: modifiers.meta ?? false,
    repeat: false,
    preventDefault: mock(() => {}),
    stopPropagation: mock(() => {}),
  };
}

// Helper to create mock clipboard event
function createClipboardEvent(text: string | null): MockClipboardEvent {
  const data = new Map<string, string>();
  if (text !== null) {
    data.set('text/plain', text);
  }

  return {
    type: 'paste',
    clipboardData:
      text !== null
        ? {
            getData: (format: string) => data.get(format) || '',
            setData: (format: string, value: string) => {
              data.set(format, value);
            },
          }
        : null,
    preventDefault: mock(() => {}),
    stopPropagation: mock(() => {}),
  };
}

// Helper to create mock container
function createMockContainer(): MockHTMLElement & {
  _listeners: Map<string, ((e: any) => void)[]>;
  dispatchEvent: (event: any) => void;
} {
  const listeners = new Map<string, ((e: any) => void)[]>();

  return {
    _listeners: listeners,
    addEventListener(event: string, handler: (e: any) => void) {
      if (!listeners.has(event)) {
        listeners.set(event, []);
      }
      listeners.get(event)!.push(handler);
    },
    removeEventListener(event: string, handler: (e: any) => void) {
      const handlers = listeners.get(event);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index >= 0) {
          handlers.splice(index, 1);
        }
      }
    },
    dispatchEvent(event: any) {
      const handlers = listeners.get(event.type) || [];
      for (const handler of handlers) {
        handler(event);
      }
    },
  };
}

// Helper to simulate key event
function simulateKey(
  container: ReturnType<typeof createMockContainer>,
  event: MockKeyboardEvent
): void {
  const handlers = container._listeners.get('keydown') || [];
  for (const handler of handlers) {
    handler(event);
  }
}

describe('InputHandler', () => {
  let ghostty: Ghostty;
  let container: ReturnType<typeof createMockContainer>;
  let dataReceived: string[];
  let bellCalled: boolean;

  beforeAll(async () => {
    // Load WASM once for all tests (expensive operation)
    // wasmPath is now optional - auto-detected
    ghostty = await Ghostty.load();
  });

  beforeEach(() => {
    // Create mock container for each test
    container = createMockContainer();

    // Reset data tracking
    dataReceived = [];
    bellCalled = false;
  });

  describe('Constructor and Lifecycle', () => {
    test('creates handler and attaches listeners', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      expect(handler.isActive()).toBe(true);
      expect(container._listeners.has('keydown')).toBe(true);
      expect(container._listeners.get('keydown')!.length).toBe(1);
    });

    test('dispose removes listeners and marks inactive', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      handler.dispose();

      expect(handler.isActive()).toBe(false);
      expect(container._listeners.get('keydown')!.length).toBe(0);
    });

    test('dispose is idempotent', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      handler.dispose();
      handler.dispose(); // Second call should not throw

      expect(handler.isActive()).toBe(false);
    });
  });

  describe('Printable Characters', () => {
    test('encodes lowercase letters', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('KeyA', 'a'));
      expect(dataReceived).toEqual(['a']);

      simulateKey(container, createKeyEvent('KeyZ', 'z'));
      expect(dataReceived).toEqual(['a', 'z']);
    });

    test('encodes uppercase letters (with shift)', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('KeyA', 'A', { shift: true }));
      expect(dataReceived).toEqual(['A']);
    });

    test('encodes digits', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('Digit0', '0'));
      simulateKey(container, createKeyEvent('Digit5', '5'));
      simulateKey(container, createKeyEvent('Digit9', '9'));

      expect(dataReceived).toEqual(['0', '5', '9']);
    });

    test('encodes punctuation', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('Comma', ','));
      simulateKey(container, createKeyEvent('Period', '.'));
      simulateKey(container, createKeyEvent('Slash', '/'));

      expect(dataReceived).toEqual([',', '.', '/']);
    });

    test('encodes space', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('Space', ' '));
      expect(dataReceived).toEqual([' ']);
    });
  });

  describe('Control Characters', () => {
    test('encodes Ctrl+A', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('KeyA', 'a', { ctrl: true }));

      expect(dataReceived.length).toBe(1);
      // Ctrl+A should produce 0x01
      expect(dataReceived[0].charCodeAt(0)).toBe(0x01);
    });

    test('encodes Ctrl+C', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('KeyC', 'c', { ctrl: true }));

      expect(dataReceived.length).toBe(1);
      // Ctrl+C should produce 0x03
      expect(dataReceived[0].charCodeAt(0)).toBe(0x03);
    });

    test('encodes Ctrl+D', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('KeyD', 'd', { ctrl: true }));

      expect(dataReceived.length).toBe(1);
      // Ctrl+D should produce 0x04
      expect(dataReceived[0].charCodeAt(0)).toBe(0x04);
    });

    test('encodes Ctrl+Z', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('KeyZ', 'z', { ctrl: true }));

      expect(dataReceived.length).toBe(1);
      // Ctrl+Z should produce 0x1A (26)
      expect(dataReceived[0].charCodeAt(0)).toBe(0x1a);
    });

    test('Cmd+C allows copy (no data sent)', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('KeyC', 'c', { meta: true }));

      // Cmd+C should NOT send data - it should allow copy operation
      // SelectionManager handles the actual copying
      expect(dataReceived.length).toBe(0);
    });
  });

  describe('Special Keys', () => {
    test('encodes Enter', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('Enter', 'Enter'));

      expect(dataReceived.length).toBe(1);
      // Enter should produce \r (0x0D)
      expect(dataReceived[0]).toBe('\r');
    });

    test('encodes Tab', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('Tab', 'Tab'));

      expect(dataReceived.length).toBe(1);
      // Tab should produce \t (0x09)
      expect(dataReceived[0]).toBe('\t');
    });

    test('encodes Escape', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('Escape', 'Escape'));

      expect(dataReceived.length).toBe(1);
      // Escape should produce ESC (0x1B)
      expect(dataReceived[0].charCodeAt(0)).toBe(0x1b);
    });

    test('encodes Backspace', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('Backspace', 'Backspace'));

      expect(dataReceived.length).toBe(1);
      // Backspace should produce 0x7F (DEL) or 0x08 (BS)
      const code = dataReceived[0].charCodeAt(0);
      expect(code === 0x7f || code === 0x08).toBe(true);
    });
  });

  describe('Arrow Keys', () => {
    test('encodes Up arrow', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('ArrowUp', 'ArrowUp'));

      expect(dataReceived.length).toBe(1);
      // Arrow keys produce ESC[A, ESC[B, ESC[C, ESC[D or ESCOA, ESCOB, ESCOC, ESCOD
      expect(dataReceived[0]).toMatch(/\x1b(\[A|OA)/);
    });

    test('encodes Down arrow', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('ArrowDown', 'ArrowDown'));

      expect(dataReceived.length).toBe(1);
      expect(dataReceived[0]).toMatch(/\x1b(\[B|OB)/);
    });

    test('encodes Left arrow', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('ArrowLeft', 'ArrowLeft'));

      expect(dataReceived.length).toBe(1);
      expect(dataReceived[0]).toMatch(/\x1b(\[D|OD)/);
    });

    test('encodes Right arrow', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('ArrowRight', 'ArrowRight'));

      expect(dataReceived.length).toBe(1);
      expect(dataReceived[0]).toMatch(/\x1b(\[C|OC)/);
    });
  });

  describe('Function Keys', () => {
    test('encodes F1', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('F1', 'F1'));

      expect(dataReceived.length).toBe(1);
      // F1 produces ESC[11~ or ESCOP
      expect(dataReceived[0]).toMatch(/\x1b(\[11~|OP)/);
    });

    test('encodes F12', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('F12', 'F12'));

      expect(dataReceived.length).toBe(1);
      // F12 produces ESC[24~
      expect(dataReceived[0].includes('\x1b')).toBe(true);
    });
  });

  describe('Navigation Keys', () => {
    test('encodes Home', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('Home', 'Home'));

      expect(dataReceived.length).toBe(1);
      expect(dataReceived[0].includes('\x1b')).toBe(true);
    });

    test('encodes End', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('End', 'End'));

      expect(dataReceived.length).toBe(1);
      expect(dataReceived[0].includes('\x1b')).toBe(true);
    });

    test('encodes PageUp', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('PageUp', 'PageUp'));

      expect(dataReceived.length).toBe(1);
      expect(dataReceived[0].includes('\x1b')).toBe(true);
    });

    test('encodes PageDown', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('PageDown', 'PageDown'));

      expect(dataReceived.length).toBe(1);
      expect(dataReceived[0].includes('\x1b')).toBe(true);
    });

    test('encodes Delete', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('Delete', 'Delete'));

      expect(dataReceived.length).toBe(1);
      expect(dataReceived[0].includes('\x1b')).toBe(true);
    });

    test('encodes Insert', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('Insert', 'Insert'));

      expect(dataReceived.length).toBe(1);
      expect(dataReceived[0].includes('\x1b')).toBe(true);
    });
  });

  describe('Event Prevention', () => {
    test('prevents default on printable characters', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      const event = createKeyEvent('KeyA', 'a');
      simulateKey(container, event);

      expect(event.preventDefault).toHaveBeenCalled();
    });

    test('prevents default on special keys', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      const event = createKeyEvent('Enter', 'Enter');
      simulateKey(container, event);

      expect(event.preventDefault).toHaveBeenCalled();
    });

    test('prevents default on Ctrl+keys', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      const event = createKeyEvent('KeyC', 'c', { ctrl: true });
      simulateKey(container, event);

      expect(event.preventDefault).toHaveBeenCalled();
    });
  });

  describe('Unknown Keys', () => {
    test('ignores unmapped keys', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      // Simulate a key that's not in KEY_MAP
      simulateKey(container, createKeyEvent('Unknown', 'Unknown'));

      // Should not crash or produce output
      expect(dataReceived.length).toBe(0);
    });
  });

  describe('Modifier Combinations', () => {
    test('handles Ctrl+Shift combinations', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('KeyA', 'A', { ctrl: true, shift: true }));

      expect(dataReceived.length).toBe(1);
      // Should still encode something
      expect(dataReceived[0].length).toBeGreaterThan(0);
    });

    test('handles Alt combinations', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      simulateKey(container, createKeyEvent('KeyA', 'a', { alt: true }));

      expect(dataReceived.length).toBe(1);
      // Alt+A often produces ESC a or similar
      expect(dataReceived[0].length).toBeGreaterThan(0);
    });
  });

  describe('Clipboard Operations', () => {
    test('handles paste event', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      const pasteText = 'Hello, World!';
      const pasteEvent = createClipboardEvent(pasteText);

      container.dispatchEvent(pasteEvent);

      expect(dataReceived.length).toBe(1);
      expect(dataReceived[0]).toBe(pasteText);
    });

    test('handles multi-line paste', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      const pasteText = 'Line 1\nLine 2\nLine 3';
      const pasteEvent = createClipboardEvent(pasteText);

      container.dispatchEvent(pasteEvent);

      expect(dataReceived.length).toBe(1);
      expect(dataReceived[0]).toBe(pasteText);
    });

    test('ignores paste with no clipboard data', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      const pasteEvent = createClipboardEvent(null);

      container.dispatchEvent(pasteEvent);

      expect(dataReceived.length).toBe(0);
    });

    test('ignores paste with empty text', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      const pasteEvent = createClipboardEvent('');

      container.dispatchEvent(pasteEvent);

      expect(dataReceived.length).toBe(0);
    });

    test('allows Ctrl+V to trigger paste', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      // Ctrl+V should NOT call onData callback (lets paste event handle it)
      simulateKey(container, createKeyEvent('KeyV', 'v', { ctrl: true }));

      expect(dataReceived.length).toBe(0);
    });

    test('allows Cmd+V to trigger paste', () => {
      const handler = new InputHandler(
        ghostty,
        container as any,
        (data) => dataReceived.push(data),
        () => {
          bellCalled = true;
        }
      );

      // Cmd+V should NOT call onData callback (lets paste event handle it)
      simulateKey(container, createKeyEvent('KeyV', 'v', { meta: true }));

      expect(dataReceived.length).toBe(0);
    });
  });
});
