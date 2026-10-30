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
 * Browser-owned policy:
 * - Custom shortcuts, clipboard, dead keys and IME/composition stay in the host.
 * - Terminal-bound native input uses Ghostty for key encoding and mode selection.
 * - Legacy/standalone handlers retain their compatibility encoding path.
 */

import type { NativeMouseEvent } from './backends/types';
import type { Ghostty, GhosttyTerminal } from './ghostty';
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

// Native report-all mode can encode lone modifiers; legacy browser policy stays unchanged.
const NATIVE_MODIFIER_KEYS: Readonly<Record<string, Key>> = {
  ShiftLeft: Key.SHIFT_LEFT,
  ShiftRight: Key.SHIFT_RIGHT,
  ControlLeft: Key.CONTROL_LEFT,
  ControlRight: Key.CONTROL_RIGHT,
  AltLeft: Key.ALT_LEFT,
  AltRight: Key.ALT_RIGHT,
  MetaLeft: Key.META_LEFT,
  MetaRight: Key.META_RIGHT,
};

// DOM resolves NumLock-off keypad keys to navigation names. Preserve that
// distinction when translating into Ghostty's physical/semantic key enum.
const NATIVE_KEYPAD_NAVIGATION: Readonly<Record<string, Key>> = {
  Home: Key.NUMPAD_HOME,
  End: Key.NUMPAD_END,
  Insert: Key.NUMPAD_INSERT,
  Delete: Key.NUMPAD_DELETE,
  PageUp: Key.NUMPAD_PAGE_UP,
  PageDown: Key.NUMPAD_PAGE_DOWN,
  ArrowUp: Key.NUMPAD_UP,
  ArrowDown: Key.NUMPAD_DOWN,
  ArrowLeft: Key.NUMPAD_LEFT,
  ArrowRight: Key.NUMPAD_RIGHT,
  Clear: Key.NUMPAD_BEGIN,
};

// KeyboardEvent has no layout-independent "unshifted character" field. For
// shifted ASCII punctuation, use the standard key pairs; otherwise keep the
// browser's resolved text (not a physical KeyA -> 'a' guess on non-US layouts).
const UNSHIFTED_ASCII: Readonly<Record<string, string>> = {
  '~': '`',
  '!': '1',
  '@': '2',
  '#': '3',
  $: '4',
  '%': '5',
  '^': '6',
  '&': '7',
  '*': '8',
  '(': '9',
  ')': '0',
  _: '-',
  '+': '=',
  '{': '[',
  '}': ']',
  '|': '\\',
  ':': ';',
  '"': "'",
  '<': ',',
  '>': '.',
  '?': '/',
};

/**
 * InputHandler class
 * Attaches keyboard event listeners to a container and converts
 * keyboard events to terminal input data
 */
/**
 * Mouse tracking configuration
 */
export interface MouseTrackingConfig {
  /** Check if any mouse tracking mode is enabled */
  hasMouseTracking: () => boolean;
  /** Check if SGR extended mouse mode is enabled (mode 1006) */
  hasSgrMouseMode: () => boolean;
  /** Host-owned controls or disabled stdin temporarily exclude application input. */
  isReportingEnabled?: () => boolean;
  /** Get cell dimensions for pixel to cell conversion */
  getCellDimensions: () => { width: number; height: number };
  /** Get canvas/container offset for accurate position calculation */
  getCanvasOffset: () => { left: number; top: number };
}

export class InputHandler {
  private encoder: KeyEncoder;
  private container: HTMLElement;
  private inputElement?: HTMLElement;
  private onDataCallback: (data: string, preserveSelection?: boolean, userInput?: boolean) => void;
  private onBinaryCallback?: (data: string) => boolean;
  private isInputEnabled?: () => boolean;
  private onBellCallback: () => void;
  private onKeyCallback?: (keyEvent: IKeyEvent) => void;
  private customKeyEventHandler?: (event: KeyboardEvent) => boolean;
  private getModeCallback?: (mode: number) => boolean;
  private getTerminalCallback?: () => GhosttyTerminal | undefined;
  private keyupListener: ((e: KeyboardEvent) => void) | null = null;
  // Only encode native releases for presses this handler forwarded to the application.
  private readonly forwardedNativeKeys = new Set<string>();
  private readonly clearForwardedNativeKeys = (event: FocusEvent): void => {
    const next = event.relatedTarget;
    if (next instanceof Node && this.container.contains(next)) return;
    this.forwardedNativeKeys.clear();
  };
  private onCopyCallback?: () => boolean;
  private mouseConfig?: MouseTrackingConfig;
  private keydownListener: ((e: KeyboardEvent) => void) | null = null;
  private keypressListener: ((e: KeyboardEvent) => void) | null = null;
  private pasteListener: ((e: ClipboardEvent) => void) | null = null;
  private beforeInputListener: ((e: InputEvent) => void) | null = null;
  private compositionStartListener: ((e: CompositionEvent) => void) | null = null;
  private compositionUpdateListener: ((e: CompositionEvent) => void) | null = null;
  private compositionEndListener: ((e: CompositionEvent) => void) | null = null;
  private mousedownListener: ((e: MouseEvent) => void) | null = null;
  private mouseupListener: ((e: MouseEvent) => void) | null = null;
  private mousemoveListener: ((e: MouseEvent) => void) | null = null;
  private wheelListener: ((e: WheelEvent) => void) | null = null;
  private isComposing = false;
  private isDisposed = false;
  private mouseButtonsPressed = 0; // Legacy button tracking
  private nativeMouseButtons = 0; // DOM buttons bitmask, presses forwarded to the application
  private localMouseButtons = 0; // Gestures that began as local/Shift selection
  private readonly mouseTextDecoder = new TextDecoder('utf-8', { fatal: true });
  private readonly handleOutsideMouseMove = (event: MouseEvent): void => {
    if (
      (this.nativeMouseButtons || this.localMouseButtons) &&
      !this.container.contains(event.target as Node)
    )
      this.handleMouseMove(event);
  };
  private readonly handleOutsideMouseUp = (event: MouseEvent): void => {
    if (
      (this.nativeMouseButtons || this.localMouseButtons) &&
      !this.container.contains(event.target as Node)
    )
      this.handleMouseUp(event);
  };
  private readonly handleMouseBlur = (): void => {
    this.forwardedNativeKeys.clear();
    this.resetMouseState();
  };
  private lastKeyDownData: string | null = null;
  private lastKeyDownTime = 0;
  private lastPasteData: string | null = null;
  private lastPasteTime = 0;
  private lastPasteSource: 'paste' | 'beforeinput' | null = null;
  private lastCompositionData: string | null = null;
  private lastCompositionTime = 0;
  private lastBeforeInputData: string | null = null;
  private lastBeforeInputTime = 0;
  private static readonly BEFORE_INPUT_IGNORE_MS = 100;

  /**
   * Create a new InputHandler
   * @param ghostty - Ghostty instance (for creating KeyEncoder)
   * @param container - DOM element to attach listeners to
   * @param onData - Callback for terminal data (escape sequences to send to PTY)
   * @param onBell - Callback for bell/beep event
   * @param onKey - Optional callback for raw key events
   * @param customKeyEventHandler - Optional custom key event handler
   * @param getMode - Optional callback to query terminal mode state (for application cursor mode)
   * @param onCopy - Optional callback to handle copy (Cmd+C/Ctrl+C with selection)
   * @param inputElement - Optional input element for beforeinput events
   * @param mouseConfig - Optional mouse tracking configuration
   */
  constructor(
    ghostty: Ghostty,
    container: HTMLElement,
    onData: (data: string, preserveSelection?: boolean, userInput?: boolean) => void,
    onBell: () => void,
    onKey?: (keyEvent: IKeyEvent) => void,
    customKeyEventHandler?: (event: KeyboardEvent) => boolean,
    getMode?: (mode: number) => boolean,
    onCopy?: () => boolean,
    inputElement?: HTMLElement,
    mouseConfig?: MouseTrackingConfig,
    getTerminal?: () => GhosttyTerminal | undefined,
    onBinary?: (data: string) => boolean,
    isInputEnabled?: () => boolean
  ) {
    this.encoder = ghostty.createKeyEncoder();
    this.container = container;
    this.inputElement = inputElement;
    this.onDataCallback = onData;
    this.onBinaryCallback = onBinary;
    this.isInputEnabled = isInputEnabled;
    this.onBellCallback = onBell;
    this.onKeyCallback = onKey;
    this.customKeyEventHandler = customKeyEventHandler;
    this.getModeCallback = getMode;
    this.getTerminalCallback = getTerminal;
    this.onCopyCallback = onCopy;
    this.mouseConfig = mouseConfig;

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

    this.keyupListener = (event: KeyboardEvent) => {
      const forwarded = this.forwardedNativeKeys.delete(event.code || event.key);
      if (!forwarded || this.isDisposed || this.isComposing || event.isComposing) return;
      const terminal = this.nativeTerminal();
      if (terminal) {
        this.encodeNativeKey(event, KeyAction.RELEASE, terminal);
      }
    };
    this.container.addEventListener('keyup', this.keyupListener);
    // Clear ownership only when focus leaves the whole terminal, not on internal transfers.
    this.container.addEventListener('blur', this.clearForwardedNativeKeys, true);
    this.keydownListener = this.handleKeyDown.bind(this);
    this.container.addEventListener('keydown', this.keydownListener);

    this.pasteListener = this.handlePaste.bind(this);
    this.container.addEventListener('paste', this.pasteListener);
    if (this.inputElement && this.inputElement !== this.container) {
      this.inputElement.addEventListener('paste', this.pasteListener);
    }

    if (this.inputElement) {
      this.beforeInputListener = this.handleBeforeInput.bind(this);
      this.inputElement.addEventListener('beforeinput', this.beforeInputListener);
    }

    this.compositionStartListener = this.handleCompositionStart.bind(this);
    this.container.addEventListener('compositionstart', this.compositionStartListener);

    this.compositionUpdateListener = this.handleCompositionUpdate.bind(this);
    this.container.addEventListener('compositionupdate', this.compositionUpdateListener);

    this.compositionEndListener = this.handleCompositionEnd.bind(this);
    this.container.addEventListener('compositionend', this.compositionEndListener);

    // Mouse event listeners (for terminal mouse tracking)
    this.mousedownListener = this.handleMouseDown.bind(this);
    this.container.addEventListener('mousedown', this.mousedownListener);

    this.mouseupListener = this.handleMouseUp.bind(this);
    this.container.addEventListener('mouseup', this.mouseupListener);

    this.mousemoveListener = this.handleMouseMove.bind(this);
    this.container.addEventListener('mousemove', this.mousemoveListener);

    this.wheelListener = this.handleWheel.bind(this);
    this.container.addEventListener('wheel', this.wheelListener, { passive: false });
    // A native application drag owns its eventual release even outside the canvas.
    if (this.getTerminalCallback) {
      document.addEventListener('mousemove', this.handleOutsideMouseMove, true);
      document.addEventListener('mouseup', this.handleOutsideMouseUp, true);
      window.addEventListener('blur', this.handleMouseBlur);
    }
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
    if (!event.repeat) this.forwardedNativeKeys.delete(event.code || event.key);

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

    const nativeTerminal = this.nativeTerminal();
    const altGraph = !!nativeTerminal && event.getModifierState?.('AltGraph') === true;

    // Allow Ctrl+V and Cmd+V to trigger paste, but not browser-resolved AltGraph text.
    if (((event.ctrlKey && !altGraph) || event.metaKey) && event.code === 'KeyV') {
      // Let the browser's native paste event fire
      return;
    }

    // Handle Cmd+C for copy (on Mac, Cmd+C should copy, not send interrupt)
    // Note: Ctrl+C on all platforms sends interrupt signal (0x03)
    if (event.metaKey && event.code === 'KeyC') {
      // Try to copy selection via callback
      // If there's a selection and copy succeeds, prevent default
      // If no selection, let it fall through (browser may have other text selected)
      if (this.onCopyCallback && this.onCopyCallback()) {
        event.preventDefault();
      }
      return;
    }

    // The native encoder owns ordinary keys, modifiers and protocol transitions
    // too. Do not bypass it with the legacy printable/special-key tables below.
    if (nativeTerminal) {
      this.encodeNativeKey(
        event,
        event.repeat ? KeyAction.REPEAT : KeyAction.PRESS,
        nativeTerminal
      );
      return;
    }

    // For printable characters without modifiers, send the character directly
    // This handles: a-z, A-Z (with shift), 0-9, punctuation, etc.
    if (this.isPrintableCharacter(event)) {
      event.preventDefault();
      this.onDataCallback(event.key);
      this.recordKeyDownData(event.key);
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
          if (mods === Mods.SHIFT) {
            simpleOutput = '\x1b[Z'; // Backtab
          } else {
            simpleOutput = '\t'; // Tab
          }
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
        this.recordKeyDownData(simpleOutput);
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
        this.recordKeyDownData(data);
      }
    } catch (error) {
      // Encoding failed - log but don't crash
      console.warn('Failed to encode key:', event.code, error);
    }
  }

  private nativeTerminal(): GhosttyTerminal | undefined {
    const terminal = this.getTerminalCallback?.();
    return terminal?.backend === 'libghostty-vt' ? terminal : undefined;
  }

  private encodeNativeKey(
    event: KeyboardEvent,
    action: KeyAction,
    terminal: GhosttyTerminal
  ): void {
    // Do not cancel the browser's dead-key/IME handling. Committed text arrives
    // through composition/beforeinput, not through a fabricated terminal key.
    if (event.key === 'Dead' || event.key === 'Process') return;
    const printable = Array.from(event.key).length === 1;
    const modifier = NATIVE_MODIFIER_KEYS[event.code];
    const mapped =
      (event.code.startsWith('Numpad') ? NATIVE_KEYPAD_NAVIGATION[event.key] : undefined) ??
      modifier ??
      this.mapKeyCode(event.code);
    if (mapped === null && !printable) return;
    const key = mapped ?? Key.UNIDENTIFIED;
    const altGraph = event.getModifierState?.('AltGraph') === true;
    let mods = this.extractModifiers(event);
    // AltGraph's synthetic Ctrl+Alt bits describe text production, not a terminal
    // shortcut. consumedMods alone is insufficient: native C0/modifyOtherKeys
    // encoding intentionally consults the raw modifiers.
    if (altGraph) {
      mods &= ~(Mods.CTRL | Mods.ALT);
      // Shift+AltGraph printable text is also a layout result, not a shortcut.
      if (printable) mods &= ~Mods.SHIFT;
    }
    if (event.getModifierState?.('CapsLock')) mods |= Mods.CAPSLOCK;
    if (event.getModifierState?.('NumLock')) mods |= Mods.NUMLOCK;
    const lower = event.key.toLowerCase();
    const lowerScalar = Array.from(lower).length === 1 ? lower : event.key;
    const digit = /^Digit([0-9])$/.exec(event.code)?.[1];
    // Keep the existing numeric-key fallback: shifted digit symbols differ by
    // layout (e.g. Shift+8 is '(' on German layouts, not the US '*'). A complete
    // unshifted layout map is not exposed by KeyboardEvent and remains a limit.
    const unshifted = !printable
      ? ''
      : altGraph
        ? lowerScalar
        : (digit ?? (event.shiftKey ? UNSHIFTED_ASCII[event.key] : undefined) ?? lowerScalar);
    const consumedMods =
      printable && event.shiftKey && unshifted !== event.key ? Mods.SHIFT : Mods.NONE;

    // Always synchronize, including zero/disabled modes after a pop, RIS or
    // screen switch. There is no independent JS copy of the terminal protocol.
    this.encoder.syncFromTerminal(terminal);
    const encoded = this.encoder.encode({
      action,
      key,
      mods,
      consumedMods,
      utf8: printable ? event.key : undefined,
      unshiftedCodepoint: unshifted.codePointAt(0) ?? 0,
      composing: false,
    });
    // Ordinary modifier presses remain browser-owned when the native protocol
    // has no report for them. Report-all mode still uses the native encoder.
    if (modifier === undefined || encoded.length > 0) {
      event.preventDefault();
      event.stopPropagation();
    }
    const data = new TextDecoder().decode(encoded);
    if (data && this.isInputEnabled?.() !== false) {
      if (action !== KeyAction.RELEASE) this.forwardedNativeKeys.add(event.code || event.key);
      this.onDataCallback(
        data,
        modifier !== undefined,
        modifier === undefined && action !== KeyAction.RELEASE
      );
      if (action !== KeyAction.RELEASE) this.recordKeyDownData(data);
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

    if (this.shouldIgnorePasteEvent(text, 'paste')) {
      return;
    }

    this.emitPasteData(text);
    this.recordPasteData(text, 'paste');
  }

  /**
   * Handle beforeinput event (mobile/IME input)
   * @param event - InputEvent
   */
  private handleBeforeInput(event: InputEvent): void {
    if (this.isDisposed) return;

    if (this.isComposing || event.isComposing) {
      return;
    }

    const inputType = event.inputType;
    const data = event.data ?? '';
    let output: string | null = null;

    switch (inputType) {
      case 'insertText':
      case 'insertReplacementText':
        output = data.length > 0 ? data.replace(/\n/g, '\r') : null;
        break;
      case 'insertLineBreak':
      case 'insertParagraph':
        output = '\r';
        break;
      case 'deleteContentBackward':
        output = '\x7F';
        break;
      case 'deleteContentForward':
        output = '\x1B[3~';
        break;
      case 'insertFromPaste':
        if (!data) {
          return;
        }
        if (this.shouldIgnorePasteEvent(data, 'beforeinput')) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.emitPasteData(data);
        this.recordPasteData(data, 'beforeinput');
        return;
      default:
        return;
    }

    if (!output) {
      return;
    }

    if (this.shouldIgnoreBeforeInput(output)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (data && this.shouldIgnoreBeforeInputFromComposition(data)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.onDataCallback(output);
    if (data) {
      this.recordBeforeInputData(data);
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
      if (this.shouldIgnoreCompositionEnd(data)) {
        this.cleanupCompositionTextNodes();
        return;
      }
      this.onDataCallback(data);
      this.recordCompositionData(data);
    }

    this.cleanupCompositionTextNodes();
  }

  /**
   * Cleanup text nodes in container after composition
   */
  private cleanupCompositionTextNodes(): void {
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

  // ==========================================================================
  // Mouse Event Handling (for terminal mouse tracking)
  // ==========================================================================

  /**
   * Convert pixel coordinates to terminal cell coordinates
   */
  private pixelToCell(event: MouseEvent): { col: number; row: number } | null {
    if (!this.mouseConfig) return null;

    const dims = this.mouseConfig.getCellDimensions();
    const offset = this.mouseConfig.getCanvasOffset();

    if (dims.width <= 0 || dims.height <= 0) return null;

    const x = event.clientX - offset.left;
    const y = event.clientY - offset.top;

    // Convert to 1-based cell coordinates (terminal uses 1-based)
    const col = Math.floor(x / dims.width) + 1;
    const row = Math.floor(y / dims.height) + 1;

    // Clamp to valid range (at least 1)
    return {
      col: Math.max(1, col),
      row: Math.max(1, row),
    };
  }

  /**
   * Get modifier flags for mouse event
   */
  private getMouseModifiers(event: MouseEvent): number {
    let mods = 0;
    if (event.shiftKey) mods |= 4;
    if (event.metaKey) mods |= 8; // Meta (Cmd on Mac)
    if (event.ctrlKey) mods |= 16;
    return mods;
  }

  /**
   * Encode mouse event as SGR sequence
   * SGR format: \x1b[<Btn;Col;RowM (press/motion) or \x1b[<Btn;Col;Rowm (release)
   */
  private encodeMouseSGR(
    button: number,
    col: number,
    row: number,
    isRelease: boolean,
    modifiers: number
  ): string {
    const btn = button + modifiers;
    const suffix = isRelease ? 'm' : 'M';
    return `\x1b[<${btn};${col};${row}${suffix}`;
  }

  /**
   * Encode mouse event as X10/normal sequence (legacy format)
   * Format: \x1b[M<Btn+32><Col+32><Row+32>
   */
  private encodeMouseX10(button: number, col: number, row: number, modifiers: number): string {
    // X10 format adds 32 to all values and encodes as characters
    // Button encoding: 0=left, 1=middle, 2=right, 3=release
    const btn = button + modifiers + 32;
    const colChar = String.fromCharCode(Math.min(col + 32, 255));
    const rowChar = String.fromCharCode(Math.min(row + 32, 255));
    return `\x1b[M${String.fromCharCode(btn)}${colChar}${rowChar}`;
  }

  /**
   * Send mouse event to terminal
   */
  private sendMouseEvent(
    button: number,
    col: number,
    row: number,
    isRelease: boolean,
    event: MouseEvent
  ): void {
    const modifiers = this.getMouseModifiers(event);

    // Check if SGR extended mode is enabled (mode 1006)
    const useSGR = this.mouseConfig?.hasSgrMouseMode?.() ?? true;

    let sequence: string;
    if (useSGR) {
      sequence = this.encodeMouseSGR(button, col, row, isRelease, modifiers);
    } else {
      // X10/normal mode doesn't support release events directly
      // Button 3 means release in X10 mode
      const x10Button = isRelease ? 3 : button;
      sequence = this.encodeMouseX10(x10Button, col, row, modifiers);
    }

    this.onDataCallback(sequence, false, false);
  }

  /** Reset host gesture ownership and native motion history after blur/reset. */
  resetMouseState(): void {
    this.nativeMouseButtons = this.localMouseButtons = 0;
    this.nativeTerminal()?.resetMouseEncoder();
  }

  private mouseButtonMask(button: number): number {
    return [1, 4, 2, 8, 16][button] ?? 0;
  }

  private nativeMouseButton(button: number): NativeMouseEvent['button'] {
    return (['left', 'middle', 'right', 'eight', 'nine'] as const)[button] ?? null;
  }

  private nativeMotionButton(buttons: number): NativeMouseEvent['button'] {
    if (buttons & 1) return 'left';
    if (buttons & 2) return 'right';
    if (buttons & 4) return 'middle';
    if (buttons & 8) return 'eight';
    if (buttons & 16) return 'nine';
    return null;
  }

  private nativeMouseEnabled(): boolean {
    return this.mouseConfig?.isReportingEnabled?.() ?? true;
  }

  private sendNativeMouse(
    event: MouseEvent,
    action: NativeMouseEvent['action'],
    button: NativeMouseEvent['button'],
    anyButtonPressed: boolean
  ): boolean {
    const terminal = this.nativeTerminal();
    if (!terminal || !this.mouseConfig) return false;
    const { width, height } = this.mouseConfig.getCellDimensions();
    if (width <= 0 || height <= 0) return false;
    const offset = this.mouseConfig.getCanvasOffset();
    let mods = Mods.NONE;
    if (event.shiftKey) mods |= Mods.SHIFT;
    if (event.ctrlKey) mods |= Mods.CTRL;
    if (event.altKey) mods |= Mods.ALT;
    if (event.metaKey) mods |= Mods.SUPER;
    const bytes = terminal.encodeMouseEvent({
      action,
      button,
      mods,
      anyButtonPressed,
      x: event.clientX - offset.left,
      y: event.clientY - offset.top,
      cellWidth: width,
      cellHeight: height,
    });
    if (!bytes.length) return false;
    let text: string;
    try {
      text = this.mouseTextDecoder.decode(bytes);
    } catch {
      // Never corrupt raw X10 bytes through UTF-8 onData. The additive onBinary
      // channel uses xterm's byte-string convention (one 0..255 code unit/byte).
      // With no binary subscriber, keep withholding the unsafe press so it
      // cannot create an orphan release for an existing string-only consumer.
      const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
      return this.onBinaryCallback?.(binary) ?? false;
    }
    // Pointer reports are not typed input; do not move a history viewport.
    this.onDataCallback(text, false, false);
    return true;
  }

  /** Called by Terminal's capture-phase wheel router, after custom host policy. */
  handleNativeWheel(event: WheelEvent): boolean {
    if (this.isDisposed || !this.nativeTerminal() || !this.mouseConfig?.hasMouseTracking())
      return false;
    // Tracking owns the event, even when mode 9 encodes no wheels or stdin is disabled.
    if (!this.nativeMouseEnabled()) return true;
    const held = (event.buttons & this.nativeMouseButtons) !== 0;
    // Preserve the web contract: one report per nonzero axis per DOM wheel event.
    // Delta-to-lines/trackpad acceleration is host policy, not reimplemented here.
    if (Number.isFinite(event.deltaY) && event.deltaY !== 0) {
      this.sendNativeMouse(event, 'press', event.deltaY < 0 ? 'four' : 'five', held);
    }
    if (Number.isFinite(event.deltaX) && event.deltaX !== 0) {
      this.sendNativeMouse(event, 'press', event.deltaX < 0 ? 'six' : 'seven', held);
    }
    event.preventDefault();
    return true;
  }

  /**
   * Handle mousedown event
   */
  private handleMouseDown(event: MouseEvent): void {
    if (this.isDisposed) return;
    if (this.nativeTerminal() && this.mouseConfig) {
      const mask = this.mouseButtonMask(event.button);
      if (!mask) return;
      if (event.shiftKey || !this.nativeMouseEnabled() || !this.mouseConfig.hasMouseTracking()) {
        this.localMouseButtons |= mask;
        this.nativeMouseButtons &= ~mask;
        return;
      }
      this.localMouseButtons &= ~mask;
      this.nativeMouseButtons |= mask;
      if (!this.sendNativeMouse(event, 'press', this.nativeMouseButton(event.button), true)) {
        // A dropped/unsafe press must not create an orphan release later.
        this.nativeMouseButtons &= ~mask;
      }
      event.preventDefault();
      return;
    }
    if (!this.mouseConfig?.hasMouseTracking()) return;

    const cell = this.pixelToCell(event);
    if (!cell) return;

    // Map browser button to terminal button
    // event.button: 0=left, 1=middle, 2=right
    // Terminal: 0=left, 1=middle, 2=right
    const button = event.button;

    // Track pressed buttons for motion events
    this.mouseButtonsPressed |= 1 << button;

    this.sendMouseEvent(button, cell.col, cell.row, false, event);

    // Don't prevent default - let SelectionManager handle selection
    // Only prevent if we actually handled the event
    // event.preventDefault();
  }

  /**
   * Handle mouseup event
   */
  private handleMouseUp(event: MouseEvent): void {
    if (this.isDisposed) return;
    if (this.nativeTerminal() && this.mouseConfig) {
      const mask = this.mouseButtonMask(event.button);
      const forwarded = (this.nativeMouseButtons & mask) !== 0;
      this.nativeMouseButtons &= ~mask;
      this.localMouseButtons &= ~mask;
      // Pair an application press with release even if Shift changed mid-drag.
      if (forwarded && this.nativeMouseEnabled()) {
        this.sendNativeMouse(
          event,
          'release',
          this.nativeMouseButton(event.button),
          (event.buttons & this.nativeMouseButtons) !== 0
        );
        event.preventDefault();
      }
      return;
    }
    if (!this.mouseConfig?.hasMouseTracking()) return;

    const cell = this.pixelToCell(event);
    if (!cell) return;

    const button = event.button;

    // Clear pressed button
    this.mouseButtonsPressed &= ~(1 << button);

    this.sendMouseEvent(button, cell.col, cell.row, true, event);
  }

  /**
   * Handle mousemove event
   */
  private handleMouseMove(event: MouseEvent): void {
    if (this.isDisposed) return;
    if (this.nativeTerminal() && this.mouseConfig) {
      // DOM button state also repairs ownership after a release missed during blur.
      this.nativeMouseButtons &= event.buttons;
      this.localMouseButtons &= event.buttons;
      if (
        this.localMouseButtons ||
        !this.nativeMouseEnabled() ||
        !this.mouseConfig.hasMouseTracking()
      )
        return;
      if (event.shiftKey && event.buttons !== 0 && !this.nativeMouseButtons) return;
      const button = this.nativeMotionButton(this.nativeMouseButtons);
      this.sendNativeMouse(event, 'motion', button, this.nativeMouseButtons !== 0);
      return;
    }
    if (!this.mouseConfig?.hasMouseTracking()) return;

    // Check if button motion mode or any-event tracking is enabled
    // Mode 1002 = button motion, Mode 1003 = any motion
    const hasButtonMotion = this.getModeCallback?.(1002) ?? false;
    const hasAnyMotion = this.getModeCallback?.(1003) ?? false;

    if (!hasButtonMotion && !hasAnyMotion) return;

    // In button motion mode, only report if a button is pressed
    if (hasButtonMotion && !hasAnyMotion && this.mouseButtonsPressed === 0) return;

    const cell = this.pixelToCell(event);
    if (!cell) return;

    // Determine which button to report (or 32 for motion with no button)
    let button = 32; // Motion flag
    if (this.mouseButtonsPressed & 1)
      button += 0; // Left
    else if (this.mouseButtonsPressed & 2)
      button += 1; // Middle
    else if (this.mouseButtonsPressed & 4) button += 2; // Right

    this.sendMouseEvent(button, cell.col, cell.row, false, event);
  }

  /**
   * Handle wheel event (scroll)
   */
  private handleWheel(event: WheelEvent): void {
    if (this.isDisposed) return;
    if (this.handleNativeWheel(event)) return;
    if (!this.mouseConfig?.hasMouseTracking()) return;

    const cell = this.pixelToCell(event);
    if (!cell) return;

    // Wheel events: button 64 = scroll up, button 65 = scroll down
    const button = event.deltaY < 0 ? 64 : 65;

    this.sendMouseEvent(button, cell.col, cell.row, false, event);

    // Prevent default scrolling when mouse tracking is active
    event.preventDefault();
  }

  /**
   * Emit paste data with bracketed paste support
   */
  private emitPasteData(text: string): void {
    const terminal = this.nativeTerminal();
    if (terminal) {
      // Upstream owns sanitization, newline conversion and live mode-2004 framing.
      // Keep DOM paste/beforeinput deduplication on the original clipboard text.
      const bytes = terminal.encodePaste(text);
      if (bytes.length) this.onDataCallback(new TextDecoder().decode(bytes));
      return;
    }
    const hasBracketedPaste = this.getModeCallback?.(2004) ?? false;

    if (hasBracketedPaste) {
      this.onDataCallback('\x1b[200~' + text + '\x1b[201~');
    } else {
      this.onDataCallback(text);
    }
  }

  /**
   * Record keydown data for beforeinput de-duplication
   */
  private recordKeyDownData(data: string): void {
    this.lastKeyDownData = data;
    this.lastKeyDownTime = this.getNow();
  }

  /**
   * Record paste data for beforeinput de-duplication
   */
  private recordPasteData(data: string, source: 'paste' | 'beforeinput'): void {
    this.lastPasteData = data;
    this.lastPasteTime = this.getNow();
    this.lastPasteSource = source;
  }

  /**
   * Check if beforeinput should be ignored due to a recent keydown
   */
  private shouldIgnoreBeforeInput(data: string): boolean {
    if (!this.lastKeyDownData) {
      return false;
    }
    const now = this.getNow();
    const isDuplicate =
      now - this.lastKeyDownTime < InputHandler.BEFORE_INPUT_IGNORE_MS &&
      this.lastKeyDownData === data;
    this.lastKeyDownData = null;
    return isDuplicate;
  }

  /**
   * Check if beforeinput text should be ignored due to a recent composition end
   */
  private shouldIgnoreBeforeInputFromComposition(data: string): boolean {
    if (!this.lastCompositionData) {
      return false;
    }
    const now = this.getNow();
    const isDuplicate =
      now - this.lastCompositionTime < InputHandler.BEFORE_INPUT_IGNORE_MS &&
      this.lastCompositionData === data;
    if (isDuplicate) {
      this.lastCompositionData = null;
    }
    return isDuplicate;
  }

  /**
   * Check if composition end should be ignored due to a recent beforeinput text
   */
  private shouldIgnoreCompositionEnd(data: string): boolean {
    if (!this.lastBeforeInputData) {
      return false;
    }
    const now = this.getNow();
    const isDuplicate =
      now - this.lastBeforeInputTime < InputHandler.BEFORE_INPUT_IGNORE_MS &&
      this.lastBeforeInputData === data;
    if (isDuplicate) {
      this.lastBeforeInputData = null;
    }
    return isDuplicate;
  }

  /**
   * Record beforeinput text for composition de-duplication
   */
  private recordBeforeInputData(data: string): void {
    this.lastBeforeInputData = data;
    this.lastBeforeInputTime = this.getNow();
  }

  /**
   * Record composition end data for beforeinput de-duplication
   */
  private recordCompositionData(data: string): void {
    this.lastCompositionData = data;
    this.lastCompositionTime = this.getNow();
  }

  /**
   * Check if paste should be ignored due to a recent paste event from another source
   */
  private shouldIgnorePasteEvent(data: string, source: 'paste' | 'beforeinput'): boolean {
    if (!this.lastPasteData) {
      return false;
    }
    if (this.lastPasteSource === source) {
      return false;
    }
    const now = this.getNow();
    const isDuplicate =
      now - this.lastPasteTime < InputHandler.BEFORE_INPUT_IGNORE_MS && this.lastPasteData === data;
    if (isDuplicate) {
      this.lastPasteData = null;
      this.lastPasteSource = null;
    }
    return isDuplicate;
  }

  /**
   * Get current time in milliseconds
   */
  private getNow(): number {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  }

  /**
   * Dispose the InputHandler and remove event listeners
   */
  dispose(): void {
    if (this.isDisposed) return;

    this.forwardedNativeKeys.clear();
    this.container.removeEventListener('blur', this.clearForwardedNativeKeys, true);

    if (this.keydownListener) {
      this.container.removeEventListener('keydown', this.keydownListener);
      this.keydownListener = null;
    }

    if (this.keyupListener) {
      this.container.removeEventListener('keyup', this.keyupListener);
      this.keyupListener = null;
    }

    if (this.keypressListener) {
      this.container.removeEventListener('keypress', this.keypressListener);
      this.keypressListener = null;
    }

    if (this.pasteListener) {
      this.container.removeEventListener('paste', this.pasteListener);
      if (this.inputElement && this.inputElement !== this.container) {
        this.inputElement.removeEventListener('paste', this.pasteListener);
      }
      this.pasteListener = null;
    }

    if (this.beforeInputListener && this.inputElement) {
      this.inputElement.removeEventListener('beforeinput', this.beforeInputListener);
      this.beforeInputListener = null;
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

    if (this.mousedownListener) {
      this.container.removeEventListener('mousedown', this.mousedownListener);
      this.mousedownListener = null;
    }

    if (this.mouseupListener) {
      this.container.removeEventListener('mouseup', this.mouseupListener);
      this.mouseupListener = null;
    }

    if (this.mousemoveListener) {
      this.container.removeEventListener('mousemove', this.mousemoveListener);
      this.mousemoveListener = null;
    }

    if (this.wheelListener) {
      this.container.removeEventListener('wheel', this.wheelListener);
      this.wheelListener = null;
    }

    if (this.getTerminalCallback) {
      document.removeEventListener('mousemove', this.handleOutsideMouseMove, true);
      document.removeEventListener('mouseup', this.handleOutsideMouseUp, true);
      window.removeEventListener('blur', this.handleMouseBlur);
    }
    this.resetMouseState();

    // Release the WASM key encoder owned by this handler
    this.encoder.dispose();

    this.isDisposed = true;
  }

  /**
   * Check if handler is disposed
   */
  isActive(): boolean {
    return !this.isDisposed;
  }
}
