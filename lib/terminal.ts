/**
 * Terminal - Full browser terminal emulator
 *
 * Extends TerminalCore with DOM/browser-specific functionality:
 * - Canvas rendering
 * - Keyboard input handling
 * - Selection and clipboard
 * - Link detection
 * - Scrollbar UI
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

import { EventEmitter } from './event-emitter';
import type { Ghostty, GhosttyCell, GhosttyTerminal } from './ghostty';
import { getGhostty } from './index';
import { InputHandler } from './input-handler';
import type {
  IBufferRange,
  IDisposable,
  IEvent,
  IKeyEvent,
  ITerminalAddon,
  ITerminalOptions,
} from './interfaces';
import { LinkDetector } from './link-detector';
import { OSC8LinkProvider } from './providers/osc8-link-provider';
import { UrlRegexProvider } from './providers/url-regex-provider';
import { CanvasRenderer } from './renderer';
import { SelectionManager } from './selection-manager';
import { TerminalCore } from './terminal-core';
import type { ILink, ILinkProvider } from './types';

// ============================================================================
// Terminal Class - Full Browser Terminal
// ============================================================================

export class Terminal extends TerminalCore {
  // Browser-specific properties
  public element?: HTMLElement;
  public textarea?: HTMLTextAreaElement;

  // Browser-specific components
  public renderer?: CanvasRenderer; // Public for FitAddon
  private inputHandler?: InputHandler;
  private selectionManager?: SelectionManager;
  private canvas?: HTMLCanvasElement;

  // Link detection system
  private linkDetector?: LinkDetector;
  private currentHoveredLink?: ILink;
  private mouseMoveThrottleTimeout?: number;
  private pendingMouseMove?: MouseEvent;

  // Browser-specific event emitters
  private selectionChangeEmitter = new EventEmitter<void>();
  private keyEmitter = new EventEmitter<IKeyEvent>();
  private renderEmitter = new EventEmitter<{ start: number; end: number }>();

  // Browser-specific events
  public readonly onSelectionChange: IEvent<void> = this.selectionChangeEmitter.event;
  public readonly onKey: IEvent<IKeyEvent> = this.keyEmitter.event;
  public readonly onRender: IEvent<{ start: number; end: number }> = this.renderEmitter.event;

  // Lifecycle state
  private isOpen = false;
  private animationFrameId?: number;

  // Custom event handlers
  private customKeyEventHandler?: (event: KeyboardEvent) => boolean;

  // Scrolling state
  public viewportY: number = 0;
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

  constructor(options: ITerminalOptions = {}) {
    // Use provided Ghostty instance or get module-level instance
    const ghostty = options.ghostty ?? getGhostty();
    super(ghostty, options);
  }

  // ==========================================================================
  // Option Change Handling (override for browser-specific options)
  // ==========================================================================

  protected override handleOptionChange(key: string, newValue: any, oldValue: any): void {
    if (newValue === oldValue) return;

    switch (key) {
      case 'disableStdin':
        // Input handler already checks this.options.disableStdin dynamically
        break;

      case 'cursorBlink':
      case 'cursorStyle':
        if (this.renderer) {
          this.renderer.setCursorStyle(this.options.cursorStyle);
          this.renderer.setCursorBlink(this.options.cursorBlink);
        }
        break;

      case 'theme':
        if (this.renderer) {
          console.warn('ghostty-web: theme changes after open() are not yet fully supported');
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

    this.renderer.render(this.wasmTerm, true, this.viewportY, this);
  }

  // ==========================================================================
  // Lifecycle Methods
  // ==========================================================================

  /**
   * Open terminal in a parent element
   */
  open(parent: HTMLElement): void {
    if (this.isOpen) {
      throw new Error('Terminal is already open');
    }
    if (this.isDisposed) {
      throw new Error('Terminal has been disposed');
    }

    this.element = parent;
    this.isOpen = true;

    try {
      // Make parent focusable
      if (!parent.hasAttribute('tabindex')) {
        parent.setAttribute('tabindex', '0');
      }

      parent.setAttribute('contenteditable', 'true');
      parent.addEventListener('beforeinput', (e) => e.preventDefault());
      parent.setAttribute('role', 'textbox');
      parent.setAttribute('aria-label', 'Terminal input');
      parent.setAttribute('aria-multiline', 'true');

      // Create canvas element
      this.canvas = document.createElement('canvas');
      this.canvas.style.display = 'block';
      parent.appendChild(this.canvas);

      // Create hidden textarea for keyboard input
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

      // Focus textarea on interaction
      const textarea = this.textarea;
      this.canvas.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        textarea.focus();
      });
      this.canvas.addEventListener('touchend', (ev) => {
        ev.preventDefault();
        textarea.focus();
      });

      // Create renderer
      this.renderer = new CanvasRenderer(this.canvas, {
        fontSize: this.options.fontSize,
        fontFamily: this.options.fontFamily,
        cursorStyle: this.options.cursorStyle,
        cursorBlink: this.options.cursorBlink,
        theme: this.options.theme,
      });

      this.renderer.resize(this.cols, this.rows);

      // Create input handler
      this.inputHandler = new InputHandler(
        this.ghostty,
        parent,
        (data: string) => {
          if (this.options.disableStdin) {
            return;
          }
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
        }
      );

      // Create selection manager
      this.selectionManager = new SelectionManager(
        this,
        this.renderer,
        this.wasmTerm!,
        this.textarea
      );

      this.renderer.setSelectionManager(this.selectionManager);

      this.selectionManager.onSelectionChange(() => {
        this.selectionChangeEmitter.fire();
      });

      // Setup paste event handler
      this.textarea.addEventListener('paste', (e: ClipboardEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const text = e.clipboardData?.getData('text');
        if (text) {
          this.paste(text);
        }
      });

      // Initialize link detection system
      this.linkDetector = new LinkDetector(this);
      this.linkDetector.registerProvider(new OSC8LinkProvider(this));
      this.linkDetector.registerProvider(new UrlRegexProvider(this));

      // Setup mouse event handling
      parent.addEventListener('mousedown', this.handleMouseDown, { capture: true });
      parent.addEventListener('mousemove', this.handleMouseMove);
      parent.addEventListener('mouseleave', this.handleMouseLeave);
      parent.addEventListener('click', this.handleClick);
      document.addEventListener('mouseup', this.handleMouseUp);

      // Setup wheel event handling
      parent.addEventListener('wheel', this.handleWheel, { passive: false, capture: true });

      // Render initial screen
      this.renderer.render(this.wasmTerm!, true, this.viewportY, this, this.scrollbarOpacity);

      // Start render loop
      this.startRenderLoop();

      // Focus input
      this.focus();
    } catch (error) {
      this.isOpen = false;
      this.cleanupComponents();
      throw new Error(`Failed to open terminal: ${error}`);
    }
  }

  // ==========================================================================
  // Write Methods (override for browser-specific behavior)
  // ==========================================================================

  override write(data: string | Uint8Array, callback?: () => void): void {
    this.assertOpen();

    // Handle convertEol option
    if (this.options.convertEol && typeof data === 'string') {
      data = data.replace(/\n/g, '\r\n');
    }

    this.writeInternal(data, callback);
  }

  private writeInternal(data: string | Uint8Array, callback?: () => void): void {
    this.wasmTerm!.write(data);

    // Process terminal responses
    this.processTerminalResponses();

    // Check for bell
    if (typeof data === 'string' && data.includes('\x07')) {
      this.bellEmitter.fire();
    } else if (data instanceof Uint8Array && data.includes(0x07)) {
      this.bellEmitter.fire();
    }

    // Invalidate link cache
    this.linkDetector?.invalidateCache();

    // Auto-scroll to bottom on new output
    if (this.viewportY !== 0) {
      this.scrollToBottom();
    }

    // Check for title changes
    if (typeof data === 'string' && data.includes('\x1b]')) {
      this.checkForTitleChange(data);
    }

    // Call callback
    if (callback) {
      requestAnimationFrame(callback);
    }
  }

  /**
   * Paste text into terminal
   */
  paste(data: string): void {
    this.assertOpen();

    if (this.options.disableStdin) {
      return;
    }

    if (this.wasmTerm!.hasBracketedPaste()) {
      this.dataEmitter.fire('\x1b[200~' + data + '\x1b[201~');
    } else {
      this.dataEmitter.fire(data);
    }
  }

  /**
   * Input data into terminal
   */
  override input(data: string, wasUserInput: boolean = false): void {
    this.assertOpen();

    if (this.options.disableStdin) {
      return;
    }

    if (wasUserInput) {
      this.dataEmitter.fire(data);
    } else {
      this.write(data);
    }
  }

  // ==========================================================================
  // Resize (override for browser-specific behavior)
  // ==========================================================================

  override resize(cols: number, rows: number): void {
    if (!this.isOpen) {
      // Just update dimensions if not open
      if (cols !== this.cols || rows !== this.rows) {
        this.cols = cols;
        this.rows = rows;
        this.wasmTerm?.resize(cols, rows);
        this.resizeEmitter.fire({ cols, rows });
      }
      return;
    }

    this.assertOpen();

    if (cols === this.cols && rows === this.rows) {
      return;
    }

    this.cols = cols;
    this.rows = rows;

    this.wasmTerm!.resize(cols, rows);
    this.renderer!.resize(cols, rows);

    const metrics = this.renderer!.getMetrics();
    this.canvas!.width = metrics.width * cols;
    this.canvas!.height = metrics.height * rows;
    this.canvas!.style.width = `${metrics.width * cols}px`;
    this.canvas!.style.height = `${metrics.height * rows}px`;

    this.resizeEmitter.fire({ cols, rows });
    this.renderer!.render(this.wasmTerm!, true, this.viewportY, this);
  }

  // ==========================================================================
  // Focus Methods
  // ==========================================================================

  /**
   * Focus terminal input
   */
  focus(): void {
    if (this.isOpen && this.element) {
      this.element.focus();
      setTimeout(() => {
        this.element?.focus();
      }, 0);
    }
  }

  /**
   * Blur terminal
   */
  blur(): void {
    if (this.isOpen && this.element) {
      this.element.blur();
    }
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
  // Scrolling Methods (override for browser-specific behavior)
  // ==========================================================================

  override scrollLines(amount: number): void {
    if (!this.wasmTerm) {
      throw new Error('Terminal not open');
    }

    const scrollbackLength = this.getScrollbackLength();
    const maxScroll = scrollbackLength;
    const newViewportY = Math.max(0, Math.min(maxScroll, this.viewportY - amount));

    if (newViewportY !== this.viewportY) {
      this.viewportY = newViewportY;
      this._viewportY = newViewportY;
      this.scrollEmitter.fire(this.viewportY);

      if (scrollbackLength > 0) {
        this.showScrollbar();
      }
    }
  }

  override scrollToTop(): void {
    const scrollbackLength = this.getScrollbackLength();
    if (scrollbackLength > 0 && this.viewportY !== scrollbackLength) {
      this.viewportY = scrollbackLength;
      this._viewportY = scrollbackLength;
      this.scrollEmitter.fire(this.viewportY);
      this.showScrollbar();
    }
  }

  override scrollToBottom(): void {
    if (this.viewportY !== 0) {
      this.viewportY = 0;
      this._viewportY = 0;
      this.scrollEmitter.fire(this.viewportY);
      if (this.getScrollbackLength() > 0) {
        this.showScrollbar();
      }
    }
  }

  override scrollToLine(line: number): void {
    const scrollbackLength = this.getScrollbackLength();
    const newViewportY = Math.max(0, Math.min(scrollbackLength, line));

    if (newViewportY !== this.viewportY) {
      this.viewportY = newViewportY;
      this._viewportY = newViewportY;
      this.scrollEmitter.fire(this.viewportY);

      if (scrollbackLength > 0) {
        this.showScrollbar();
      }
    }
  }

  /**
   * Get current viewport Y position (override for browser Terminal)
   */
  public override getViewportY(): number {
    return this.viewportY;
  }

  /**
   * Smoothly scroll to a target position
   */
  private smoothScrollTo(targetY: number): void {
    if (!this.wasmTerm) return;

    const scrollbackLength = this.getScrollbackLength();
    const maxScroll = scrollbackLength;
    const newTarget = Math.max(0, Math.min(maxScroll, targetY));

    const duration = this.options.smoothScrollDuration ?? 100;
    if (duration === 0) {
      this.viewportY = newTarget;
      this._viewportY = newTarget;
      this.targetViewportY = newTarget;
      this.scrollEmitter.fire(Math.floor(this.viewportY));

      if (scrollbackLength > 0) {
        this.showScrollbar();
      }
      return;
    }

    this.targetViewportY = newTarget;

    if (this.scrollAnimationFrame) {
      return;
    }

    this.scrollAnimationStartTime = Date.now();
    this.scrollAnimationStartY = this.viewportY;
    this.animateScroll();
  }

  private animateScroll = (): void => {
    if (!this.wasmTerm || this.scrollAnimationStartTime === undefined) {
      return;
    }

    const duration = this.options.smoothScrollDuration ?? 100;
    const distance = this.targetViewportY - this.viewportY;
    const absDistance = Math.abs(distance);

    if (absDistance < 0.01) {
      this.viewportY = this.targetViewportY;
      this._viewportY = this.targetViewportY;
      this.scrollEmitter.fire(Math.floor(this.viewportY));

      const scrollbackLength = this.getScrollbackLength();
      if (scrollbackLength > 0) {
        this.showScrollbar();
      }

      this.scrollAnimationFrame = undefined;
      this.scrollAnimationStartTime = undefined;
      this.scrollAnimationStartY = undefined;
      return;
    }

    const framesForDuration = (duration / 1000) * 60;
    const moveRatio = 1 - (1 / framesForDuration) ** 2;
    this.viewportY += distance * moveRatio;
    this._viewportY = this.viewportY;

    const intViewportY = Math.floor(this.viewportY);
    this.scrollEmitter.fire(intViewportY);

    const scrollbackLength = this.getScrollbackLength();
    if (scrollbackLength > 0) {
      this.showScrollbar();
    }

    this.scrollAnimationFrame = requestAnimationFrame(this.animateScroll);
  };

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  override dispose(): void {
    if (this.isDisposed) {
      return;
    }

    this.isOpen = false;

    // Stop render loop
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = undefined;
    }

    // Stop smooth scroll animation
    if (this.scrollAnimationFrame) {
      cancelAnimationFrame(this.scrollAnimationFrame);
      this.scrollAnimationFrame = undefined;
    }

    // Clear mouse move throttle
    if (this.mouseMoveThrottleTimeout) {
      clearTimeout(this.mouseMoveThrottleTimeout);
      this.mouseMoveThrottleTimeout = undefined;
    }
    this.pendingMouseMove = undefined;

    // Clean up browser components
    this.cleanupComponents();

    // Dispose browser-specific emitters
    this.selectionChangeEmitter.dispose();
    this.keyEmitter.dispose();
    this.renderEmitter.dispose();

    // Call parent dispose
    super.dispose();
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private startRenderLoop(): void {
    const loop = () => {
      if (!this.isDisposed && this.isOpen) {
        this.renderer!.render(this.wasmTerm!, false, this.viewportY, this, this.scrollbarOpacity);

        const cursor = this.wasmTerm!.getCursor();
        if (cursor.y !== this.lastCursorY) {
          this.lastCursorY = cursor.y;
          this.cursorMoveEmitter.fire();
        }

        this.animationFrameId = requestAnimationFrame(loop);
      }
    };
    loop();
  }

  /**
   * Get a line from native WASM scrollback buffer
   */
  public override getScrollbackLine(offset: number): GhosttyCell[] | null {
    if (!this.wasmTerm) return null;
    return this.wasmTerm.getScrollbackLine(offset);
  }

  /**
   * Get scrollback length from native WASM
   */
  public override getScrollbackLength(): number {
    if (!this.wasmTerm) return 0;
    return this.wasmTerm.getScrollbackLength();
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

      this.element.removeAttribute('contenteditable');
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

    this.element = undefined;
    this.textarea = undefined;
  }

  private assertOpen(): void {
    if (this.isDisposed) {
      throw new Error('Terminal has been disposed');
    }
    if (!this.isOpen) {
      throw new Error('Terminal must be opened before use. Call terminal.open(parent) first.');
    }
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

          if (this.element) {
            this.element.style.cursor = link ? 'pointer' : 'text';
          }

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
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
      }
    }
  };

  // ==========================================================================
  // Wheel Event Handler
  // ==========================================================================

  private handleWheel = (e: WheelEvent): void => {
    e.preventDefault();
    e.stopPropagation();

    if (this.customWheelEventHandler && this.customWheelEventHandler(e)) {
      return;
    }

    const isAltScreen = this.wasmTerm?.isAlternateScreen() ?? false;

    if (isAltScreen) {
      const direction = e.deltaY > 0 ? 'down' : 'up';
      const count = Math.min(Math.abs(Math.round(e.deltaY / 33)), 5);

      for (let i = 0; i < count; i++) {
        if (direction === 'up') {
          this.dataEmitter.fire('\x1B[A');
        } else {
          this.dataEmitter.fire('\x1B[B');
        }
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

  // ==========================================================================
  // Scrollbar Handlers
  // ==========================================================================

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

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
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
}
