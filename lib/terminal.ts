/**
 * Terminal - Full browser terminal emulator
 *
 * Extends TerminalCore with DOM/browser-specific functionality:
 * - Canvas rendering
 * - Keyboard input handling
 * - Selection and clipboard
 * - Link detection
 * - Scrollbar UI
 */

import { EventEmitter } from './event-emitter';
import type { GhosttyCell, GhosttyTerminalConfig } from './ghostty';
import { getGhostty } from './index';
import { InputHandler, type MouseTrackingConfig } from './input-handler';
import type {
  IBufferRange,
  IDisposable,
  IEvent,
  IKeyEvent,
  ITerminalAddon,
  ITerminalOptions,
  ITheme,
  IUnicodeVersionProvider,
} from './interfaces';
import { LinkDetector } from './link-detector';
import { OSC8LinkProvider } from './providers/osc8-link-provider';
import { UrlRegexProvider } from './providers/url-regex-provider';
import { CanvasRenderer, DEFAULT_THEME, type IRenderable } from './renderer';
import { SelectionManager } from './selection-manager';
import { TerminalCore } from './terminal-core';
import type { ILink, ILinkProvider } from './types';

function parseCssColorToRgb(
  input: string | undefined,
  fallback: { r: number; g: number; b: number }
): { r: number; g: number; b: number } {
  const raw = String(input || '').trim();
  if (!raw) return fallback;

  if (raw.startsWith('#')) {
    const hex = raw.slice(1);
    const full =
      hex.length === 3
        ? hex
            .split('')
            .map((c) => c + c)
            .join('')
        : hex;
    if (/^[0-9a-fA-F]{6}$/.test(full)) {
      const value = Number.parseInt(full, 16);
      return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
    }
  }

  const rgbMatch = raw.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (rgbMatch) {
    return {
      r: Number.parseInt(rgbMatch[1], 10),
      g: Number.parseInt(rgbMatch[2], 10),
      b: Number.parseInt(rgbMatch[3], 10),
    };
  }

  return fallback;
}

function createBlankBootstrapCells(
  cols: number,
  rows: number,
  colors: { foreground: string; background: string }
): GhosttyCell[][] {
  const fg = parseCssColorToRgb(colors.foreground, { r: 212, g: 212, b: 212 });
  const bg = parseCssColorToRgb(colors.background, { r: 30, g: 30, b: 30 });
  const cell: GhosttyCell = {
    codepoint: 32,
    fg_r: fg.r,
    fg_g: fg.g,
    fg_b: fg.b,
    bg_r: bg.r,
    bg_g: bg.g,
    bg_b: bg.b,
    fgIsDefault: false,
    bgIsDefault: false,
    flags: 0,
    width: 1,
    hyperlink_id: 0,
    grapheme_len: 0,
  };
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({ ...cell })));
}

// ============================================================================
// Terminal Class - Full Browser Terminal
// ============================================================================

export class Terminal extends TerminalCore {
  // Unicode API (xterm.js compatibility)
  public readonly unicode: IUnicodeVersionProvider = {
    get activeVersion(): string {
      return '15.1';
    },
  };

  // Browser-specific DOM elements
  public element?: HTMLElement;
  public textarea?: HTMLTextAreaElement;

  // Browser-specific components
  public renderer?: CanvasRenderer;
  private inputHandler?: InputHandler;
  private selectionManager?: SelectionManager;
  private canvas?: HTMLCanvasElement;

  // Link detection
  private linkDetector?: LinkDetector;
  private currentHoveredLink?: ILink;
  private mouseMoveThrottleTimeout?: number;
  private pendingMouseMove?: MouseEvent;

  // Browser-specific event emitters
  private selectionChangeEmitter = new EventEmitter<void>();
  private keyEmitter = new EventEmitter<IKeyEvent>();
  private renderEmitter = new EventEmitter<{ start: number; end: number }>();
  private mouseCursorChangeEmitter = new EventEmitter<string>();

  // Browser-specific events
  public readonly onSelectionChange: IEvent<void> = this.selectionChangeEmitter.event;
  public readonly onKey: IEvent<IKeyEvent> = this.keyEmitter.event;
  public readonly onRender: IEvent<{ start: number; end: number }> = this.renderEmitter.event;
  /** Fires when the application changes the mouse cursor via OSC 22.
   *  The value is a CSS cursor name (e.g. "default", "crosshair", "wait"). */
  public readonly onMouseCursorChange: IEvent<string> = this.mouseCursorChangeEmitter.event;

  // Lifecycle state
  private isOpen = false;
  private animationFrameId?: number;
  private writeQueue: Uint8Array[] = [];

  // Issue #161 (echo latency): synchronous render on PTY echo
  private awaitingEcho = false;

  // Synchronized output (DEC mode 2026): timestamp when sync began; renders
  // are deferred while active but force-flush after SYNC_OUTPUT_TIMEOUT_MS.
  private syncOutputStartTime: number | undefined = undefined;
  private static readonly SYNC_OUTPUT_TIMEOUT_MS = 500;

  // Theme state for partial merge support
  private currentTheme: Required<ITheme> = { ...DEFAULT_THEME };

  // Custom event handlers
  private customKeyEventHandler?: (event: KeyboardEvent) => boolean;

  // Viewport and scrolling state (viewportY aliases TerminalCore._viewportY)
  get viewportY(): number {
    return this._viewportY;
  }
  set viewportY(v: number) {
    this._viewportY = v;
  }

  private targetViewportY: number = 0;
  private scrollAnimationStartTime?: number;
  private scrollAnimationStartY?: number;
  private scrollAnimationFrame?: number;
  private customWheelEventHandler?: (event: WheelEvent) => boolean;

  // Scrollbar interaction state
  private isDraggingScrollbar: boolean = false;
  private scrollbarDragStart: number | null = null;
  private scrollbarDragStartViewportY: number = 0;

  // Scrollbar visibility/auto-hide state
  private scrollbarVisible: boolean = false;
  private scrollbarOpacity: number = 0;
  private scrollbarHideTimeout?: number;
  private readonly SCROLLBAR_HIDE_DELAY_MS = 1500;
  private readonly SCROLLBAR_FADE_DURATION_MS = 200;

  // Bootstrap blank state
  private bootstrapCells: GhosttyCell[][] | null = null;
  private bootstrapDirty: boolean = false;
  private bootstrapBuffer: IRenderable;

  constructor(options: ITerminalOptions = {}) {
    const ghostty = options.ghostty ?? getGhostty();
    super(ghostty, options);

    this.currentTheme = { ...DEFAULT_THEME, ...options.theme };

    this.bootstrapBuffer = {
      getLine: (y: number) => {
        if (this.bootstrapCells && y >= 0 && y < this.bootstrapCells.length) {
          return this.bootstrapCells[y];
        }
        return this.wasmTerm?.getLine(y) ?? null;
      },
      getCursor: () => {
        if (this.bootstrapCells) return { x: 0, y: 0, visible: true };
        return this.wasmTerm?.getCursor() ?? { x: 0, y: 0, visible: true };
      },
      getDimensions: () => ({ cols: this.cols, rows: this.rows }),
      isRowDirty: (y: number) => {
        if (this.bootstrapDirty) return true;
        if (this.bootstrapCells) return false;
        return this.wasmTerm?.isRowDirty(y) ?? false;
      },
      needsFullRedraw: () => {
        if (this.bootstrapDirty) return true;
        if (this.bootstrapCells) return false;
        const wasmTerm = this.wasmTerm as unknown as
          | { needsFullRedraw?: () => boolean }
          | undefined;
        return wasmTerm?.needsFullRedraw?.() ?? false;
      },
      clearDirty: () => {
        this.bootstrapDirty = false;
        this.wasmTerm?.clearDirty();
      },
      getGraphemeString: (row: number, col: number) => {
        if (this.bootstrapCells && row >= 0 && row < this.bootstrapCells.length) {
          const cell = this.bootstrapCells[row]?.[col];
          return cell ? String.fromCodePoint(cell.codepoint || 32) : ' ';
        }
        const wasmTerm = this.wasmTerm as unknown as
          | { getGraphemeString?: (row: number, col: number) => string }
          | undefined;
        return wasmTerm?.getGraphemeString?.(row, col) ?? ' ';
      },
    };
  }

  // ==========================================================================
  // Option Change Handling (browser-specific overrides)
  // ==========================================================================

  protected override handleOptionChange(key: string, newValue: any, oldValue: any): void {
    if (newValue === oldValue) return;

    switch (key) {
      case 'disableStdin':
        break;

      case 'cursorBlink':
      case 'cursorStyle':
        if (this.renderer) {
          this.renderer.setCursorStyle(this.options.cursorStyle);
          this.renderer.setCursorBlink(this.options.cursorBlink);
        }
        break;

      case 'theme':
        if (this.renderer && this.wasmTerm) {
          const incoming = newValue && typeof newValue === 'object' ? newValue : {};
          const hasProperties = Object.keys(incoming).length > 0;
          this.currentTheme = hasProperties
            ? { ...this.currentTheme, ...incoming }
            : { ...DEFAULT_THEME };

          this.renderer.setTheme(this.currentTheme);
          this.wasmTerm.setColors(this.buildThemeColorsConfig(this.currentTheme));
        }
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
        this.resize(this.options.cols, this.options.rows);
        break;
    }
  }

  private handleFontChange(): void {
    if (!this.renderer || !this.wasmTerm || !this.canvas) return;

    if (this.selectionManager) {
      this.selectionManager.clearSelection();
    }

    this.renderer.resize(this.cols, this.rows);

    const metrics = this.renderer.getMetrics();
    this.canvas.width = metrics.width * this.cols;
    this.canvas.height = metrics.height * this.rows;
    this.canvas.style.width = `${metrics.width * this.cols}px`;
    this.canvas.style.height = `${metrics.height * this.rows}px`;

    this.updateWasmPixelSize();

    this.renderer.render(this.wasmTerm, true, this.viewportY, this);
  }

  private buildThemeColorsConfig(theme: Required<ITheme>): GhosttyTerminalConfig {
    return {
      fgColor: this.parseColorToHex(theme.foreground),
      bgColor: this.parseColorToHex(theme.background),
      cursorColor: this.parseColorToHex(theme.cursor),
      palette: [
        this.parseColorToHex(theme.black),
        this.parseColorToHex(theme.red),
        this.parseColorToHex(theme.green),
        this.parseColorToHex(theme.yellow),
        this.parseColorToHex(theme.blue),
        this.parseColorToHex(theme.magenta),
        this.parseColorToHex(theme.cyan),
        this.parseColorToHex(theme.white),
        this.parseColorToHex(theme.brightBlack),
        this.parseColorToHex(theme.brightRed),
        this.parseColorToHex(theme.brightGreen),
        this.parseColorToHex(theme.brightYellow),
        this.parseColorToHex(theme.brightBlue),
        this.parseColorToHex(theme.brightMagenta),
        this.parseColorToHex(theme.brightCyan),
        this.parseColorToHex(theme.brightWhite),
      ],
    };
  }

  // ==========================================================================
  // Lifecycle Methods
  // ==========================================================================

  open(parent: HTMLElement): void {
    if (this.isOpen) throw new Error('Terminal is already open');
    if (this.isDisposed) throw new Error('Terminal has been disposed');

    this.element = parent;
    this.isOpen = true;

    try {
      // NOTE: wasmTerm is created in constructor (headless-compatible design)

      parent.setAttribute('tabindex', '-1');
      parent.setAttribute('role', 'textbox');
      parent.setAttribute('aria-label', 'Terminal input');
      parent.setAttribute('aria-multiline', 'true');

      this.canvas = document.createElement('canvas');
      this.canvas.style.display = 'block';
      this.canvas.style.cursor = 'text';
      parent.appendChild(this.canvas);

      this.textarea = document.createElement('textarea');
      this.textarea.setAttribute('autocorrect', 'off');
      this.textarea.setAttribute('autocapitalize', 'off');
      this.textarea.setAttribute('spellcheck', 'false');
      this.textarea.setAttribute('tabindex', '0');
      this.textarea.setAttribute('aria-label', 'Terminal input');
      this.textarea.style.position = 'absolute';
      this.textarea.style.left = '0';
      this.textarea.style.top = '0';
      this.textarea.style.width = '1px';
      this.textarea.style.height = '1px';
      this.textarea.style.padding = '0';
      this.textarea.style.border = 'none';
      this.textarea.style.margin = '0';
      this.textarea.style.opacity = '0';
      this.textarea.style.clipPath = 'inset(50%)';
      this.textarea.style.overflow = 'hidden';
      this.textarea.style.whiteSpace = 'nowrap';
      this.textarea.style.resize = 'none';
      parent.appendChild(this.textarea);

      const textarea = this.textarea;
      this.canvas.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        textarea.focus();
      });
      this.canvas.addEventListener('touchend', (ev) => {
        ev.preventDefault();
        textarea.focus();
      });
      parent.addEventListener('mousedown', (ev) => {
        if (ev.target === parent) {
          ev.preventDefault();
          textarea.focus();
        }
      });
      parent.addEventListener('focus', () => {
        textarea.focus();
        if (this.wasmTerm?.hasFocusEvents()) this.dataEmitter.fire('\x1b[I');
      });

      parent.addEventListener('blur', () => {
        if (this.wasmTerm?.hasFocusEvents()) this.dataEmitter.fire('\x1b[O');
      });

      this.renderer = new CanvasRenderer(this.canvas, {
        fontSize: this.options.fontSize,
        fontFamily: this.options.fontFamily,
        cursorStyle: this.options.cursorStyle,
        cursorBlink: this.options.cursorBlink,
        theme: this.options.theme,
      });

      this.renderer.resize(this.cols, this.rows);

      this.updateWasmPixelSize();

      const canvas = this.canvas;
      const renderer = this.renderer;
      const wasmTerm = this.wasmTerm!;
      const mouseConfig: MouseTrackingConfig = {
        hasMouseTracking: () => wasmTerm?.hasMouseTracking() ?? false,
        hasSgrMouseMode: () => wasmTerm?.getMode(1006, false) ?? true,
        getCellDimensions: () => ({
          width: renderer.charWidth,
          height: renderer.charHeight,
        }),
        getCanvasOffset: () => {
          const rect = canvas.getBoundingClientRect();
          return { left: rect.left, top: rect.top };
        },
      };

      this.inputHandler = new InputHandler(
        this.ghostty,
        parent,
        (data: string) => {
          if (this.options.disableStdin) return;
          this.selectionManager?.clearSelection();
          this.awaitingEcho = true;
          this.dataEmitter.fire(data);
        },
        () => {
          this.bellEmitter.fire();
        },
        (keyEvent: IKeyEvent) => {
          this.keyEmitter.fire(keyEvent);
        },
        this.customKeyEventHandler,
        (mode: number) => {
          return this.wasmTerm?.getMode(mode, false) ?? false;
        },
        () => {
          return this.copySelection();
        },
        this.textarea,
        mouseConfig
      );

      this.selectionManager = new SelectionManager(
        this,
        this.renderer,
        this.wasmTerm!,
        this.textarea
      );

      this.renderer.setSelectionManager(this.selectionManager);

      this.selectionManager.onSelectionChange(() => {
        this.selectionChangeEmitter.fire();
        this.requestRender();
      });

      this.linkDetector = new LinkDetector(this);
      this.linkDetector.registerProvider(new OSC8LinkProvider(this));
      this.linkDetector.registerProvider(new UrlRegexProvider(this));

      parent.addEventListener('mousedown', this.handleMouseDown, { capture: true });
      parent.addEventListener('mousemove', this.handleMouseMove);
      parent.addEventListener('mouseleave', this.handleMouseLeave);
      parent.addEventListener('click', this.handleClick);

      document.addEventListener('mouseup', this.handleMouseUp);

      parent.addEventListener('wheel', this.handleWheel, { passive: false, capture: true });

      this.armBootstrapBlank();
      this.renderer.render(this.bootstrapBuffer, true, this.viewportY, this, this.scrollbarOpacity);

      this.renderer.setOnRequestRender(() => this.requestRender());

      this.renderTick();

      if (this.options.focusOnOpen !== false) {
        this.focus();
      }
    } catch (error) {
      this.isOpen = false;
      this.cleanupComponents();
      throw new Error(`Failed to open terminal: ${error}`);
    }
  }

  // ==========================================================================
  // Write Methods (browser-specific override)
  // ==========================================================================

  override write(data: string | Uint8Array, callback?: () => void): void {
    this.assertOpen();

    if (this.options.convertEol && typeof data === 'string') {
      data = data.replace(/\n/g, '\r\n');
    }

    // Intercept OSC 22 (mouse cursor shape) before handing off to WASM.
    // The WASM stores it internally but provides no C API to query it.
    if (typeof data === 'string' && data.includes('\x1b]22;')) {
      this.interceptOsc22(data);
    }

    this.writeInternal(data, callback);
  }

  private stripUnimplementedTitleSequences(data: string | Uint8Array): string | Uint8Array {
    if (typeof data === 'string') {
      return data.replace(/\x1bk[^\x1b\x07]*(?:\x1b\\|\x07)/g, '');
    }
    let i = 0;
    let writeIdx = -1;
    let out: Uint8Array | null = null;
    while (i < data.length) {
      if (data[i] === 0x1b && i + 1 < data.length && data[i + 1] === 0x6b) {
        let j = i + 2;
        while (j < data.length) {
          if (data[j] === 0x07) {
            j++;
            break;
          }
          if (data[j] === 0x1b && j + 1 < data.length && data[j + 1] === 0x5c) {
            j += 2;
            break;
          }
          j++;
        }
        if (out === null) {
          out = new Uint8Array(data.length);
          out.set(data.subarray(0, i));
          writeIdx = i;
        }
        i = j;
        continue;
      }
      if (out !== null) {
        out[writeIdx++] = data[i];
      }
      i++;
    }
    if (out === null) return data;
    return out.subarray(0, writeIdx);
  }

  private writeInternal(data: string | Uint8Array, callback?: () => void): void {
    this.disarmBootstrapBlank();

    const sanitized = this.stripUnimplementedTitleSequences(data);

    const preserveScroll = this.options.preserveScrollOnWrite === true;
    const savedViewportY = preserveScroll ? this.viewportY : 0;
    const savedScrollback =
      preserveScroll && savedViewportY > 0 ? this.wasmTerm!.getScrollbackLength() : 0;

    this.wasmTerm!.write(sanitized);

    if (this.options.emitTerminalResponses) {
      this.processTerminalResponses();
    }

    if (typeof data === 'string' && data.includes('\x07')) {
      this.bellEmitter.fire();
    } else if (data instanceof Uint8Array && data.includes(0x07)) {
      this.bellEmitter.fire();
    }

    this.linkDetector?.invalidateCache();

    if (preserveScroll) {
      if (savedViewportY > 0) {
        const newScrollback = this.wasmTerm!.getScrollbackLength();
        const delta = newScrollback - savedScrollback;
        const newViewportY = Math.max(0, Math.min(savedViewportY + delta, newScrollback));
        if (newViewportY !== savedViewportY) {
          this.viewportY = newViewportY;
          this.scrollEmitter.fire(this.viewportY);
          if (newScrollback > 0) this.showScrollbar();
        }
      }
    } else if (this.viewportY !== 0) {
      this.scrollToBottom();
    }

    if (typeof data === 'string' && data.includes('\x1b]')) {
      this.checkForTitleChange(data);
      this.checkForShellIntegration(data);
    }

    if (typeof data === 'string' && (data.includes('\n') || data.includes('\r\n'))) {
      this.lineFeedEmitter.fire();
    } else if (data instanceof Uint8Array && data.includes(0x0a)) {
      this.lineFeedEmitter.fire();
    }

    this.checkCursorMove();

    if (callback) {
      requestAnimationFrame(() => {
        callback!();
        this.writeParsedEmitter.fire();
      });
    } else {
      this.writeParsedEmitter.fire();
    }

    if (this.awaitingEcho && this.renderer && this.wasmTerm) {
      this.awaitingEcho = false;
      this.renderer.render(this.wasmTerm, false, this.viewportY, this, this.scrollbarOpacity);
    }

    this.requestRender();
  }

  override writeln(data: string | Uint8Array, callback?: () => void): void {
    if (typeof data === 'string') {
      this.write(data + '\r\n', callback);
    } else {
      const newData = new Uint8Array(data.length + 2);
      newData.set(data);
      newData[data.length] = 0x0d;
      newData[data.length + 1] = 0x0a;
      this.write(newData, callback);
    }
  }

  paste(data: string): void {
    this.assertOpen();
    if (this.options.disableStdin) return;

    this.awaitingEcho = true;
    if (this.wasmTerm!.hasBracketedPaste()) {
      this.dataEmitter.fire('\x1b[200~' + data + '\x1b[201~');
    } else {
      this.dataEmitter.fire(data);
    }
  }

  override input(data: string, wasUserInput: boolean = false): void {
    this.assertOpen();
    if (this.options.disableStdin) return;

    if (wasUserInput) {
      this.awaitingEcho = true;
      this.dataEmitter.fire(data);
    } else {
      this.write(data);
    }
  }

  // ==========================================================================
  // Resize (browser override with canvas/renderer resize)
  // ==========================================================================

  override resize(cols: number, rows: number): void {
    if (this.isDisposed) throw new Error('Terminal has been disposed');
    if (!this.wasmTerm) throw new Error('Terminal not initialized');

    if (cols === this.cols && rows === this.rows) return;

    // Only browser-specific resize when open
    if (this.isOpen) {
      this.cancelRenderLoop();
    }

    try {
      this.cols = cols;
      this.rows = rows;
      this.wasmTerm.resize(cols, rows);

      if (this.renderer && this.canvas) {
        this.renderer.resize(cols, rows);
        const metrics = this.renderer.getMetrics();
        this.canvas.width = metrics.width * cols;
        this.canvas.height = metrics.height * rows;
        this.canvas.style.width = `${metrics.width * cols}px`;
        this.canvas.style.height = `${metrics.height * rows}px`;
        this.updateWasmPixelSize();
        this.renderer.render(this.wasmTerm, true, this.viewportY, this);
      }

      this.resizeEmitter.fire({ cols, rows });
    } catch (e) {
      console.error('Terminal resize failed:', e);
    }

    if (this.isOpen) {
      this.flushWriteQueue();
      this.requestRender();
    }
  }

  // ==========================================================================
  // Reset (browser override: recreates WASM terminal)
  // ==========================================================================

  override reset(): void {
    this.assertOpen();

    if (this.wasmTerm) {
      this.wasmTerm.free();
    }
    const config = this.buildWasmConfig();
    this.wasmTerm = this.ghostty.createTerminal(this.cols, this.rows, config);

    this.updateWasmPixelSize();

    this.armBootstrapBlank();
    this.renderer!.clear();
    this.renderer!.render(this.bootstrapBuffer, true, this.viewportY, this, this.scrollbarOpacity);

    this.currentTitle = '';
  }

  // ==========================================================================
  // Clear (browser override: same as core but needs assertOpen)
  // ==========================================================================

  override clear(): void {
    this.assertOpen();
    this.wasmTerm!.write('\x1b[2J\x1b[H');
  }

  // ==========================================================================
  // Focus / Blur
  // ==========================================================================

  focus(): void {
    if (this.isOpen) {
      const target = this.textarea || this.element;
      if (target) {
        target.focus();
        setTimeout(() => target?.focus(), 0);
      }
    }
  }

  blur(): void {
    if (this.isOpen && this.element) {
      this.element.blur();
    }
  }

  // ==========================================================================
  // Addon (browser override to use `this` as Terminal)
  // ==========================================================================

  override loadAddon(addon: ITerminalAddon): void {
    addon.activate(this);
    this.addons.push(addon);
  }

  // ==========================================================================
  // Terminal Modes (browser override: no assertOpen needed after headless port)
  // ==========================================================================

  override getMode(mode: number, isAnsi: boolean = false): boolean {
    if (!this.wasmTerm) return false;
    return this.wasmTerm.getMode(mode, isAnsi);
  }

  override hasBracketedPaste(): boolean {
    if (!this.wasmTerm) return false;
    return this.wasmTerm.hasBracketedPaste();
  }

  override hasFocusEvents(): boolean {
    if (!this.wasmTerm) return false;
    return this.wasmTerm.hasFocusEvents();
  }

  override hasMouseTracking(): boolean {
    if (!this.wasmTerm) return false;
    return this.wasmTerm.hasMouseTracking();
  }

  // ==========================================================================
  // Selection API
  // ==========================================================================

  public getSelection(): string {
    return this.selectionManager?.getSelection() || '';
  }

  public hasSelection(): boolean {
    return this.selectionManager?.hasSelection() || false;
  }

  public clearSelection(): void {
    this.selectionManager?.clearSelection();
  }

  public copySelection(): boolean {
    return this.selectionManager?.copySelection() || false;
  }

  public selectAll(): void {
    this.selectionManager?.selectAll();
  }

  public select(column: number, row: number, length: number): void {
    this.selectionManager?.select(column, row, length);
  }

  public selectLines(start: number, end: number): void {
    this.selectionManager?.selectLines(start, end);
  }

  public getSelectionPosition(): IBufferRange | undefined {
    return this.selectionManager?.getSelectionPosition();
  }

  // ==========================================================================
  // Custom Event Handlers
  // ==========================================================================

  public attachCustomKeyEventHandler(
    customKeyEventHandler: (event: KeyboardEvent) => boolean
  ): void {
    this.customKeyEventHandler = customKeyEventHandler;
    if (this.inputHandler) {
      this.inputHandler.setCustomKeyEventHandler(customKeyEventHandler);
    }
  }

  public attachCustomWheelEventHandler(
    customWheelEventHandler?: (event: WheelEvent) => boolean
  ): void {
    this.customWheelEventHandler = customWheelEventHandler;
  }

  // ==========================================================================
  // Link Detection
  // ==========================================================================

  public registerLinkProvider(provider: ILinkProvider): void {
    if (!this.linkDetector) {
      throw new Error('Terminal must be opened before registering link providers');
    }
    this.linkDetector.registerProvider(provider);
  }

  // ==========================================================================
  // Scrolling (browser override: adds showScrollbar + requestRender)
  // ==========================================================================

  override scrollLines(amount: number): void {
    if (!this.wasmTerm) throw new Error('Terminal not open');

    const scrollbackLength = this.getScrollbackLength();
    const newViewportY = Math.max(0, Math.min(scrollbackLength, this.viewportY - amount));

    if (newViewportY !== this.viewportY) {
      this.viewportY = newViewportY;
      this.scrollEmitter.fire(this.viewportY);

      if (scrollbackLength > 0) this.showScrollbar();
      this.requestRender();
    }
  }

  override scrollPages(amount: number): void {
    this.scrollLines(amount * this.rows);
  }

  override scrollToTop(): void {
    const scrollbackLength = this.getScrollbackLength();
    if (scrollbackLength > 0 && this.viewportY !== scrollbackLength) {
      this.viewportY = scrollbackLength;
      this.scrollEmitter.fire(this.viewportY);
      this.showScrollbar();
      this.requestRender();
    }
  }

  override scrollToBottom(): void {
    if (this.viewportY !== 0) {
      this.viewportY = 0;
      this.scrollEmitter.fire(this.viewportY);
      if (this.getScrollbackLength() > 0) this.showScrollbar();
      this.requestRender();
    }
  }

  override scrollToLine(line: number): void {
    const scrollbackLength = this.getScrollbackLength();
    const newViewportY = Math.max(0, Math.min(scrollbackLength, line));

    if (newViewportY !== this.viewportY) {
      this.viewportY = newViewportY;
      this.scrollEmitter.fire(this.viewportY);
      if (scrollbackLength > 0) this.showScrollbar();
      this.requestRender();
    }
  }

  // ==========================================================================
  // Dispose (browser override: cleans up DOM)
  // ==========================================================================

  override dispose(): void {
    if (this.isDisposed) return;

    this.isOpen = false;
    this.cancelRenderLoop();
    this.writeQueue.length = 0;

    if (this.scrollAnimationFrame) {
      cancelAnimationFrame(this.scrollAnimationFrame);
      this.scrollAnimationFrame = undefined;
    }

    if (this.mouseMoveThrottleTimeout) {
      clearTimeout(this.mouseMoveThrottleTimeout);
      this.mouseMoveThrottleTimeout = undefined;
    }
    this.pendingMouseMove = undefined;

    this.cleanupComponents();

    // Dispose browser-specific event emitters
    this.selectionChangeEmitter.dispose();
    this.keyEmitter.dispose();
    this.renderEmitter.dispose();
    this.mouseCursorChangeEmitter.dispose();

    super.dispose();
  }

  // ==========================================================================
  // processTerminalResponses (browser override: drain all pending responses)
  // ==========================================================================

  protected override processTerminalResponses(): void {
    if (!this.wasmTerm) return;

    while (true) {
      const response = this.wasmTerm.readResponse();
      if (response === null) break;
      this.dataEmitter.fire(response);
    }
  }

  // ==========================================================================
  // Private Browser Methods
  // ==========================================================================

  private updateWasmPixelSize(): void {
    if (!this.renderer || !this.wasmTerm) return;
    const metrics = this.renderer.getMetrics();
    this.wasmTerm.setCellPixelSize(metrics.width, metrics.height);
  }

  private cancelRenderLoop(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = undefined;
    }
  }

  private flushWriteQueue(): void {
    while (this.writeQueue.length > 0) {
      const data = this.writeQueue.shift()!;
      this.wasmTerm!.write(data);
    }
  }

  private requestRender(): void {
    if (this.animationFrameId !== undefined) return;
    if (this.isDisposed || !this.isOpen) return;
    this.animationFrameId = requestAnimationFrame(this.renderTick);
  }

  private renderTick = (): void => {
    this.animationFrameId = undefined;
    if (this.isDisposed || !this.isOpen) return;

    // Defer render while synchronized output (DEC mode 2026) is active.
    // Force-flush after SYNC_OUTPUT_TIMEOUT_MS to guard against apps that
    // forget to close the sync window.
    if (this.wasmTerm!.getMode(2026, false)) {
      const now = performance.now();
      if (this.syncOutputStartTime === undefined) this.syncOutputStartTime = now;
      if (now - this.syncOutputStartTime < Terminal.SYNC_OUTPUT_TIMEOUT_MS) {
        this.requestRender();
        return;
      }
    }
    this.syncOutputStartTime = undefined;

    this.renderer!.render(this.wasmTerm!, false, this.viewportY, this, this.scrollbarOpacity);
    this.renderEmitter.fire({ start: 0, end: this.rows - 1 });

    const cursor = this.wasmTerm!.getCursor();
    if (cursor.x !== this.lastCursorX || cursor.y !== this.lastCursorY) {
      this.lastCursorX = cursor.x;
      this.lastCursorY = cursor.y;
      this.cursorMoveEmitter.fire();
    }

    this.syncTextareaToCursor(cursor.x, cursor.y);
  };

  private syncTextareaToCursor(col: number, row: number): void {
    if (!this.textarea || !this.renderer) return;
    const w = this.renderer.charWidth;
    const h = this.renderer.charHeight;
    if (!w || !h) return;
    this.textarea.style.left = `${col * w}px`;
    this.textarea.style.top = `${row * h}px`;
  }

  // Track the last cursor applied so we only update the DOM when it changes.
  private lastOsc22Cursor = '';

  /**
   * Intercept OSC 22 mouse-cursor-shape sequences emitted by the PTY.
   * Updates the canvas CSS cursor and fires onMouseCursorChange.
   *
   * Format: ESC ] 22 ; <w3c-cursor-name> BEL|ST
   *
   * Ghostty's MouseShape names map 1-to-1 to W3C CSS cursor values after
   * replacing underscores with hyphens (e.g. "context_menu" → "context-menu").
   */
  private interceptOsc22(data: string): void {
    const re = /\x1b\]22;([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
    let match: RegExpExecArray | null;
    // biome-ignore lint/suspicious/noAssignInExpressions: Standard regex pattern
    while ((match = re.exec(data)) !== null) {
      const cssCursor = match[1].replace(/_/g, '-') || 'default';
      if (cssCursor === this.lastOsc22Cursor) continue;
      this.lastOsc22Cursor = cssCursor;
      if (this.canvas) this.canvas.style.cursor = cssCursor;
      if (this.element) this.element.style.cursor = cssCursor;
      this.mouseCursorChangeEmitter.fire(cssCursor);
    }
  }

  private armBootstrapBlank(): void {
    const theme = { ...DEFAULT_THEME, ...this.options.theme };
    this.bootstrapCells = createBlankBootstrapCells(this.cols, this.rows, {
      foreground: theme.foreground,
      background: theme.background,
    });
    this.bootstrapDirty = true;
  }

  private disarmBootstrapBlank(): void {
    if (!this.bootstrapCells) return;
    this.bootstrapCells = null;
    this.bootstrapDirty = true;
  }

  private cleanupComponents(): void {
    if (this.selectionManager) {
      this.selectionManager.dispose();
      this.selectionManager = undefined;
    }

    if (this.inputHandler) {
      this.inputHandler.dispose();
      this.inputHandler = undefined;
    }

    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = undefined;
    }

    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
      this.canvas = undefined;
    }

    if (this.textarea && this.textarea.parentNode) {
      this.textarea.parentNode.removeChild(this.textarea);
      this.textarea = undefined;
    }

    if (this.element) {
      this.element.removeEventListener('wheel', this.handleWheel);
      this.element.removeEventListener('mousedown', this.handleMouseDown, { capture: true });
      this.element.removeEventListener('mousemove', this.handleMouseMove);
      this.element.removeEventListener('mouseleave', this.handleMouseLeave);
      this.element.removeEventListener('click', this.handleClick);

      this.element.removeAttribute('role');
      this.element.removeAttribute('aria-label');
      this.element.removeAttribute('aria-multiline');
    }

    if (this.isOpen && typeof document !== 'undefined') {
      document.removeEventListener('mouseup', this.handleMouseUp);
    }

    if (this.scrollbarHideTimeout) {
      window.clearTimeout(this.scrollbarHideTimeout);
      this.scrollbarHideTimeout = undefined;
    }

    if (this.linkDetector) {
      this.linkDetector.dispose();
      this.linkDetector = undefined;
    }

    // NOTE: wasmTerm is freed by super.dispose(), not here
    this.element = undefined;
    this.textarea = undefined;
  }

  private assertOpen(): void {
    if (this.isDisposed) throw new Error('Terminal has been disposed');
    if (!this.isOpen) {
      throw new Error('Terminal must be opened before use. Call terminal.open(parent) first.');
    }
  }

  // ==========================================================================
  // Smooth Scrolling
  // ==========================================================================

  private smoothScrollTo(targetY: number): void {
    if (!this.wasmTerm) return;

    const scrollbackLength = this.getScrollbackLength();
    const newTarget = Math.max(0, Math.min(scrollbackLength, targetY));

    const duration = this.options.smoothScrollDuration ?? 100;
    if (duration === 0) {
      this.viewportY = newTarget;
      this.targetViewportY = newTarget;
      this.scrollEmitter.fire(Math.floor(this.viewportY));
      if (scrollbackLength > 0) this.showScrollbar();
      this.requestRender();
      return;
    }

    this.targetViewportY = newTarget;

    if (this.scrollAnimationFrame) return;

    this.scrollAnimationStartTime = Date.now();
    this.scrollAnimationStartY = this.viewportY;
    this.animateScroll();
  }

  private animateScroll = (): void => {
    if (!this.wasmTerm || this.scrollAnimationStartTime === undefined) return;

    const duration = this.options.smoothScrollDuration ?? 100;
    const distance = this.targetViewportY - this.viewportY;
    const absDistance = Math.abs(distance);

    if (absDistance < 0.01) {
      this.viewportY = this.targetViewportY;
      this.scrollEmitter.fire(Math.floor(this.viewportY));

      const scrollbackLength = this.getScrollbackLength();
      if (scrollbackLength > 0) this.showScrollbar();

      this.scrollAnimationFrame = undefined;
      this.scrollAnimationStartTime = undefined;
      this.scrollAnimationStartY = undefined;
      this.requestRender();
      return;
    }

    const framesForDuration = (duration / 1000) * 60;
    const moveRatio = 1 - (1 / framesForDuration) ** 2;
    this.viewportY += distance * moveRatio;

    const intViewportY = Math.floor(this.viewportY);
    this.scrollEmitter.fire(intViewportY);

    const scrollbackLength = this.getScrollbackLength();
    if (scrollbackLength > 0) this.showScrollbar();

    this.requestRender();
    this.scrollAnimationFrame = requestAnimationFrame(this.animateScroll);
  };

  // ==========================================================================
  // Scrollbar Visibility
  // ==========================================================================

  private showScrollbar(): void {
    if (this.scrollbarHideTimeout) {
      window.clearTimeout(this.scrollbarHideTimeout);
      this.scrollbarHideTimeout = undefined;
    }

    if (!this.scrollbarVisible) {
      this.scrollbarVisible = true;
      this.scrollbarOpacity = 0;
      this.fadeInScrollbar();
    } else {
      this.scrollbarOpacity = 1;
    }

    if (!this.isDraggingScrollbar) {
      this.scrollbarHideTimeout = window.setTimeout(() => {
        this.hideScrollbar();
      }, this.SCROLLBAR_HIDE_DELAY_MS);
    }
  }

  private hideScrollbar(): void {
    if (this.scrollbarHideTimeout) {
      window.clearTimeout(this.scrollbarHideTimeout);
      this.scrollbarHideTimeout = undefined;
    }

    if (this.scrollbarVisible) {
      this.fadeOutScrollbar();
    }
  }

  private fadeInScrollbar(): void {
    const startTime = Date.now();
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / this.SCROLLBAR_FADE_DURATION_MS, 1);
      this.scrollbarOpacity = progress;

      if (this.renderer && this.wasmTerm) {
        this.renderer.render(this.wasmTerm, false, this.viewportY, this, this.scrollbarOpacity);
      }

      if (progress < 1) requestAnimationFrame(animate);
    };
    animate();
  }

  private fadeOutScrollbar(): void {
    const startTime = Date.now();
    const startOpacity = this.scrollbarOpacity;
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / this.SCROLLBAR_FADE_DURATION_MS, 1);
      this.scrollbarOpacity = startOpacity * (1 - progress);

      if (this.renderer && this.wasmTerm) {
        this.renderer.render(this.wasmTerm, false, this.viewportY, this, this.scrollbarOpacity);
      }

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        this.scrollbarVisible = false;
        this.scrollbarOpacity = 0;
        if (this.renderer && this.wasmTerm) {
          this.renderer.render(this.wasmTerm, false, this.viewportY, this, 0);
        }
      }
    };
    animate();
  }

  // ==========================================================================
  // Mouse Event Handlers
  // ==========================================================================

  private handleMouseMove = (e: MouseEvent): void => {
    if (!this.canvas || !this.renderer || !this.wasmTerm) return;

    if (this.isDraggingScrollbar) {
      this.processScrollbarDrag(e);
      return;
    }

    if (!this.linkDetector) return;

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

  private processMouseMove(e: MouseEvent): void {
    if (!this.canvas || !this.renderer || !this.linkDetector || !this.wasmTerm) return;

    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / this.renderer.charWidth);
    const y = Math.floor((e.clientY - rect.top) / this.renderer.charHeight);

    const viewportRow = y;
    let hyperlinkId = 0;

    let line: GhosttyCell[] | null = null;
    const rawViewportY = this.getViewportY();
    const viewportY = Math.max(0, Math.floor(rawViewportY));
    if (viewportY > 0) {
      const scrollbackLength = this.wasmTerm.getScrollbackLength();
      if (viewportRow < viewportY) {
        const scrollbackOffset = scrollbackLength - viewportY + viewportRow;
        line = this.wasmTerm.getScrollbackLine(scrollbackOffset);
      } else {
        const screenRow = viewportRow - viewportY;
        line = this.wasmTerm.getLine(screenRow);
      }
    } else {
      line = this.wasmTerm.getLine(viewportRow);
    }

    if (line && x >= 0 && x < line.length) {
      hyperlinkId = line[x].hyperlink_id;
    }

    const previousHyperlinkId = (this.renderer as any).hoveredHyperlinkId || 0;
    if (hyperlinkId !== previousHyperlinkId) {
      this.renderer.setHoveredHyperlinkId(hyperlinkId);
    }

    const scrollbackLength = this.wasmTerm.getScrollbackLength();
    let bufferRow: number;

    const rawViewportYForBuffer = this.getViewportY();
    const viewportYForBuffer = Math.max(0, Math.floor(rawViewportYForBuffer));

    if (viewportYForBuffer > 0) {
      if (viewportRow < viewportYForBuffer) {
        bufferRow = scrollbackLength - viewportYForBuffer + viewportRow;
      } else {
        const screenRow = viewportRow - viewportYForBuffer;
        bufferRow = scrollbackLength + screenRow;
      }
    } else {
      bufferRow = scrollbackLength + viewportRow;
    }

    this.linkDetector
      .getLinkAt(x, bufferRow)
      .then((link) => {
        if (link !== this.currentHoveredLink) {
          this.currentHoveredLink?.hover?.(false);
          this.currentHoveredLink = link;
          link?.hover?.(true);

          const cursorStyle = link ? 'pointer' : 'text';
          if (this.element) this.element.style.cursor = cursorStyle;
          if (this.canvas) this.canvas.style.cursor = cursorStyle;

          if (this.renderer) {
            if (link) {
              const scrollbackLength = this.wasmTerm?.getScrollbackLength() || 0;
              const rawViewportYForLinks = this.getViewportY();
              const viewportYForLinks = Math.max(0, Math.floor(rawViewportYForLinks));
              const startViewportY = link.range.start.y - scrollbackLength + viewportYForLinks;
              const endViewportY = link.range.end.y - scrollbackLength + viewportYForLinks;

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

  private handleMouseLeave = (): void => {
    if (this.renderer && this.wasmTerm) {
      const previousHyperlinkId = (this.renderer as any).hoveredHyperlinkId || 0;
      if (previousHyperlinkId > 0) {
        this.renderer.setHoveredHyperlinkId(0);
      }
      this.renderer.setHoveredLinkRange(null);
    }

    if (this.currentHoveredLink) {
      this.currentHoveredLink.hover?.(false);
      this.currentHoveredLink = undefined;

      if (this.element) {
        this.element.style.cursor = 'text';
        if (this.canvas) this.canvas.style.cursor = 'text';
      }
    }
  };

  private handleClick = async (e: MouseEvent): Promise<void> => {
    if (!this.canvas || !this.renderer || !this.linkDetector || !this.wasmTerm) return;

    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / this.renderer.charWidth);
    const y = Math.floor((e.clientY - rect.top) / this.renderer.charHeight);

    const viewportRow = y;
    const scrollbackLength = this.wasmTerm.getScrollbackLength();
    let bufferRow: number;

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

    const link = await this.linkDetector.getLinkAt(x, bufferRow);

    if (link) {
      link.activate(e);
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    }
  };

  private handleWheel = (e: WheelEvent): void => {
    e.preventDefault();
    e.stopPropagation();

    if (this.customWheelEventHandler && this.customWheelEventHandler(e)) return;

    if (this.wasmTerm?.hasMouseTracking()) {
      this.inputHandler?.handleWheelEvent(e);
      return;
    }

    const isAltScreen = this.wasmTerm?.isAlternateScreen() ?? false;

    if (isAltScreen) {
      if (this.wasmTerm?.hasMouseTracking()) {
        const metrics = this.renderer?.getMetrics();
        const canvas = this.canvas;
        if (metrics && canvas) {
          const rect = canvas.getBoundingClientRect();
          const col = Math.max(1, Math.floor((e.clientX - rect.left) / metrics.width) + 1);
          const row = Math.max(1, Math.floor((e.clientY - rect.top) / metrics.height) + 1);
          const btn = e.deltaY < 0 ? 64 : 65;
          this.dataEmitter.fire(`\x1b[<${btn};${col};${row}M`);
        }
        return;
      }
      const direction = e.deltaY > 0 ? 'down' : 'up';
      const count = Math.min(Math.abs(Math.round(e.deltaY / 33)), 5);
      for (let i = 0; i < count; i++) {
        this.dataEmitter.fire(direction === 'up' ? '\x1B[A' : '\x1B[B');
      }
    } else {
      let deltaLines: number;
      if (e.deltaMode === WheelEvent.DOM_DELTA_PIXEL) {
        const lineHeight = this.renderer?.getMetrics()?.height ?? 20;
        deltaLines = e.deltaY / lineHeight;
      } else if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) {
        deltaLines = e.deltaY;
      } else if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
        deltaLines = e.deltaY * this.rows;
      } else {
        deltaLines = e.deltaY / 33;
      }

      if (deltaLines !== 0) {
        const targetY = this.viewportY - deltaLines;
        this.smoothScrollTo(targetY);
      }
    }
  };

  private handleMouseDown = (e: MouseEvent): void => {
    if (!this.canvas || !this.renderer || !this.wasmTerm) return;

    const scrollbackLength = this.wasmTerm.getScrollbackLength();
    if (scrollbackLength === 0) return;

    const rect = this.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const canvasWidth = rect.width;
    const canvasHeight = rect.height;
    const scrollbarWidth = 8;
    const scrollbarX = canvasWidth - scrollbarWidth - 4;
    const scrollbarPadding = 4;

    if (mouseX >= scrollbarX && mouseX <= scrollbarX + scrollbarWidth) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const scrollbarTrackHeight = canvasHeight - scrollbarPadding * 2;
      const visibleRows = this.rows;
      const totalLines = scrollbackLength + visibleRows;
      const thumbHeight = Math.max(20, (visibleRows / totalLines) * scrollbarTrackHeight);
      const scrollPosition = this.viewportY / scrollbackLength;
      const thumbY = scrollbarPadding + (scrollbarTrackHeight - thumbHeight) * (1 - scrollPosition);

      if (mouseY >= thumbY && mouseY <= thumbY + thumbHeight) {
        this.isDraggingScrollbar = true;
        this.scrollbarDragStart = mouseY;
        this.scrollbarDragStartViewportY = this.viewportY;

        if (this.canvas) {
          this.canvas.style.userSelect = 'none';
          this.canvas.style.webkitUserSelect = 'none';
        }
      } else {
        const relativeY = mouseY - scrollbarPadding;
        const scrollFraction = 1 - relativeY / scrollbarTrackHeight;
        const targetViewportY = Math.round(scrollFraction * scrollbackLength);
        this.scrollToLine(Math.max(0, Math.min(scrollbackLength, targetViewportY)));
      }
    }
  };

  private handleMouseUp = (): void => {
    if (this.isDraggingScrollbar) {
      this.isDraggingScrollbar = false;
      this.scrollbarDragStart = null;

      if (this.canvas) {
        this.canvas.style.userSelect = '';
        this.canvas.style.webkitUserSelect = '';
      }

      if (this.scrollbarVisible && this.getScrollbackLength() > 0) {
        this.showScrollbar();
      }
    }
  };

  private processScrollbarDrag(e: MouseEvent): void {
    if (!this.canvas || !this.renderer || !this.wasmTerm || this.scrollbarDragStart === null)
      return;

    const scrollbackLength = this.wasmTerm.getScrollbackLength();
    if (scrollbackLength === 0) return;

    const rect = this.canvas.getBoundingClientRect();
    const mouseY = e.clientY - rect.top;
    const deltaY = mouseY - this.scrollbarDragStart;

    const canvasHeight = rect.height;
    const scrollbarPadding = 4;
    const scrollbarTrackHeight = canvasHeight - scrollbarPadding * 2;
    const visibleRows = this.rows;
    const totalLines = scrollbackLength + visibleRows;
    const thumbHeight = Math.max(20, (visibleRows / totalLines) * scrollbarTrackHeight);

    const scrollFraction = -deltaY / (scrollbarTrackHeight - thumbHeight);
    const viewportDelta = Math.round(scrollFraction * scrollbackLength);

    const newViewportY = this.scrollbarDragStartViewportY + viewportDelta;
    this.scrollToLine(Math.max(0, Math.min(scrollbackLength, newViewportY)));
  }
}
