/**
 * Terminal - Main terminal emulator class
 *
 * Provides an xterm.js-compatible API wrapping Ghostty's WASM terminal emulator.
 *
 * Usage:
 * ```typescript
 * import { init, Terminal } from 'ghostty-web';
 *
 * await init();
 * const term = new Terminal();
 * term.open(document.getElementById('container'));
 * term.write('Hello, World!\n');
 * term.onData(data => console.log('User typed:', data));
 * ```
 */

import { SurfaceScrollbar } from './apprt/scrollbar';
import { BrowserSurface } from './apprt/surface';
import { BufferNamespace } from './buffer';
import { EventEmitter } from './event-emitter';
import type { Ghostty, GhosttyCell, GhosttyTerminal, GhosttyTerminalConfig } from './ghostty';
import { getGhostty } from './index';
import { InputHandler, type MouseTrackingConfig } from './input-handler';
import type {
  IBufferNamespace,
  IBufferRange,
  IDisposable,
  IEvent,
  IKeyEvent,
  ITerminalAddon,
  ITerminalCore,
  ITerminalOptions,
  IUnicodeVersionProvider,
} from './interfaces';
import { LinkDetector } from './link-detector';
import { OSC8LinkProvider } from './providers/osc8-link-provider';
import { UrlRegexProvider } from './providers/url-regex-provider';
import { CanvasRenderer, DEFAULT_THEME } from './renderer';
import { RendererThread } from './renderer/thread';
import { SelectionManager } from './selection-manager';
import { Surface } from './surface';
import { Termio } from './termio/termio';
import type { ILink, ILinkProvider } from './types';

// ============================================================================
// Terminal Class
// ============================================================================

export class Terminal implements ITerminalCore {
  // Public properties (xterm.js compatibility)
  public cols: number;
  public rows: number;
  public element?: HTMLElement;
  public textarea?: HTMLTextAreaElement;

  // Buffer API (xterm.js compatibility)
  public readonly buffer: IBufferNamespace;

  // Unicode API (xterm.js compatibility)
  public readonly unicode: IUnicodeVersionProvider = {
    get activeVersion(): string {
      return '15.1'; // Ghostty supports Unicode 15.1
    },
  };

  // Options (public for xterm.js compatibility)
  public readonly options!: Required<ITerminalOptions>;

  // Components (created on open())
  private ghostty?: Ghostty;
  public wasmTerm?: GhosttyTerminal; // Made public for link providers
  public renderer?: CanvasRenderer; // Made public for FitAddon
  private inputHandler?: InputHandler;
  private selectionManager?: SelectionManager;
  private canvas?: HTMLCanvasElement;
  private surface?: Surface;
  private termio?: Termio;
  private rendererThread?: RendererThread;
  private browserSurface?: BrowserSurface;
  private scrollbar?: SurfaceScrollbar;

  // Link detection system
  private linkDetector?: LinkDetector;
  private currentHoveredLink?: ILink;
  private mouseMoveThrottleTimeout?: number;
  private pendingMouseMove?: MouseEvent;

  // Event emitters
  private dataEmitter = new EventEmitter<string>();
  private binaryEmitter = new EventEmitter<string>();
  private resizeEmitter = new EventEmitter<{ cols: number; rows: number }>();
  private bellEmitter = new EventEmitter<void>();
  private selectionChangeEmitter = new EventEmitter<void>();
  private keyEmitter = new EventEmitter<IKeyEvent>();
  private titleChangeEmitter = new EventEmitter<string>();
  private scrollEmitter = new EventEmitter<number>();
  private renderEmitter = new EventEmitter<{ start: number; end: number }>();
  private cursorMoveEmitter = new EventEmitter<void>();
  // Public event accessors (xterm.js compatibility)
  public readonly onData: IEvent<string> = this.dataEmitter.event;
  /**
   * Non-UTF-8 native mouse input, using xterm's binary-string convention.
   * Each character is one byte (0..255): use Uint8Array.from(data, c => c.charCodeAt(0))
   * for WebSocket input, or Buffer.from(data, 'latin1') for a Node PTY. Never UTF-8
   * encode this channel. Ordinary input remains onData; without a subscriber,
   * unsafe raw reports continue to be withheld for string-only consumers.
   */
  public readonly onBinary: IEvent<string> = this.binaryEmitter.event;
  public readonly onResize: IEvent<{ cols: number; rows: number }> = this.resizeEmitter.event;
  public readonly onBell: IEvent<void> = this.bellEmitter.event;
  public readonly onSelectionChange: IEvent<void> = this.selectionChangeEmitter.event;
  public readonly onKey: IEvent<IKeyEvent> = this.keyEmitter.event;
  public readonly onTitleChange: IEvent<string> = this.titleChangeEmitter.event;
  public readonly onScroll: IEvent<number> = this.scrollEmitter.event;
  public readonly onRender: IEvent<{ start: number; end: number }> = this.renderEmitter.event;
  public readonly onCursorMove: IEvent<void> = this.cursorMoveEmitter.event;

  // Lifecycle state
  private isOpen = false;
  private isDisposed = false;
  private focusTimeout?: ReturnType<typeof setTimeout>;
  private awaitingEcho = false;

  // Addons
  private addons: ITerminalAddon[] = [];

  // Phase 1: Custom event handlers
  private customKeyEventHandler?: (event: KeyboardEvent) => boolean;

  // Phase 1: Title tracking
  private currentTitle: string = '';

  private resizeDepth = 0;
  private resizeGeneration = 0;
  private customWheelEventHandler?: (event: WheelEvent) => boolean;
  private lastCursorY = 0;

  /** Compatibility offset from bottom; native position is owned by PageList. */
  get viewportY(): number {
    return this.surface?.offset ?? 0;
  }
  set viewportY(value: number) {
    this.surface?.setOffset(value, false);
  }
  private get scrollbarOpacity(): number {
    return this.scrollbar?.getOpacity() ?? 0;
  }
  private get isDraggingScrollbar(): boolean {
    return this.scrollbar?.isDragging ?? false;
  }

  constructor(options: ITerminalOptions = {}) {
    // Use provided Ghostty instance (for test isolation) or get module-level instance
    this.ghostty = options.ghostty ?? getGhostty();

    // Create base options object with all defaults (excluding ghostty)
    const baseOptions = {
      cols: options.cols ?? 80,
      rows: options.rows ?? 24,
      cursorBlink: options.cursorBlink ?? false,
      cursorStyle: options.cursorStyle ?? 'block',
      theme: options.theme ?? {},
      scrollback: options.scrollback ?? 10000,
      fontSize: options.fontSize ?? 15,
      fontFamily: options.fontFamily ?? 'monospace',
      allowTransparency: options.allowTransparency ?? false,
      convertEol: options.convertEol ?? false,
      disableStdin: options.disableStdin ?? false,
      smoothScrollDuration: options.smoothScrollDuration ?? 0, // Deprecated: native-parity scrolling is immediate
    };

    // Wrap in Proxy to intercept runtime changes (xterm.js compatibility)
    (this.options as any) = new Proxy(baseOptions, {
      set: (target: any, prop: string, value: any) => {
        const oldValue = target[prop];
        target[prop] = value;

        // Apply runtime changes if terminal is open
        if (this.isOpen) {
          this.handleOptionChange(prop, value, oldValue);
        }

        return true;
      },
    });

    this.cols = this.options.cols;
    this.rows = this.options.rows;

    // Initialize buffer API
    this.buffer = new BufferNamespace(this);
  }

  // ==========================================================================
  // Option Change Handling (for mutable options)
  // ==========================================================================

  /**
   * Handle runtime option changes (called when options are modified after terminal is open)
   * This enables xterm.js compatibility where options can be changed at runtime
   */
  private handleOptionChange(key: string, newValue: any, oldValue: any): void {
    if (newValue === oldValue) return;

    switch (key) {
      case 'disableStdin':
        // Input handler already checks this.options.disableStdin dynamically
        // No action needed
        break;

      case 'cursorBlink':
      case 'cursorStyle':
        if (this.renderer) {
          this.renderer.setCursorStyle(this.options.cursorStyle);
          this.renderer.setCursorBlink(this.options.cursorBlink);
          if (this.wasmTerm?.backend === 'libghostty-vt') {
            this.wasmTerm.setDefaultCursorStyle(this.options.cursorStyle, this.options.cursorBlink);
          }
        }
        break;

      case 'theme':
        this.handleThemeChange();
        break;

      case 'fontSize':
        if (this.renderer) {
          this.renderer.setFontSize(this.options.fontSize);
          this.handleFontChange();
        }
        break;

      case 'fontFamily':
        if (this.renderer) {
          this.renderer.setFontFamily(this.options.fontFamily);
          this.handleFontChange();
        }
        break;

      case 'cols':
      case 'rows':
        // Redirect to resize method
        this.resize(this.options.cols, this.options.rows);
        break;
    }
  }

  /**
   * Handle font changes (fontSize or fontFamily)
   * Updates canvas size to match new font metrics and forces a full re-render
   */
  private handleFontChange(): void {
    if (!this.renderer || !this.wasmTerm || !this.canvas) return;

    // Clear any active selection since pixel positions have changed
    if (this.selectionManager) {
      this.selectionManager.clearSelection();
    }

    // The renderer sizes the canvas for the new metrics: CSS size, backing
    // store in device pixels and the matching context transform.
    this.renderer.resize(this.cols, this.rows);
    this.syncNativeCellSize();

    // Force full re-render with new font, keeping the scrollbar's current state
    this.renderer.render(this.wasmTerm, true, this.viewportY, this, this.scrollbarOpacity);
  }

  /**
   * Apply `options.theme` in place, with the same policy as the constructor
   * (missing entries fall back to the defaults). libghostty-vt updates its
   * default colors and palette without touching the buffer, history,
   * selection, parser or active SGR state; the renderer repaints with the new
   * theme on its next live frame (a synchronized-output frame being presented
   * keeps its colors until the hold ends).
   */
  private handleThemeChange(): void {
    if (!this.renderer || !this.wasmTerm) return;
    if (this.wasmTerm.backend !== 'libghostty-vt') {
      // The legacy engine resolves cell colors from its construction config
      // and has no way to change them; repainting only the renderer's colors
      // would mix two themes.
      console.warn(
        'ghostty-web: theme changes after open() need the libghostty-vt engine; ' +
          'the legacy engine keeps its construction theme'
      );
      return;
    }
    this.wasmTerm.setColors(this.buildWasmConfig());
    this.renderer.setTheme(this.options.theme ?? {});
    this.renderer.render(this.wasmTerm, false, this.viewportY, this, this.scrollbarOpacity);
  }

  /** Browser reports use CSS pixels, matching layout and mouse coordinates. */
  private syncNativeCellSize(drainResponses = true): void {
    if (this.wasmTerm?.backend !== 'libghostty-vt' || !this.renderer) return;
    const { width, height } = this.renderer.getMetrics();
    this.wasmTerm.setCellPixelSize(width, height);
    // Resize reports (mode 2048) must wait until the host's onResize listeners
    // have updated the PTY size; font-only changes can drain immediately.
    if (drainResponses) this.processTerminalResponses();
  }

  /** Lazily created, detached 1px canvas for browser CSS color normalization. */
  private cssColorContext?: CanvasRenderingContext2D | null;

  /** Parse supported CSS RGB colors; missing/invalid is distinct from explicit black. */
  private parseColorToHex(color?: string): number | undefined {
    if (!color) return undefined;
    if (/^#[0-9a-f]{3}$/i.test(color)) {
      return Number.parseInt(
        color
          .slice(1)
          .split('')
          .map((digit) => digit + digit)
          .join(''),
        16
      );
    }
    if (/^#[0-9a-f]{6}$/i.test(color)) return Number.parseInt(color.slice(1), 16);
    const match = color.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
    if (match) {
      const channels = match.slice(1).map(Number);
      if (channels.every((channel) => channel <= 255)) {
        return (channels[0] << 16) | (channels[1] << 8) | channels[2];
      }
    }
    // Let the same browser that paints the theme resolve named colors, opaque
    // rgba()/hsl(), and other CSS forms into sRGB. This runs only on configuration
    // changes, never in the render loop. Two sentinels detect invalid setters
    // (Canvas silently retains the old fillStyle for invalid CSS).
    if (typeof document === 'undefined') return undefined;
    if (this.cssColorContext === undefined) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      this.cssColorContext = canvas.getContext('2d', { willReadFrequently: true });
    }
    const ctx = this.cssColorContext;
    if (!ctx) return undefined;
    ctx.fillStyle = '#010203';
    ctx.fillStyle = color;
    const first = ctx.fillStyle;
    ctx.fillStyle = '#040506';
    ctx.fillStyle = color;
    if (first !== ctx.fillStyle) return undefined;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillRect(0, 0, 1, 1);
    const rgba = ctx.getImageData(0, 0, 1, 1).data;
    // OSC colors have no alpha channel. Keep the established unsupported-alpha
    // fallback instead of turning a transparent canvas theme into an opaque one.
    return rgba[3] === 255 ? (rgba[0] << 16) | (rgba[1] << 8) | rgba[2] : undefined;
  }

  /**
   * Convert terminal options to WASM terminal config.
   */
  private buildWasmConfig(): GhosttyTerminalConfig | undefined {
    const theme = this.options.theme;
    const scrollback = this.options.scrollback;

    // Build palette array from theme colors
    // Order: black, red, green, yellow, blue, magenta, cyan, white,
    //        brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightMagenta, brightCyan, brightWhite
    const palette = [
      this.parseColorToHex(theme?.black),
      this.parseColorToHex(theme?.red),
      this.parseColorToHex(theme?.green),
      this.parseColorToHex(theme?.yellow),
      this.parseColorToHex(theme?.blue),
      this.parseColorToHex(theme?.magenta),
      this.parseColorToHex(theme?.cyan),
      this.parseColorToHex(theme?.white),
      this.parseColorToHex(theme?.brightBlack),
      this.parseColorToHex(theme?.brightRed),
      this.parseColorToHex(theme?.brightGreen),
      this.parseColorToHex(theme?.brightYellow),
      this.parseColorToHex(theme?.brightBlue),
      this.parseColorToHex(theme?.brightMagenta),
      this.parseColorToHex(theme?.brightCyan),
      this.parseColorToHex(theme?.brightWhite),
    ];

    const foreground = this.parseColorToHex(theme?.foreground);
    // The engine's OSC 11 reply must describe the default the canvas paints.
    // Keep the low-level Ghostty facade defaults separate from this browser theme.
    const background = this.parseColorToHex(theme?.background ?? DEFAULT_THEME.background);
    const cursor = this.parseColorToHex(theme?.cursor);
    return {
      scrollbackLimit: scrollback,
      fgColor: foreground,
      bgColor: background,
      cursorColor: cursor,
      palette: palette.map((value) => value ?? 0),
      colorPresence: {
        foreground: foreground !== undefined,
        background: background !== undefined,
        cursor: cursor !== undefined,
        palette: palette.reduce<number>(
          (mask, value, index) => (value === undefined ? mask : mask | (1 << index)),
          0
        ),
      },
    };
  }

  // ==========================================================================
  // Lifecycle Methods
  // ==========================================================================

  /**
   * Open terminal in a parent element
   *
   * Initializes all components and starts rendering.
   * Requires a pre-loaded Ghostty instance passed to the constructor.
   */
  open(parent: HTMLElement): void {
    if (this.isOpen) {
      throw new Error('Terminal is already open');
    }
    if (this.isDisposed) {
      throw new Error('Terminal has been disposed');
    }

    // Store parent element
    this.element = parent;
    this.isOpen = true;
    this.browserSurface = new BrowserSurface();

    try {
      // Make parent focusable if it isn't already
      if (!parent.hasAttribute('tabindex')) {
        parent.setAttribute('tabindex', '0');
      }

      // Mark as contenteditable so browser extensions (Vimium, etc.) recognize
      // this as an input element and don't intercept keyboard events.
      parent.setAttribute('contenteditable', 'true');
      // Prevent actual content editing - we handle input ourselves
      this.browserSurface.listen(parent, 'beforeinput', this.handleContainerBeforeInput);

      // Add accessibility attributes for screen readers and extensions
      parent.setAttribute('role', 'textbox');
      parent.setAttribute('aria-label', 'Terminal input');
      parent.setAttribute('aria-multiline', 'true');

      // Create WASM terminal with current dimensions and config
      const config = this.buildWasmConfig();
      this.wasmTerm = this.ghostty!.createTerminal(this.cols, this.rows, config);
      // Native bells/titles replace the legacy byte/regex heuristics.
      if (this.wasmTerm.backend === 'libghostty-vt') {
        this.wasmTerm.enableHostEvents();
        // Synchronized output (2026): the renderer presents the frame each hold
        // began with (see GhosttyTerminal.getPresentation); buffer reads stay live.
        this.wasmTerm.enableRenderHold();
      }

      this.termio = new Termio(this.wasmTerm, {
        disposed: () => this.isDisposed || !this.isOpen,
        inputEnabled: () => !this.options.disableStdin,
        data: (data) => this.dataEmitter.fire(data, () => !this.isDisposed),
        bell: () => this.bellEmitter.fire(undefined, () => !this.isDisposed),
        title: (title) => {
          if (title !== this.currentTitle) {
            this.currentTitle = title;
            this.titleChangeEmitter.fire(title, () => !this.isDisposed);
          }
        },
        focusReport: () => this.surface?.reportFocus(),
      });
      this.surface = new Surface(this.wasmTerm, {
        disposed: () => this.isDisposed || !this.isOpen,
        scrollChanged: (offset, current) => {
          this.scrollEmitter.fire(offset, current);
        },
        activity: () => this.scrollbar?.noteActivity(),
        queueRender: () => this.rendererThread?.wakeup(),
        inputEnabled: () => !this.options.disableStdin,
        data: (data) => this.dataEmitter.fire(data),
      });

      // Create canvas element
      this.canvas = document.createElement('canvas');
      this.canvas.style.display = 'block';
      this.canvas.style.cursor = 'text';

      parent.appendChild(this.canvas);

      // Create hidden textarea for keyboard input (must be inside parent for event bubbling)
      this.textarea = document.createElement('textarea');
      this.textarea.setAttribute('autocorrect', 'off');
      this.textarea.setAttribute('autocapitalize', 'off');
      this.textarea.setAttribute('spellcheck', 'false');
      this.textarea.setAttribute('tabindex', '0'); // Allow focus for mobile keyboard
      this.textarea.setAttribute('aria-label', 'Terminal input');
      // Use clip-path to completely hide the textarea and its caret
      this.textarea.style.position = 'absolute';
      this.textarea.style.left = '0';
      this.textarea.style.top = '0';
      this.textarea.style.width = '1px';
      this.textarea.style.height = '1px';
      this.textarea.style.padding = '0';
      this.textarea.style.border = 'none';
      this.textarea.style.margin = '0';
      this.textarea.style.opacity = '0';
      this.textarea.style.clipPath = 'inset(50%)'; // Clip everything including caret
      this.textarea.style.overflow = 'hidden';
      this.textarea.style.whiteSpace = 'nowrap';
      this.textarea.style.resize = 'none';
      parent.appendChild(this.textarea);

      // Focus textarea on interaction - preventDefault before focus
      // Desktop: mousedown
      this.browserSurface.listen(this.canvas, 'mousedown', this.handleCanvasPointerFocus);
      // Mobile: touchend with preventDefault to suppress iOS caret
      this.browserSurface.listen(this.canvas, 'touchend', this.handleCanvasPointerFocus);

      // Create renderer
      this.renderer = new CanvasRenderer(this.canvas, {
        fontSize: this.options.fontSize,
        fontFamily: this.options.fontFamily,
        cursorStyle: this.options.cursorStyle,
        cursorBlink: this.options.cursorBlink,
        theme: this.options.theme,
      });

      // Size canvas to terminal dimensions (use renderer.resize for proper DPI scaling)
      this.renderer.resize(this.cols, this.rows);
      this.syncNativeCellSize();
      if (this.wasmTerm.backend === 'libghostty-vt') {
        this.wasmTerm.setDefaultCursorStyle(this.options.cursorStyle, this.options.cursorBlink);
      }

      // Create mouse tracking configuration
      const canvas = this.canvas;
      const renderer = this.renderer;
      // Read the handle lazily: never capture a wrapper that could outlive it.
      const mouseConfig: MouseTrackingConfig = {
        isReportingEnabled: () => !this.options.disableStdin && !this.isDraggingScrollbar,
        hasMouseTracking: () => this.wasmTerm?.hasMouseTracking() ?? false,
        hasSgrMouseMode: () => this.wasmTerm?.getMode(1006, false) ?? true, // SGR extended mode
        getCellDimensions: () => ({
          width: renderer.charWidth,
          height: renderer.charHeight,
        }),
        getCanvasOffset: () => {
          const rect = canvas.getBoundingClientRect();
          return { left: rect.left, top: rect.top };
        },
      };

      // Create input handler
      this.inputHandler = new InputHandler(
        this.ghostty!,
        parent,
        (data: string, preserveSelection = false, userInput = true) => {
          // Check if stdin is disabled
          if (this.options.disableStdin) {
            return;
          }
          // Modifier reports are protocol input, not typed text: keep local
          // selection available for Shift gestures and copy shortcuts.
          if (!preserveSelection) this.selectionManager?.clearSelection();
          if (this.isDisposed) return;
          if (userInput && !preserveSelection && data.length && !this.prepareUserInput()) return;
          this.awaitingEcho = true;
          // Input handler fires data events
          this.dataEmitter.fire(data);
        },
        () => {
          // Input handler can also fire bell
          this.bellEmitter.fire();
        },
        (keyEvent: IKeyEvent) => {
          // Forward key events
          this.keyEmitter.fire(keyEvent);
        },
        this.customKeyEventHandler,
        (mode: number) => {
          // Query terminal mode state (e.g., mode 1 for application cursor mode)
          return this.wasmTerm?.getMode(mode, false) ?? false;
        },
        () => {
          // Handle Cmd+C copy - returns true if there was a selection to copy
          return this.copySelection();
        },
        this.textarea,
        mouseConfig,
        () => this.wasmTerm,
        (data: string) => {
          if (this.isDisposed || this.options.disableStdin || !this.binaryEmitter.hasListeners)
            return false;
          this.selectionManager?.clearSelection();
          this.awaitingEcho = true;
          this.binaryEmitter.fire(data);
          return true;
        },
        () => !this.options.disableStdin
      );

      // Create selection manager (pass textarea for context menu positioning)
      this.selectionManager = new SelectionManager(
        this,
        this.renderer,
        this.wasmTerm,
        this.textarea
      );

      // Connect selection manager to renderer
      this.renderer.setSelectionManager(this.selectionManager);

      // Forward selection change events
      this.selectionManager.onSelectionChange(() => {
        this.selectionChangeEmitter.fire();
      });

      // Initialize link detection system
      this.linkDetector = new LinkDetector(this);

      // Register link providers
      // OSC8 first (explicit hyperlinks take precedence)
      this.linkDetector.registerProvider(new OSC8LinkProvider(this));
      // URL regex second (fallback for plain text URLs)
      this.linkDetector.registerProvider(new UrlRegexProvider(this));

      // Browser apprt owns DOM subscriptions and the toolkit scrollbar.
      this.scrollbar = new SurfaceScrollbar({
        canvas: this.canvas,
        read: () => this.surface!.snapshot,
        scrollToRow: (row) => this.surface?.performBindingAction({ kind: 'row', row }),
        requestRender: () => this.rendererThread?.wakeup(),
      });
      this.scrollbar.attach();
      this.browserSurface.listen(parent, 'mousemove', this.handleMouseMove);
      this.browserSurface.listen(parent, 'mouseleave', this.handleMouseLeave);
      this.browserSurface.listen(parent, 'click', this.handleClick);
      this.browserSurface.listen(parent, 'wheel', this.handleWheel, {
        passive: false,
        capture: true,
      });

      // Render initial blank screen (force full redraw)
      this.renderer.render(this.wasmTerm, true, this.viewportY, this, this.scrollbarOpacity);

      // Start render loop
      this.startRenderLoop();

      // Focus belongs to the whole terminal, not its internal textarea alone.
      if (this.wasmTerm.backend === 'libghostty-vt') {
        this.browserSurface.observeFocus(parent, (focused) => this.surface?.focusCallback(focused));
      }
      // Focus input (auto-focus so user can start typing immediately)
      this.focus();
    } catch (error) {
      // Clean up on error
      this.isOpen = false;
      this.cleanupComponents();
      throw new Error(`Failed to open terminal: ${error}`);
    }
  }

  /**
   * Write data to terminal
   */
  write(data: string | Uint8Array, callback?: () => void): void {
    this.assertOpen();

    // Handle convertEol option
    if (this.options.convertEol && typeof data === 'string') {
      data = data.replace(/\n/g, '\r\n');
    }

    this.writeInternal(data, callback);
  }

  /**
   * Internal write implementation (extracted from write())
   */
  private writeInternal(data: string | Uint8Array, callback?: () => void): void {
    // Note: We intentionally do NOT clear selection on write - most modern terminals
    // preserve selection when new data arrives. Selection is cleared by user actions
    // like clicking or typing, not by incoming data.

    const native = this.wasmTerm!.backend === 'libghostty-vt';
    let failed = false;
    let firstError: unknown;
    try {
      this.termio!.processOutput(data);
    } catch (error) {
      failed = true;
      firstError = error;
    }
    // Poll native state after effects, including a throwing or reentrant listener.
    if (!this.isDisposed) {
      this.surface!.afterWrite();
      this.linkDetector?.invalidateCache();
      try {
        this.surface!.sync();
      } catch (error) {
        if (!failed) {
          failed = true;
          firstError = error;
        }
      }
      if (!native && typeof data === 'string' && data.includes('\x1b]'))
        this.checkForTitleChange(data);
    }
    if (failed) throw firstError;
    if (this.isDisposed) return;

    // Call callback if provided
    if (callback) {
      // Queue callback after next render
      requestAnimationFrame(callback);
    }

    if (this.awaitingEcho) {
      this.awaitingEcho = false;
      if (this.renderer && this.wasmTerm) {
        this.renderer.render(this.wasmTerm, false, this.viewportY, this, this.scrollbarOpacity);
      }
    }

    // Render will happen on next animation frame
  }

  /**
   * Write data with newline
   */
  writeln(data: string | Uint8Array, callback?: () => void): void {
    if (typeof data === 'string') {
      this.write(data + '\r\n', callback);
    } else {
      // Append \r\n to Uint8Array
      const newData = new Uint8Array(data.length + 2);
      newData.set(data);
      newData[data.length] = 0x0d; // \r
      newData[data.length + 1] = 0x0a; // \n
      this.write(newData, callback);
    }
  }

  /** Resume following only actual user input, before a possibly synchronous PTY echo. */
  private prepareUserInput(): boolean {
    if (this.isDisposed || this.options.disableStdin) return false;
    if (!this.surface?.prepareUserInput(() => !this.options.disableStdin)) return false;
    // A scroll observer can dispose or disable input reentrantly.
    if (this.isDisposed || this.options.disableStdin) return false;
    this.awaitingEcho = true;
    return true;
  }

  /**
   * Paste text into terminal (triggers bracketed paste if supported)
   */
  paste(data: string): void {
    this.assertOpen();

    // Don't paste if stdin is disabled
    if (this.options.disableStdin) {
      return;
    }

    if (this.wasmTerm!.backend === 'libghostty-vt') {
      const bytes = this.wasmTerm!.encodePaste(data);
      if (bytes.length && this.prepareUserInput()) {
        this.dataEmitter.fire(new TextDecoder().decode(bytes));
      }
      return;
    }

    this.awaitingEcho = true;

    // Legacy retains its existing bracketed-paste behavior.
    if (this.wasmTerm!.hasBracketedPaste()) {
      // Wrap with bracketed paste sequences (DEC mode 2004)
      this.dataEmitter.fire('\x1b[200~' + data + '\x1b[201~');
    } else {
      // Send data directly
      this.dataEmitter.fire(data);
    }
  }

  /**
   * Input data into terminal (as if typed by user)
   *
   * @param data - Data to input
   * @param wasUserInput - If true, triggers onData event (default: false for compat with some apps)
   */
  input(data: string, wasUserInput: boolean = false): void {
    this.assertOpen();

    // Don't input if stdin is disabled
    if (this.options.disableStdin) {
      return;
    }

    if (wasUserInput) {
      if (data.length && !this.prepareUserInput()) return;
      this.awaitingEcho = true;
      // Trigger onData event as if user typed it
      this.dataEmitter.fire(data);
    } else {
      // Just write to terminal without triggering onData
      this.write(data);
    }
  }

  /**
   * Resize terminal
   */
  resize(cols: number, rows: number): void {
    this.assertOpen();

    if (cols === this.cols && rows === this.rows) {
      return; // No change
    }

    // Cancel render loop before resize to prevent accessing detached TypedArray
    // views while WASM reallocates buffers. We restart it after resize completes.
    // This avoids the background-tab regression of using an isResizing flag
    // cleared via requestAnimationFrame (rAF is throttled/paused in background tabs).
    this.cancelRenderLoop();
    this.resizeDepth++;
    this.termio!.suspend();
    let generation = 0;
    let failed = false;
    let firstError: unknown;
    const preserveError = (error: unknown) => {
      if (!failed) {
        failed = true;
        firstError = error;
      }
    };
    try {
      this.wasmTerm!.resize(cols, rows);
      this.cols = cols;
      this.rows = rows;
      generation = ++this.resizeGeneration;
      // Native PageList owns reflow; the legacy snapshot clamps its own offset.
      this.surface!.resetWheel();
      this.renderer!.resize(cols, rows);
      this.syncNativeCellSize(false);
      // A nested successful resize supersedes remaining notifications from
      // this one. An invalid nested request must not cancel the outer event.
      this.resizeEmitter.fire(
        { cols, rows },
        () => !this.isDisposed && generation === this.resizeGeneration
      );
    } catch (error) {
      preserveError(error);
    } finally {
      this.resizeDepth--;
      this.termio?.resume();
      try {
        // A nested resize may only change dimensions; publish its resolved
        // viewport at the outer commit, unless explicit nested navigation/write
        // already published a newer value through Surface.
        if (!this.isDisposed && this.resizeDepth === 0 && generation !== 0) this.surface!.sync();
      } catch (error) {
        preserveError(error);
      }
      if (!this.isDisposed && this.resizeDepth === 0) {
        try {
          this.renderer!.render(this.wasmTerm!, true, this.viewportY, this, this.scrollbarOpacity);
        } catch (error) {
          preserveError(error);
        }
        try {
          this.startRenderLoop();
        } catch (error) {
          preserveError(error);
        }
        // Even a throwing resize observer cannot strand a report behind later
        // user input. Data-listener failures must not mask an earlier error.
        try {
          this.processTerminalResponses();
        } catch (error) {
          preserveError(error);
        }
      }
    }
    if (failed) throw firstError;
  }

  /**
   * Clear terminal screen
   */
  clear(): void {
    this.assertOpen();
    // ED2 at a semantic shell prompt can append the active screen to history.
    // Use the native host path so its anchor, scroll events and caches agree
    // with write() of the same bytes; retain legacy's established clear policy.
    if (this.wasmTerm!.backend === 'libghostty-vt') this.writeInternal('\x1b[2J\x1b[H');
    else this.wasmTerm!.write('\x1b[2J\x1b[H');
  }

  /**
   * Perform a full terminal reset (RIS, like xterm.js `reset()`).
   *
   * Contract:
   * - The reset happens in place on the same WASM terminal handle, so every
   *   component keeps a valid reference (no freed or stale wrapper).
   * - Screen and scrollback are cleared, the primary screen is active, the
   *   cursor is at the home position and visible, and all terminal modes,
   *   charsets, tab stops, scroll region and keyboard protocol state return to
   *   their defaults. ghostty-web's default of grapheme clustering (mode 2027)
   *   is re-applied.
   * - Construction-time configuration is kept: theme colors, palette and
   *   scrollback limit, dimensions and all options.
   * - Host state is cleared: selection, viewport (scrolled back to the bottom,
   *   firing `onScroll` if it moved), hovered links, link cache and title.
   * - Any partially received escape sequence is discarded.
   */
  reset(): void {
    this.assertOpen();

    // Host state first, so nothing renders against the pre-reset buffer.
    this.inputHandler?.resetMouseState();
    this.surface!.resetInput();
    this.selectionManager?.clearSelection();
    this.currentHoveredLink?.hover?.(false);
    this.currentHoveredLink = undefined;
    this.renderer?.setHoveredHyperlinkId(0);
    this.renderer?.setHoveredLinkRange(null);
    this.linkDetector?.invalidateCache();
    this.currentTitle = '';

    // RIS (ESC c) is an "anywhere" transition, so it also aborts a partial
    // sequence. RIS restores the core's default modes, which do not include
    // ghostty-web's grapheme-clustering default, so re-enable mode 2027.
    this.wasmTerm!.write('\x1bc\x1b[?2027h');
    // RIS produces no replies; drop anything a partial query may have left.
    while (this.wasmTerm!.readResponse() !== null) {
      // discard
    }
    // Native bells/titles not yet dispatched belong to the discarded state
    // (also when a listener resets mid-dispatch).
    if (this.wasmTerm!.backend === 'libghostty-vt') this.wasmTerm!.takeHostEvents();
    this.termio?.clear();
    this.lastCursorY = 0;

    this.renderer!.clear();
    this.renderer!.render(this.wasmTerm!, true, this.viewportY, this, this.scrollbarOpacity);
    // Observers must see the reset buffer, not the old history with a new viewport.
    this.surface!.sync();
  }

  /**
   * Focus terminal input
   */
  focus(): void {
    if (this.isOpen && this.element) {
      // Focus immediately for immediate keyboard/wheel event handling
      this.element.focus();
      // Native focus reporting is synchronous. A delayed refocus would steal
      // focus back after blur() or a click elsewhere and emit a spurious report.
      if (this.wasmTerm?.backend === 'libghostty-vt') return;

      // Also schedule a delayed focus as backup to ensure it sticks
      // (some browsers may need this if DOM isn't fully settled)
      if (this.focusTimeout !== undefined) clearTimeout(this.focusTimeout);
      this.focusTimeout = setTimeout(() => {
        this.focusTimeout = undefined;
        this.element?.focus();
      }, 0);
    }
  }

  /**
   * Blur terminal (remove focus)
   */
  blur(): void {
    if (this.isOpen && this.element) {
      if (this.wasmTerm?.backend === 'libghostty-vt') {
        if (this.focusTimeout !== undefined) clearTimeout(this.focusTimeout);
        this.focusTimeout = undefined;
        const active = this.activeElement();
        // A clicked terminal focuses its textarea, so blurring only the outer
        // contenteditable element would leave terminal input focused.
        if (active !== this.element && this.element.contains(active)) {
          (active as HTMLElement | null)?.blur?.();
        }
      }
      this.element.blur();
    }
  }

  /**
   * Load an addon
   */
  loadAddon(addon: ITerminalAddon): void {
    addon.activate(this);
    this.addons.push(addon);
  }

  // ==========================================================================
  // Selection API (xterm.js compatible)
  // ==========================================================================

  /**
   * Get the selected text as a string
   */
  public getSelection(): string {
    return this.selectionManager?.getSelection() || '';
  }

  /**
   * Check if there's an active selection
   */
  public hasSelection(): boolean {
    return this.selectionManager?.hasSelection() || false;
  }

  /**
   * Clear the current selection
   */
  public clearSelection(): void {
    this.selectionManager?.clearSelection();
  }

  /**
   * Copy the current selection to clipboard
   * @returns true if there was text to copy, false otherwise
   */
  public copySelection(): boolean {
    return this.selectionManager?.copySelection() || false;
  }

  /**
   * Select all text in the terminal
   */
  public selectAll(): void {
    this.selectionManager?.selectAll();
  }

  /**
   * Select text at specific column and row with length
   */
  public select(column: number, row: number, length: number): void {
    this.selectionManager?.select(column, row, length);
  }

  /**
   * Select entire lines from start to end
   */
  public selectLines(start: number, end: number): void {
    this.selectionManager?.selectLines(start, end);
  }

  /**
   * Get selection position as buffer range
   */
  /**
   * Get the current viewport Y position.
   *
   * This is the number of lines scrolled back from the bottom of the
   * scrollback buffer. Logical positions are whole rows.
   */
  public getViewportY(): number {
    return this.viewportY;
  }

  public getSelectionPosition(): IBufferRange | undefined {
    return this.selectionManager?.getSelectionPosition();
  }

  // ==========================================================================
  // Phase 1: Custom Event Handlers
  // ==========================================================================

  /**
   * Attach a custom keyboard event handler
   * Returns true to prevent default handling
   */
  public attachCustomKeyEventHandler(
    customKeyEventHandler: (event: KeyboardEvent) => boolean
  ): void {
    this.customKeyEventHandler = customKeyEventHandler;
    // Update input handler if already created
    if (this.inputHandler) {
      this.inputHandler.setCustomKeyEventHandler(customKeyEventHandler);
    }
  }

  /**
   * Attach a custom wheel event handler (Phase 2)
   * Returns true to prevent default handling
   */
  public attachCustomWheelEventHandler(
    customWheelEventHandler?: (event: WheelEvent) => boolean
  ): void {
    this.customWheelEventHandler = customWheelEventHandler;
  }

  // ==========================================================================
  // Link Detection Methods
  // ==========================================================================

  /**
   * Register a custom link provider
   * Multiple providers can be registered to detect different types of links
   *
   * @example
   * ```typescript
   * term.registerLinkProvider({
   *   provideLinks(y, callback) {
   *     // Detect URLs, file paths, etc.
   *     callback(detectedLinks);
   *   }
   * });
   * ```
   */
  public registerLinkProvider(provider: ILinkProvider): void {
    if (!this.linkDetector) {
      throw new Error('Terminal must be opened before registering link providers');
    }
    this.linkDetector.registerProvider(provider);
  }

  // ==========================================================================
  // Phase 2: Scrolling Methods
  // ==========================================================================

  /**
   * Scroll viewport by a number of lines
   * @param amount Number of lines to scroll (positive = down, negative = up)
   */
  public scrollLines(amount: number): void {
    this.assertOpen();
    if (!Number.isFinite(amount)) return;
    this.surface!.performBindingAction({ kind: 'delta', rows: Math.trunc(amount) });
  }

  public scrollPages(amount: number): void {
    this.scrollLines(amount * this.rows);
  }
  public scrollToTop(): void {
    // Public compatibility: an empty history's top is the following position.
    this.surface?.performBindingAction({
      kind: this.getScrollbackLength() === 0 ? 'bottom' : 'top',
    });
  }
  public scrollToBottom(): void {
    this.surface?.performBindingAction({ kind: 'bottom' });
  }

  /**
   * Scroll viewport to a specific line in the buffer
   * @param line Line number (0 = top of scrollback, scrollbackLength = bottom)
   */
  public scrollToLine(line: number): void {
    // Public compatibility mapping only, never another native viewport owner.
    this.surface?.setOffset(line);
  }

  /**
   * Dispose terminal and clean up resources
   */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }

    this.isDisposed = true;
    this.isOpen = false;

    // Stop render loop, animations and timers; clear write queue
    this.stopTimersAndAnimations();
    this.termio?.clear();

    // Dispose addons. A failing addon must not stop the remaining cleanup;
    // its error is rethrown once everything has been released.
    const addonErrors: unknown[] = [];
    for (const addon of this.addons) {
      try {
        addon.dispose();
      } catch (error) {
        addonErrors.push(error);
      }
    }
    this.addons = [];

    // Clean up components
    this.cleanupComponents();

    // Dispose event emitters
    this.dataEmitter.dispose();
    this.binaryEmitter.dispose();
    this.resizeEmitter.dispose();
    this.bellEmitter.dispose();
    this.selectionChangeEmitter.dispose();
    this.keyEmitter.dispose();
    this.titleChangeEmitter.dispose();
    this.scrollEmitter.dispose();
    this.renderEmitter.dispose();
    this.cursorMoveEmitter.dispose();

    if (addonErrors.length === 1) throw addonErrors[0];
    if (addonErrors.length > 1) {
      const error = new Error(`${addonErrors.length} addons failed to dispose`);
      (error as Error & { errors: unknown[] }).errors = addonErrors;
      throw error;
    }
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Stop every timer and animation frame owned by the terminal (idempotent).
   */
  private stopTimersAndAnimations(): void {
    this.cancelRenderLoop();
    this.scrollbar?.dispose();
    this.browserSurface?.dispose();
    if (this.mouseMoveThrottleTimeout) clearTimeout(this.mouseMoveThrottleTimeout);
    this.mouseMoveThrottleTimeout = undefined;
    this.pendingMouseMove = undefined;
    if (this.focusTimeout !== undefined) clearTimeout(this.focusTimeout);
    this.focusTimeout = undefined;
  }

  private activeElement(): Element | null {
    const root = this.element?.getRootNode();
    return root && 'activeElement' in root ? (root as Document | ShadowRoot).activeElement : null;
  }

  /** Keep `beforeinput` on the contenteditable container from editing it. */
  private handleContainerBeforeInput = (e: Event): void => {
    if (e.target === this.element) {
      e.preventDefault();
    }
  };

  /** Focus the hidden textarea on canvas mousedown/touchend. */
  private handleCanvasPointerFocus = (e: Event): void => {
    e.preventDefault();
    this.textarea?.focus();
  };

  /**
   * Cancel the render loop
   */
  private cancelRenderLoop(): void {
    this.rendererThread?.stop();
  }

  /**
   * Start the render loop
   */
  private startRenderLoop(): void {
    if (!this.rendererThread) {
      this.rendererThread = new RendererThread((timestamp) => {
        if (this.isDisposed || !this.isOpen || !this.renderer || !this.wasmTerm) return;
        this.renderer.render(
          this.wasmTerm,
          false,
          this.viewportY,
          this,
          this.scrollbarOpacity,
          timestamp
        );
        this.surface?.sync();
        if (this.isDisposed || !this.wasmTerm) return;
        const cursor = this.wasmTerm.getCursor();
        if (cursor.y !== this.lastCursorY) {
          this.lastCursorY = cursor.y;
          this.cursorMoveEmitter.fire(undefined, () => !this.isDisposed);
        }
      });
    }
    this.rendererThread.start();
  }

  /**
   * Get a line from native WASM scrollback buffer
   * Implements IScrollbackProvider
   */
  public getScrollbackLine(offset: number): GhosttyCell[] | null {
    if (!this.wasmTerm) return null;
    return this.wasmTerm.getScrollbackLine(offset);
  }

  /**
   * Get scrollback length from native WASM
   * Implements IScrollbackProvider
   */
  public getScrollbackLength(): number {
    if (!this.wasmTerm) return 0;
    return this.wasmTerm.getScrollbackLength();
  }

  /** Cluster lookup paired with getScrollbackLine for renderer history rows. */
  public getScrollbackGraphemeString(offset: number, col: number): string {
    return this.wasmTerm?.getScrollbackGraphemeString(offset, col) ?? ' ';
  }

  /**
   * Clean up components (called on dispose or error)
   */
  private cleanupComponents(): void {
    // Also reached from a failed open(): stop anything that may have started.
    this.stopTimersAndAnimations();
    // Dispose selection manager
    if (this.selectionManager) {
      this.selectionManager.dispose();
      this.selectionManager = undefined;
    }

    // Dispose input handler
    if (this.inputHandler) {
      this.inputHandler.dispose();
      this.inputHandler = undefined;
    }

    // Dispose renderer
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = undefined;
    }

    // BrowserSurface already detached listeners; now remove the canvas from DOM.
    if (this.canvas) {
      this.canvas.parentNode?.removeChild(this.canvas);
      this.canvas = undefined;
    }

    // Remove textarea from DOM
    if (this.textarea && this.textarea.parentNode) {
      this.textarea.parentNode.removeChild(this.textarea);
      this.textarea = undefined;
    }

    if (this.element) {
      // Remove contenteditable and accessibility attributes added in open()
      this.element.removeAttribute('contenteditable');
      this.element.removeAttribute('role');
      this.element.removeAttribute('aria-label');
      this.element.removeAttribute('aria-multiline');
    }

    this.surface?.dispose();
    this.surface = undefined;
    this.termio?.dispose();
    this.termio = undefined;
    this.rendererThread?.dispose();
    this.rendererThread = undefined;
    this.scrollbar = undefined;
    this.browserSurface = undefined;

    // Dispose link detector
    if (this.linkDetector) {
      this.linkDetector.dispose();
      this.linkDetector = undefined;
    }

    // Free WASM terminal
    if (this.wasmTerm) {
      this.wasmTerm.free();
      this.wasmTerm = undefined;
    }

    // Clear references
    this.ghostty = undefined;
    this.element = undefined;
    this.textarea = undefined;
  }

  /**
   * Assert terminal is open (throw if not)
   */
  private assertOpen(): void {
    if (this.isDisposed) {
      throw new Error('Terminal has been disposed');
    }
    if (!this.isOpen) {
      throw new Error('Terminal must be opened before use. Call terminal.open(parent) first.');
    }
  }

  /** Handle link hover motion, throttled independently from document-level scrollbar dragging. */
  private handleMouseMove = (e: MouseEvent): void => {
    if (!this.canvas || !this.renderer || !this.wasmTerm) return;

    // If dragging scrollbar, handle immediately without throttling
    if (this.isDraggingScrollbar) return;

    if (!this.linkDetector) return;

    // Throttle to ~60fps (16ms) to avoid blocking scroll/other events
    if (this.mouseMoveThrottleTimeout) {
      this.pendingMouseMove = e;
      return;
    }

    this.processMouseMove(e);

    this.mouseMoveThrottleTimeout = window.setTimeout(() => {
      this.mouseMoveThrottleTimeout = undefined;
      if (this.pendingMouseMove) {
        const pending = this.pendingMouseMove;
        this.pendingMouseMove = undefined;
        this.processMouseMove(pending);
      }
    }, 16);
  };

  /**
   * Process mouse move for link detection (internal, called by throttled handler)
   */
  private processMouseMove(e: MouseEvent): void {
    if (!this.canvas || !this.renderer || !this.linkDetector || !this.wasmTerm) return;

    // Convert mouse coordinates to terminal cell position
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / this.renderer.charWidth);
    const y = Math.floor((e.clientY - rect.top) / this.renderer.charHeight);

    // Get hyperlink_id directly from the cell at this position
    // Must account for viewportY (scrollback position)
    const viewportRow = y; // Row in the viewport (0 to rows-1)
    let hyperlinkId = 0;

    // Public buffer reads address the active screen/history, unlike the native
    // render view. Convert the whole-row compatibility offset for link lookup.
    let line: GhosttyCell[] | null = null;
    const rawViewportY = this.getViewportY();
    const viewportY = Math.max(0, Math.floor(rawViewportY));
    if (viewportY > 0) {
      const scrollbackLength = this.wasmTerm.getScrollbackLength();
      if (viewportRow < viewportY) {
        // Mouse is over scrollback content
        const scrollbackOffset = scrollbackLength - viewportY + viewportRow;
        line = this.wasmTerm.getScrollbackLine(scrollbackOffset);
      } else {
        // Mouse is over screen content (bottom part of viewport)
        const screenRow = viewportRow - viewportY;
        line = this.wasmTerm.getLine(screenRow);
      }
    } else {
      // At bottom - just use screen buffer
      line = this.wasmTerm.getLine(viewportRow);
    }

    if (line && x >= 0 && x < line.length) {
      hyperlinkId = line[x].hyperlink_id;
    }

    // Update renderer for underline rendering
    const previousHyperlinkId = (this.renderer as any).hoveredHyperlinkId || 0;
    if (hyperlinkId !== previousHyperlinkId) {
      this.renderer.setHoveredHyperlinkId(hyperlinkId);

      // The 60fps render loop will pick up the change automatically
      // No need to force a render - this keeps performance smooth
    }

    // Check if there's a link at this position (for click handling and cursor)
    // Buffer API expects absolute buffer coordinates (including scrollback)
    // When scrolled, we need to adjust the buffer row based on viewportY
    const scrollbackLength = this.wasmTerm.getScrollbackLength();
    let bufferRow: number;

    // Use floored viewportY for buffer mapping (must match renderer & selection)
    const rawViewportYForBuffer = this.getViewportY();
    const viewportYForBuffer = Math.max(0, Math.floor(rawViewportYForBuffer));

    if (viewportYForBuffer > 0) {
      // When scrolled, the buffer row depends on where in the viewport we are
      if (viewportRow < viewportYForBuffer) {
        // Mouse is over scrollback content
        bufferRow = scrollbackLength - viewportYForBuffer + viewportRow;
      } else {
        // Mouse is over screen content (bottom part of viewport)
        const screenRow = viewportRow - viewportYForBuffer;
        bufferRow = scrollbackLength + screenRow;
      }
    } else {
      // At bottom - buffer row is scrollback + screen row
      bufferRow = scrollbackLength + viewportRow;
    }

    // Make async call non-blocking - don't await
    this.linkDetector
      .getLinkAt(x, bufferRow)
      .then((link) => {
        // Update hover state for cursor changes and click handling
        if (link !== this.currentHoveredLink) {
          // Notify old link we're leaving
          this.currentHoveredLink?.hover?.(false);

          // Update current link
          this.currentHoveredLink = link;

          // Notify new link we're entering
          link?.hover?.(true);

          // Update cursor style on both container and canvas
          const cursorStyle = link ? 'pointer' : 'text';
          if (this.element) {
            this.element.style.cursor = cursorStyle;
          }
          if (this.canvas) {
            this.canvas.style.cursor = cursorStyle;
          }

          // Update renderer for underline (for regex URLs without hyperlink_id)
          if (this.renderer) {
            if (link) {
              // Convert buffer coordinates to viewport coordinates
              const scrollbackLength = this.wasmTerm?.getScrollbackLength() || 0;

              // Calculate viewport Y for start and end positions
              // Use floored viewportY so overlay rows match renderer & selection
              const rawViewportYForLinks = this.getViewportY();
              const viewportYForLinks = Math.max(0, Math.floor(rawViewportYForLinks));
              const startViewportY = link.range.start.y - scrollbackLength + viewportYForLinks;
              const endViewportY = link.range.end.y - scrollbackLength + viewportYForLinks;

              // Only show underline if link is visible in viewport
              if (startViewportY < this.rows && endViewportY >= 0) {
                this.renderer.setHoveredLinkRange({
                  startX: link.range.start.x,
                  startY: Math.max(0, startViewportY),
                  endX: link.range.end.x,
                  endY: Math.min(this.rows - 1, endViewportY),
                });
              } else {
                this.renderer.setHoveredLinkRange(null);
              }
            } else {
              this.renderer.setHoveredLinkRange(null);
            }
          }
        }
      })
      .catch((err) => {
        console.warn('Link detection error:', err);
      });
  }

  /**
   * Handle mouse leave to clear link hover
   */
  private handleMouseLeave = (): void => {
    // Clear hyperlink underline
    if (this.renderer && this.wasmTerm) {
      const previousHyperlinkId = (this.renderer as any).hoveredHyperlinkId || 0;
      if (previousHyperlinkId > 0) {
        this.renderer.setHoveredHyperlinkId(0);

        // The 60fps render loop will pick up the change automatically
      }
      // Clear regex link underline
      this.renderer.setHoveredLinkRange(null);
    }

    if (this.currentHoveredLink) {
      // Notify link we're leaving
      this.currentHoveredLink.hover?.(false);

      // Clear hovered link
      this.currentHoveredLink = undefined;

      // Reset cursor
      if (this.element) {
        this.element.style.cursor = 'text';
        if (this.canvas) {
          this.canvas.style.cursor = 'text';
        }
      }
    }
  };

  /**
   * Handle mouse click for link activation
   */
  private handleClick = async (e: MouseEvent): Promise<void> => {
    // Native-tracked clicks belong to the TUI, not local hyperlink activation.
    if (
      this.wasmTerm?.backend === 'libghostty-vt' &&
      !this.options.disableStdin &&
      this.wasmTerm.hasMouseTracking() &&
      !e.shiftKey
    )
      return;

    // For more reliable clicking, detect the link at click time
    // rather than relying on cached hover state (avoids async races)
    if (!this.canvas || !this.renderer || !this.linkDetector || !this.wasmTerm) return;

    // Get click position
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / this.renderer.charWidth);
    const y = Math.floor((e.clientY - rect.top) / this.renderer.charHeight);

    // Calculate buffer row (same logic as processMouseMove)
    const viewportRow = y;
    const scrollbackLength = this.wasmTerm.getScrollbackLength();
    let bufferRow: number;

    // Use floored viewportY for buffer mapping (must match renderer & selection)
    const rawViewportYForClick = this.getViewportY();
    const viewportYForClick = Math.max(0, Math.floor(rawViewportYForClick));

    if (viewportYForClick > 0) {
      if (viewportRow < viewportYForClick) {
        bufferRow = scrollbackLength - viewportYForClick + viewportRow;
      } else {
        const screenRow = viewportRow - viewportYForClick;
        bufferRow = scrollbackLength + screenRow;
      }
    } else {
      bufferRow = scrollbackLength + viewportRow;
    }

    // Get the link at this position
    const link = await this.linkDetector.getLinkAt(x, bufferRow);

    if (link) {
      // Activate link
      link.activate(e);

      // Prevent default action if modifier key held
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
      }
    }
  };

  /**
   * Handle wheel events for scrolling (Phase 2)
   */
  private handleWheel = (event: WheelEvent): void => {
    this.surface?.scrollCallback(event, {
      cellHeight: this.renderer?.getMetrics().height ?? 20,
      rows: this.rows,
      inputEnabled: !this.options.disableStdin,
      custom: this.customWheelEventHandler,
      reportMouse: (e) => this.inputHandler?.handleNativeWheel(e) ?? false,
      sendData: (data) => {
        if (!this.isDisposed && !this.options.disableStdin) this.dataEmitter.fire(data);
      },
    });
  };

  private processTerminalResponses(): void {
    this.termio?.flush();
  }

  /**
   * Check for title changes in written data (OSC sequences)
   * Simplified implementation - looks for OSC 0, 1, 2
   */
  private checkForTitleChange(data: string): void {
    // OSC sequences: ESC ] Ps ; Pt BEL or ESC ] Ps ; Pt ST
    // OSC 0 = icon + title, OSC 1 = icon, OSC 2 = title
    const oscRegex = /\x1b\]([012]);([^\x07\x1b]*?)(?:\x07|\x1b\\)/g;
    let match: RegExpExecArray | null = null;

    // biome-ignore lint/suspicious/noAssignInExpressions: Standard regex pattern
    while ((match = oscRegex.exec(data)) !== null) {
      const ps = match[1];
      const pt = match[2];

      // OSC 0 and OSC 2 set the title
      if (ps === '0' || ps === '2') {
        if (pt !== this.currentTitle) {
          this.currentTitle = pt;
          this.titleChangeEmitter.fire(pt);
        }
      }
    }
  }

  // ============================================================================
  // Terminal Modes
  // ============================================================================

  /**
   * Query terminal mode state
   *
   * @param mode Mode number (e.g., 2004 for bracketed paste)
   * @param isAnsi True for ANSI modes, false for DEC modes (default: false)
   * @returns true if mode is enabled
   */
  public getMode(mode: number, isAnsi: boolean = false): boolean {
    this.assertOpen();
    return this.wasmTerm!.getMode(mode, isAnsi);
  }

  /**
   * Check if bracketed paste mode is enabled
   */
  public hasBracketedPaste(): boolean {
    this.assertOpen();
    return this.wasmTerm!.hasBracketedPaste();
  }

  /**
   * Check if focus event reporting is enabled
   */
  public hasFocusEvents(): boolean {
    this.assertOpen();
    return this.wasmTerm!.hasFocusEvents();
  }

  /**
   * Check if mouse tracking is enabled
   */
  public hasMouseTracking(): boolean {
    this.assertOpen();
    return this.wasmTerm!.hasMouseTracking();
  }
}
