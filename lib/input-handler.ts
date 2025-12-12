/**
 * InputHandler - Converts browser keyboard events to terminal input
 *
 * Handles:
 * - Keyboard event listening on a container element
 * - Mapping KeyboardEvent.code to USB HID Key codes
 * - Extracting modifier keys (Ctrl, Alt, Shift, Meta)
 * - Encoding keys using Ghostty's KeyEncoder
 * - Emitting data for Terminal to send to PTY
 *
 * Limitations:
 * - Does not handle IME/composition events (CJK input) - to be added later
 * - Captures all keyboard input (preventDefault on everything)
 */

import type { Ghostty } from './ghostty';
import type { KeyEncoder } from './ghostty';
import type { IKeyEvent } from './interfaces';
import { Key, KeyAction, KeyEncoderOption, Mods } from './types';

/**
 * Map KeyboardEvent.code values to USB HID Key enum values
 * Based on: https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code
 */
const KEY_MAP: Record<string, Key> = {
  // Letters
  KeyA: Key.A,
  KeyB: Key.B,
  KeyC: Key.C,
  KeyD: Key.D,
  KeyE: Key.E,
  KeyF: Key.F,
  KeyG: Key.G,
  KeyH: Key.H,
  KeyI: Key.I,
  KeyJ: Key.J,
  KeyK: Key.K,
  KeyL: Key.L,
  KeyM: Key.M,
  KeyN: Key.N,
  KeyO: Key.O,
  KeyP: Key.P,
  KeyQ: Key.Q,
  KeyR: Key.R,
  KeyS: Key.S,
  KeyT: Key.T,
  KeyU: Key.U,
  KeyV: Key.V,
  KeyW: Key.W,
  KeyX: Key.X,
  KeyY: Key.Y,
  KeyZ: Key.Z,

  // Numbers
  Digit1: Key.ONE,
  Digit2: Key.TWO,
  Digit3: Key.THREE,
  Digit4: Key.FOUR,
  Digit5: Key.FIVE,
  Digit6: Key.SIX,
  Digit7: Key.SEVEN,
  Digit8: Key.EIGHT,
  Digit9: Key.NINE,
  Digit0: Key.ZERO,

  // Special keys
  Enter: Key.ENTER,
  Escape: Key.ESCAPE,
  Backspace: Key.BACKSPACE,
  Tab: Key.TAB,
  Space: Key.SPACE,

  // Punctuation
  Minus: Key.MINUS,
  Equal: Key.EQUAL,
  BracketLeft: Key.BRACKET_LEFT,
  BracketRight: Key.BRACKET_RIGHT,
  Backslash: Key.BACKSLASH,
  Semicolon: Key.SEMICOLON,
  Quote: Key.QUOTE,
  Backquote: Key.GRAVE,
  Comma: Key.COMMA,
  Period: Key.PERIOD,
  Slash: Key.SLASH,

  // Function keys
  CapsLock: Key.CAPS_LOCK,
  F1: Key.F1,
  F2: Key.F2,
  F3: Key.F3,
  F4: Key.F4,
  F5: Key.F5,
  F6: Key.F6,
  F7: Key.F7,
  F8: Key.F8,
  F9: Key.F9,
  F10: Key.F10,
  F11: Key.F11,
  F12: Key.F12,

  // Special function keys
  PrintScreen: Key.PRINT_SCREEN,
  ScrollLock: Key.SCROLL_LOCK,
  Pause: Key.PAUSE,
  Insert: Key.INSERT,
  Home: Key.HOME,
  PageUp: Key.PAGE_UP,
  Delete: Key.DELETE,
  End: Key.END,
  PageDown: Key.PAGE_DOWN,

  // Arrow keys
  ArrowRight: Key.RIGHT,
  ArrowLeft: Key.LEFT,
  ArrowDown: Key.DOWN,
  ArrowUp: Key.UP,

  // Keypad
  NumLock: Key.NUM_LOCK,
  NumpadDivide: Key.KP_DIVIDE,
  NumpadMultiply: Key.KP_MULTIPLY,
  NumpadSubtract: Key.KP_MINUS,
  NumpadAdd: Key.KP_PLUS,
  NumpadEnter: Key.KP_ENTER,
  Numpad1: Key.KP_1,
  Numpad2: Key.KP_2,
  Numpad3: Key.KP_3,
  Numpad4: Key.KP_4,
  Numpad5: Key.KP_5,
  Numpad6: Key.KP_6,
  Numpad7: Key.KP_7,
  Numpad8: Key.KP_8,
  Numpad9: Key.KP_9,
  Numpad0: Key.KP_0,
  NumpadDecimal: Key.KP_PERIOD,

  // International
  IntlBackslash: Key.INTL_BACKSLASH,
  ContextMenu: Key.CONTEXT_MENU,

  // Additional function keys
  F13: Key.F13,
  F14: Key.F14,
  F15: Key.F15,
  F16: Key.F16,
  F17: Key.F17,
  F18: Key.F18,
  F19: Key.F19,
  F20: Key.F20,
  F21: Key.F21,
  F22: Key.F22,
  F23: Key.F23,
  F24: Key.F24,
};

/**
 * InputHandler class
 * Attaches keyboard event listeners to a container and converts
 * keyboard events to terminal input data
 */
export class InputHandler {
  private encoder: KeyEncoder;
  private container: HTMLElement;
  private onDataCallback: (data: string) => void;
  private onBellCallback: () => void;
  private onKeyCallback?: (keyEvent: IKeyEvent) => void;
  private customKeyEventHandler?: (event: KeyboardEvent) => boolean;
  private getModeCallback?: (mode: number) => boolean;
  private keydownListener: ((e: KeyboardEvent) => void) | null = null;
  private keypressListener: ((e: KeyboardEvent) => void) | null = null;
  private pasteListener: ((e: ClipboardEvent) => void) | null = null;
  private compositionStartListener: ((e: CompositionEvent) => void) | null = null;
  private compositionUpdateListener: ((e: CompositionEvent) => void) | null = null;
  private compositionEndListener: ((e: CompositionEvent) => void) | null = null;
  private isComposing = false;
  private isDisposed = false;

  /**
   * Create a new InputHandler
   * @param ghostty - Ghostty instance (for creating KeyEncoder)
   * @param container - DOM element to attach listeners to
   * @param onData - Callback for terminal data (escape sequences to send to PTY)
   * @param onBell - Callback for bell/beep event
   * @param onKey - Optional callback for raw key events
   * @param customKeyEventHandler - Optional custom key event handler
   * @param getMode - Optional callback to query terminal mode state (for application cursor mode)
   */
  constructor(
    ghostty: Ghostty,
    container: HTMLElement,
    onData: (data: string) => void,
    onBell: () => void,
    onKey?: (keyEvent: IKeyEvent) => void,
    customKeyEventHandler?: (event: KeyboardEvent) => boolean,
    getMode?: (mode: number) => boolean
  ) {
    this.encoder = ghostty.createKeyEncoder();
    this.container = container;
    this.onDataCallback = onData;
    this.onBellCallback = onBell;
    this.onKeyCallback = onKey;
    this.customKeyEventHandler = customKeyEventHandler;
    this.getModeCallback = getMode;

    // Attach event listeners
    this.attach();
  }

  /**
   * Set custom key event handler (for runtime updates)
   */
  setCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void {
    this.customKeyEventHandler = handler;
  }

  /**
   * Attach keyboard event listeners to container
   */
  private attach(): void {
    // Make container focusable so it can receive keyboard events (browser only)
    if (
      typeof this.container.hasAttribute === 'function' &&
      typeof this.container.setAttribute === 'function'
    ) {
      if (!this.container.hasAttribute('tabindex')) {
        this.container.setAttribute('tabindex', '0');
      }

      // Add visual focus indication (only if style exists - for browser environments)
      if (this.container.style) {
        this.container.style.outline = 'none'; // Remove default outline
      }
    }

    this.keydownListener = this.handleKeyDown.bind(this);
    this.container.addEventListener('keydown', this.keydownListener);

    this.pasteListener = this.handlePaste.bind(this);
    this.container.addEventListener('paste', this.pasteListener);

    this.compositionStartListener = this.handleCompositionStart.bind(this);
    this.container.addEventListener('compositionstart', this.compositionStartListener);

    this.compositionUpdateListener = this.handleCompositionUpdate.bind(this);
    this.container.addEventListener('compositionupdate', this.compositionUpdateListener);

    this.compositionEndListener = this.handleCompositionEnd.bind(this);
    this.container.addEventListener('compositionend', this.compositionEndListener);
  }

  /**
   * Map KeyboardEvent.code to USB HID Key enum value
   * @param code - KeyboardEvent.code value
   * @returns Key enum value or null if unmapped
   */
  private mapKeyCode(code: string): Key | null {
    return KEY_MAP[code] ?? null;
  }

  /**
   * Extract modifier flags from KeyboardEvent
   * @param event - KeyboardEvent
   * @returns Mods flags
   */
  private extractModifiers(event: KeyboardEvent): Mods {
    let mods = Mods.NONE;

    if (event.shiftKey) mods |= Mods.SHIFT;
    if (event.ctrlKey) mods |= Mods.CTRL;
    if (event.altKey) mods |= Mods.ALT;
    if (event.metaKey) mods |= Mods.SUPER;

    // Note: CapsLock and NumLock are not in KeyboardEvent modifiers
    // They would need to be tracked separately if needed
    // For now, we don't set CAPSLOCK or NUMLOCK flags

    return mods;
  }

  /**
   * Check if this is a printable character with no special modifiers
   * @param event - KeyboardEvent
   * @returns true if printable character
   */
  private isPrintableCharacter(event: KeyboardEvent): boolean {
    // If Ctrl, Alt, or Meta (Cmd on Mac) is pressed, it's not a simple printable character
    // Exception: AltGr (Ctrl+Alt on some keyboards) can produce printable characters
    if (event.ctrlKey && !event.altKey) return false;
    if (event.altKey && !event.ctrlKey) return false;
    if (event.metaKey) return false; // Cmd key on Mac

    // If key produces a single printable character
    return event.key.length === 1;
  }

  /**
   * Handle keydown event
   * @param event - KeyboardEvent
   */
  private handleKeyDown(event: KeyboardEvent): void {
    if (this.isDisposed) return;

    // Ignore keydown events during composition
    // Note: Some browsers send keyCode 229 for all keys during composition
    if (this.isComposing || event.isComposing || event.keyCode === 229) {
      return;
    }

    // Emit onKey event first (before any processing)
    if (this.onKeyCallback) {
      this.onKeyCallback({ key: event.key, domEvent: event });
    }

    // Check custom key event handler
    if (this.customKeyEventHandler) {
      const handled = this.customKeyEventHandler(event);
      if (handled) {
        // Custom handler consumed the event
        event.preventDefault();
        return;
      }
    }

    // Allow Ctrl+V and Cmd+V to trigger paste event (don't preventDefault)
    if ((event.ctrlKey || event.metaKey) && event.code === 'KeyV') {
      // Let the browser's native paste event fire
      return;
    }

    // Allow Cmd+C for copy (on Mac, Cmd+C should copy, not send interrupt)
    // SelectionManager handles the actual copying
    // Note: Ctrl+C on all platforms sends interrupt signal (0x03)
    if (event.metaKey && event.code === 'KeyC') {
      // Let browser/SelectionManager handle copy
      return;
    }

    // For printable characters without modifiers, send the character directly
    // This handles: a-z, A-Z (with shift), 0-9, punctuation, etc.
    if (this.isPrintableCharacter(event)) {
      event.preventDefault();
      this.onDataCallback(event.key);
      return;
    }

    // Map the physical key code
    const key = this.mapKeyCode(event.code);
    if (key === null) {
      // Unknown key - ignore it
      return;
    }

    // Extract modifiers
    const mods = this.extractModifiers(event);

    // Handle simple special keys that produce standard sequences
    if (mods === Mods.NONE || mods === Mods.SHIFT) {
      let simpleOutput: string | null = null;

      switch (key) {
        case Key.ENTER:
          simpleOutput = '\r'; // Carriage return
          break;
        case Key.TAB:
          simpleOutput = '\t'; // Tab
          break;
        case Key.BACKSPACE:
          simpleOutput = '\x7F'; // DEL (most terminals use 0x7F for backspace)
          break;
        case Key.ESCAPE:
          simpleOutput = '\x1B'; // ESC
          break;
        // Arrow keys are handled by the encoder (respects application cursor mode)
        // Navigation keys
        case Key.HOME:
          simpleOutput = '\x1B[H';
          break;
        case Key.END:
          simpleOutput = '\x1B[F';
          break;
        case Key.INSERT:
          simpleOutput = '\x1B[2~';
          break;
        case Key.DELETE:
          simpleOutput = '\x1B[3~';
          break;
        case Key.PAGE_UP:
          simpleOutput = '\x1B[5~';
          break;
        case Key.PAGE_DOWN:
          simpleOutput = '\x1B[6~';
          break;
        // Function keys
        case Key.F1:
          simpleOutput = '\x1BOP';
          break;
        case Key.F2:
          simpleOutput = '\x1BOQ';
          break;
        case Key.F3:
          simpleOutput = '\x1BOR';
          break;
        case Key.F4:
          simpleOutput = '\x1BOS';
          break;
        case Key.F5:
          simpleOutput = '\x1B[15~';
          break;
        case Key.F6:
          simpleOutput = '\x1B[17~';
          break;
        case Key.F7:
          simpleOutput = '\x1B[18~';
          break;
        case Key.F8:
          simpleOutput = '\x1B[19~';
          break;
        case Key.F9:
          simpleOutput = '\x1B[20~';
          break;
        case Key.F10:
          simpleOutput = '\x1B[21~';
          break;
        case Key.F11:
          simpleOutput = '\x1B[23~';
          break;
        case Key.F12:
          simpleOutput = '\x1B[24~';
          break;
      }

      if (simpleOutput !== null) {
        event.preventDefault();
        this.onDataCallback(simpleOutput);
        return;
      }
    }

    // Determine action (we only care about PRESS for now, not RELEASE or REPEAT)
    const action = KeyAction.PRESS;

    // For non-printable keys or keys with modifiers, encode using Ghostty
    try {
      // Sync encoder options with terminal mode state
      // Mode 1 (DECCKM) controls whether arrow keys send CSI or SS3 sequences
      if (this.getModeCallback) {
        const appCursorMode = this.getModeCallback(1);
        this.encoder.setOption(KeyEncoderOption.CURSOR_KEY_APPLICATION, appCursorMode);
      }

      // For letter/number keys, even with modifiers, pass the base character
      // This helps the encoder produce correct control sequences (e.g., Ctrl+A = 0x01)
      // For special keys (Enter, Arrow keys, etc.), don't pass utf8
      const utf8 =
        event.key.length === 1 && event.key.charCodeAt(0) < 128
          ? event.key.toLowerCase() // Use lowercase for consistency
          : undefined;

      const encoded = this.encoder.encode({
        action,
        key,
        mods,
        utf8,
      });

      // Convert Uint8Array to string
      const decoder = new TextDecoder();
      const data = decoder.decode(encoded);

      // Prevent default browser behavior
      event.preventDefault();
      event.stopPropagation();

      // Emit the data
      if (data.length > 0) {
        this.onDataCallback(data);
      }
    } catch (error) {
      // Encoding failed - log but don't crash
      console.warn('Failed to encode key:', event.code, error);
    }
  }

  /**
   * Handle paste event from clipboard
   * @param event - ClipboardEvent
   */
  private handlePaste(event: ClipboardEvent): void {
    if (this.isDisposed) return;

    // Prevent default paste behavior
    event.preventDefault();
    event.stopPropagation();

    // Get clipboard data
    const clipboardData = event.clipboardData;
    if (!clipboardData) {
      console.warn('No clipboard data available');
      return;
    }

    // Get text from clipboard
    const text = clipboardData.getData('text/plain');
    if (!text) {
      console.warn('No text in clipboard');
      return;
    }

    // Check if bracketed paste mode is enabled (DEC mode 2004)
    const hasBracketedPaste = this.getModeCallback?.(2004) ?? false;

    if (hasBracketedPaste) {
      // Wrap with bracketed paste sequences
      this.onDataCallback('\x1b[200~' + text + '\x1b[201~');
    } else {
      // Send raw text
      this.onDataCallback(text);
    }
  }

  /**
   * Handle compositionstart event
   */
  private handleCompositionStart(_event: CompositionEvent): void {
    if (this.isDisposed) return;
    this.isComposing = true;
  }

  /**
   * Handle compositionupdate event
   */
  private handleCompositionUpdate(_event: CompositionEvent): void {
    if (this.isDisposed) return;
    // We could track the current composition string here if we wanted to
    // display it in a custom way, but for now we rely on the browser's
    // input method editor UI.
  }

  /**
   * Handle compositionend event
   */
  private handleCompositionEnd(event: CompositionEvent): void {
    if (this.isDisposed) return;
    this.isComposing = false;

    const data = event.data;
    if (data && data.length > 0) {
      this.onDataCallback(data);
    }

    // Cleanup text nodes in container (fix for duplicate text display)
    // When the container is contenteditable, the browser might insert text nodes
    // upon composition end. We need to remove them to prevent duplicate display.
    if (this.container && this.container.childNodes) {
      for (let i = this.container.childNodes.length - 1; i >= 0; i--) {
        const node = this.container.childNodes[i];
        // Node.TEXT_NODE === 3
        if (node.nodeType === 3) {
          this.container.removeChild(node);
        }
      }
    }
  }

  /**
   * Dispose the InputHandler and remove event listeners
   */
  dispose(): void {
    if (this.isDisposed) return;

    if (this.keydownListener) {
      this.container.removeEventListener('keydown', this.keydownListener);
      this.keydownListener = null;
    }

    if (this.keypressListener) {
      this.container.removeEventListener('keypress', this.keypressListener);
      this.keypressListener = null;
    }

    if (this.pasteListener) {
      this.container.removeEventListener('paste', this.pasteListener);
      this.pasteListener = null;
    }

    if (this.compositionStartListener) {
      this.container.removeEventListener('compositionstart', this.compositionStartListener);
      this.compositionStartListener = null;
    }

    if (this.compositionUpdateListener) {
      this.container.removeEventListener('compositionupdate', this.compositionUpdateListener);
      this.compositionUpdateListener = null;
    }

    if (this.compositionEndListener) {
      this.container.removeEventListener('compositionend', this.compositionEndListener);
      this.compositionEndListener = null;
    }

    this.isDisposed = true;
  }

  /**
   * Check if handler is disposed
   */
  isActive(): boolean {
    return !this.isDisposed;
  }
}
