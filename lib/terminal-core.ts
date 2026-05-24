/**
 * TerminalCore - Shared terminal logic between browser and headless modes
 *
 * Works without a DOM. Mirrors the @xterm/headless API.
 * Browser-specific functionality (open, rendering, input) is in Terminal.
 */

import { BufferNamespace } from './buffer';
import { EventEmitter } from './event-emitter';
import type { Ghostty, GhosttyCell, GhosttyTerminalConfig } from './ghostty';
import type { GhosttyTerminal } from './ghostty';
import type {
  IBufferNamespace,
  IDisposable,
  IEvent,
  ITerminalAddon,
  ITerminalOptions,
} from './interfaces';

export class TerminalCore implements IDisposable {
  public cols: number;
  public rows: number;
  public readonly buffer: IBufferNamespace;
  public readonly options!: Required<ITerminalOptions>;

  protected ghostty: Ghostty;
  public wasmTerm?: GhosttyTerminal;

  protected dataEmitter = new EventEmitter<string>();
  protected resizeEmitter = new EventEmitter<{ cols: number; rows: number }>();
  protected bellEmitter = new EventEmitter<void>();
  protected titleChangeEmitter = new EventEmitter<string>();
  protected scrollEmitter = new EventEmitter<number>();
  protected cursorMoveEmitter = new EventEmitter<void>();
  protected lineFeedEmitter = new EventEmitter<void>();
  protected writeParsedEmitter = new EventEmitter<void>();
  protected binaryEmitter = new EventEmitter<string>();

  public readonly onData: IEvent<string> = this.dataEmitter.event;
  public readonly onResize: IEvent<{ cols: number; rows: number }> = this.resizeEmitter.event;
  public readonly onBell: IEvent<void> = this.bellEmitter.event;
  public readonly onTitleChange: IEvent<string> = this.titleChangeEmitter.event;
  public readonly onScroll: IEvent<number> = this.scrollEmitter.event;
  public readonly onCursorMove: IEvent<void> = this.cursorMoveEmitter.event;
  public readonly onLineFeed: IEvent<void> = this.lineFeedEmitter.event;
  public readonly onWriteParsed: IEvent<void> = this.writeParsedEmitter.event;
  public readonly onBinary: IEvent<string> = this.binaryEmitter.event;

  protected isDisposed = false;
  protected addons: ITerminalAddon[] = [];
  protected currentTitle: string = '';
  protected lastCursorY: number = 0;
  protected lastCursorX: number = 0;
  protected _viewportY: number = 0;
  protected _markers: any[] = [];

  constructor(ghostty: Ghostty, options: ITerminalOptions = {}) {
    this.ghostty = ghostty;

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
      smoothScrollDuration: options.smoothScrollDuration ?? 100,
      focusOnOpen: options.focusOnOpen ?? true,
      preserveScrollOnWrite: options.preserveScrollOnWrite ?? false,
      emitTerminalResponses: options.emitTerminalResponses ?? true,
    };

    (this.options as any) = new Proxy(baseOptions, {
      set: (target: any, prop: string, value: any) => {
        const oldValue = target[prop];
        target[prop] = value;
        this.handleOptionChange(prop, value, oldValue);
        return true;
      },
    });

    this.cols = this.options.cols;
    this.rows = this.options.rows;

    const config = this.buildWasmConfig();
    this.wasmTerm = ghostty.createTerminal(this.cols, this.rows, config);

    this.buffer = new BufferNamespace(this as any);
  }

  get markers(): ReadonlyArray<any> {
    return this._markers;
  }

  protected handleOptionChange(key: string, _newValue: any, _oldValue: any): void {
    switch (key) {
      case 'cols':
      case 'rows':
        this.resize(this.options.cols, this.options.rows);
        break;
    }
  }

  write(data: string | Uint8Array, callback?: () => void): void {
    if (this.isDisposed) throw new Error('Terminal has been disposed');
    if (!this.wasmTerm) throw new Error('Terminal not initialized');

    if (this.options.convertEol && typeof data === 'string') {
      data = data.replace(/\n/g, '\r\n');
    }

    this.wasmTerm.write(data);

    this.processTerminalResponses();

    if (typeof data === 'string' && data.includes('\x07')) {
      this.bellEmitter.fire();
    } else if (data instanceof Uint8Array && data.includes(0x07)) {
      this.bellEmitter.fire();
    }

    if (typeof data === 'string' && (data.includes('\n') || data.includes('\r\n'))) {
      this.lineFeedEmitter.fire();
    } else if (data instanceof Uint8Array && data.includes(0x0a)) {
      this.lineFeedEmitter.fire();
    }

    if (typeof data === 'string' && data.includes('\x1b]')) {
      this.checkForTitleChange(data);
    }

    this.checkCursorMove();

    if (callback) {
      queueMicrotask(() => {
        callback();
        this.writeParsedEmitter.fire();
      });
    } else {
      this.writeParsedEmitter.fire();
    }
  }

  writeln(data: string | Uint8Array, callback?: () => void): void {
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

  input(data: string, wasUserInput: boolean = true): void {
    if (this.isDisposed) throw new Error('Terminal has been disposed');
    if (this.options.disableStdin) return;
    if (wasUserInput) this.dataEmitter.fire(data);
  }

  resize(cols: number, rows: number): void {
    if (this.isDisposed) throw new Error('Terminal has been disposed');
    if (!this.wasmTerm) throw new Error('Terminal not initialized');
    if (cols === this.cols && rows === this.rows) return;

    this.cols = cols;
    this.rows = rows;
    this.wasmTerm.resize(cols, rows);
    this.resizeEmitter.fire({ cols, rows });
  }

  reset(): void {
    if (this.isDisposed) throw new Error('Terminal has been disposed');
    if (!this.wasmTerm) throw new Error('Terminal not initialized');

    this.wasmTerm.write('\x1bc');
    this.currentTitle = '';
    this._viewportY = 0;
  }

  clear(): void {
    if (this.isDisposed) throw new Error('Terminal has been disposed');
    if (!this.wasmTerm) throw new Error('Terminal not initialized');
    this.wasmTerm.write('\x1b[2J\x1b[H');
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;

    for (const addon of this.addons) {
      addon.dispose();
    }
    this.addons = [];

    if (this.wasmTerm) {
      this.wasmTerm.free();
      this.wasmTerm = undefined;
    }

    this.dataEmitter.dispose();
    this.resizeEmitter.dispose();
    this.bellEmitter.dispose();
    this.titleChangeEmitter.dispose();
    this.scrollEmitter.dispose();
    this.cursorMoveEmitter.dispose();
    this.lineFeedEmitter.dispose();
    this.writeParsedEmitter.dispose();
    this.binaryEmitter.dispose();
  }

  scrollLines(amount: number): void {
    if (!this.wasmTerm) return;
    const maxScroll = this.wasmTerm.getScrollbackLength();
    const newViewportY = Math.max(0, Math.min(maxScroll, this._viewportY - amount));
    if (newViewportY !== this._viewportY) {
      this._viewportY = newViewportY;
      this.scrollEmitter.fire(this._viewportY);
    }
  }

  scrollPages(pageCount: number): void {
    this.scrollLines(pageCount * this.rows);
  }

  scrollToTop(): void {
    if (!this.wasmTerm) return;
    const scrollbackLength = this.wasmTerm.getScrollbackLength();
    if (scrollbackLength > 0 && this._viewportY !== scrollbackLength) {
      this._viewportY = scrollbackLength;
      this.scrollEmitter.fire(this._viewportY);
    }
  }

  scrollToBottom(): void {
    if (this._viewportY !== 0) {
      this._viewportY = 0;
      this.scrollEmitter.fire(this._viewportY);
    }
  }

  scrollToLine(line: number): void {
    if (!this.wasmTerm) return;
    const scrollbackLength = this.wasmTerm.getScrollbackLength();
    const newViewportY = Math.max(0, Math.min(scrollbackLength, line));
    if (newViewportY !== this._viewportY) {
      this._viewportY = newViewportY;
      this.scrollEmitter.fire(this._viewportY);
    }
  }

  registerMarker(_cursorYOffset: number = 0): any | undefined {
    return undefined;
  }

  loadAddon(addon: ITerminalAddon): void {
    addon.activate(this as any);
    this.addons.push(addon);
  }

  public getViewportY(): number {
    return this._viewportY;
  }

  public getScrollbackLength(): number {
    if (!this.wasmTerm) return 0;
    return this.wasmTerm.getScrollbackLength();
  }

  public getScrollbackLine(offset: number): GhosttyCell[] | null {
    if (!this.wasmTerm) return null;
    return this.wasmTerm.getScrollbackLine(offset);
  }

  getMode(mode: number, isAnsi: boolean = false): boolean {
    if (!this.wasmTerm) return false;
    return this.wasmTerm.getMode(mode, isAnsi);
  }

  hasBracketedPaste(): boolean {
    if (!this.wasmTerm) return false;
    return this.wasmTerm.hasBracketedPaste();
  }

  hasFocusEvents(): boolean {
    if (!this.wasmTerm) return false;
    return this.wasmTerm.hasFocusEvents();
  }

  hasMouseTracking(): boolean {
    if (!this.wasmTerm) return false;
    return this.wasmTerm.hasMouseTracking();
  }

  protected parseColorToHex(color?: string): number {
    if (!color) return 0;

    if (color.startsWith('#')) {
      let hex = color.slice(1);
      if (hex.length === 3) {
        hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
      }
      const value = Number.parseInt(hex, 16);
      return Number.isNaN(value) ? 0 : value;
    }

    const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (match) {
      const r = Number.parseInt(match[1], 10);
      const g = Number.parseInt(match[2], 10);
      const b = Number.parseInt(match[3], 10);
      return (r << 16) | (g << 8) | b;
    }

    return 0;
  }

  protected buildWasmConfig(): GhosttyTerminalConfig | undefined {
    const theme = this.options.theme;
    const scrollback = this.options.scrollback;

    if (!theme && scrollback === 10000) {
      return undefined;
    }

    const palette: number[] = [
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

    return {
      // scrollback is a line count (xterm.js API); the WASM C API expects bytes.
      // 1000 bytes/line matches native Ghostty's 10 000-line = 10 MB default.
      scrollbackLimit: Math.min(scrollback * 1000, 0xffff_ffff),
      fgColor: this.parseColorToHex(theme?.foreground),
      bgColor: this.parseColorToHex(theme?.background),
      cursorColor: this.parseColorToHex(theme?.cursor),
      palette,
    };
  }

  protected processTerminalResponses(): void {
    if (!this.wasmTerm) return;
    const response = this.wasmTerm.readResponse();
    if (response) {
      this.dataEmitter.fire(response);
    }
  }

  protected checkForTitleChange(data: string): void {
    const oscRegex = /\x1b\]([012]);([^\x07\x1b]*?)(?:\x07|\x1b\\)/g;
    let match: RegExpExecArray | null = null;

    // biome-ignore lint/suspicious/noAssignInExpressions: Standard regex pattern
    while ((match = oscRegex.exec(data)) !== null) {
      const ps = match[1];
      const pt = match[2];

      if (ps === '0' || ps === '2') {
        if (pt !== this.currentTitle) {
          this.currentTitle = pt;
          this.titleChangeEmitter.fire(pt);
        }
      }
    }
  }

  protected checkCursorMove(): void {
    if (!this.wasmTerm) return;
    const cursor = this.wasmTerm.getCursor();
    if (cursor.x !== this.lastCursorX || cursor.y !== this.lastCursorY) {
      this.lastCursorX = cursor.x;
      this.lastCursorY = cursor.y;
      this.cursorMoveEmitter.fire();
    }
  }
}
