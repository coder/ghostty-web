/**
 * Terminal - Main terminal emulator class
 *
 * Provides an xterm.js-compatible API wrapping Ghostty's WASM terminal emulator.
 *
 * Usage:
 * ```typescript
 * const term = new Terminal({ cols: 80, rows: 24 });
 * await term.open(document.getElementById('container'));
 * term.write('Hello, World!\n');
 * term.onData(data => console.log('User typed:', data));
 * ```
 */

import { EventEmitter } from './event-emitter';
import { Ghostty, type GhosttyTerminal } from './ghostty';
import { InputHandler } from './input-handler';
import type {
  IDisposable,
  IEvent,
  ITerminalAddon,
  ITerminalCore,
  ITerminalOptions,
} from './interfaces';
import { CanvasRenderer } from './renderer';
import { SelectionManager } from './selection-manager';

// ============================================================================
// Terminal Class
// ============================================================================

export class Terminal implements ITerminalCore {
  // Public properties (xterm.js compatibility)
  public cols: number;
  public rows: number;
  public element?: HTMLElement;
  public textarea?: HTMLTextAreaElement;

  // Options
  private options: Required<ITerminalOptions>;

  // Components (created on open())
  private ghostty?: Ghostty;
  private wasmTerm?: GhosttyTerminal;
  private renderer?: CanvasRenderer;
  private inputHandler?: InputHandler;
  private selectionManager?: SelectionManager;
  private canvas?: HTMLCanvasElement;

  // Event emitters
  private dataEmitter = new EventEmitter<string>();
  private resizeEmitter = new EventEmitter<{ cols: number; rows: number }>();
  private bellEmitter = new EventEmitter<void>();
  private selectionChangeEmitter = new EventEmitter<void>();

  // Public event accessors (xterm.js compatibility)
  public readonly onData: IEvent<string> = this.dataEmitter.event;
  public readonly onResize: IEvent<{ cols: number; rows: number }> = this.resizeEmitter.event;
  public readonly onBell: IEvent<void> = this.bellEmitter.event;
  public readonly onSelectionChange: IEvent<void> = this.selectionChangeEmitter.event;

  // Lifecycle state
  private isOpen = false;
  private isDisposed = false;
  private animationFrameId?: number;

  // Addons
  private addons: ITerminalAddon[] = [];

  constructor(options: ITerminalOptions = {}) {
    // Set default options
    this.options = {
      cols: options.cols ?? 80,
      rows: options.rows ?? 24,
      cursorBlink: options.cursorBlink ?? false,
      cursorStyle: options.cursorStyle ?? 'block',
      theme: options.theme ?? {},
      scrollback: options.scrollback ?? 1000,
      fontSize: options.fontSize ?? 15,
      fontFamily: options.fontFamily ?? 'monospace',
      allowTransparency: options.allowTransparency ?? false,
      wasmPath: options.wasmPath, // Optional - Ghostty.load() handles defaults
    };

    this.cols = this.options.cols;
    this.rows = this.options.rows;
  }

  // ==========================================================================
  // Lifecycle Methods
  // ==========================================================================

  /**
   * Open terminal in a parent element
   * This initializes all components and starts rendering
   */
  async open(parent: HTMLElement): Promise<void> {
    if (this.isOpen) {
      throw new Error('Terminal is already open');
    }
    if (this.isDisposed) {
      throw new Error('Terminal has been disposed');
    }

    try {
      // Store parent element
      this.element = parent;

      // Load Ghostty WASM
      this.ghostty = await Ghostty.load(this.options.wasmPath);

      // Create WASM terminal
      this.wasmTerm = this.ghostty.createTerminal(this.options.cols, this.options.rows);

      // Create canvas element
      this.canvas = document.createElement('canvas');
      this.canvas.style.display = 'block';
      parent.appendChild(this.canvas);

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

      // Create input handler
      this.inputHandler = new InputHandler(
        this.ghostty,
        parent,
        (data: string) => {
          // Input handler fires data events
          this.dataEmitter.fire(data);
        },
        () => {
          // Input handler can also fire bell
          this.bellEmitter.fire();
        }
      );

      // Create selection manager
      this.selectionManager = new SelectionManager(this, this.renderer, this.wasmTerm);

      // Connect selection manager to renderer
      this.renderer.setSelectionManager(this.selectionManager);

      // Forward selection change events
      this.selectionManager.onSelectionChange(() => {
        this.selectionChangeEmitter.fire();
      });

      // Mark as open
      this.isOpen = true;

      // Render initial blank screen
      this.renderer.render(this.wasmTerm, true);

      // Start render loop
      this.startRenderLoop();

      // Focus input (auto-focus so user can start typing immediately)
      this.focus();
    } catch (error) {
      // Clean up on error
      this.cleanupComponents();
      throw new Error(`Failed to open terminal: ${error}`);
    }
  }

  /**
   * Write data to terminal
   */
  write(data: string | Uint8Array): void {
    this.assertOpen();

    // Clear selection when writing new data (standard terminal behavior)
    if (this.selectionManager?.hasSelection()) {
      this.selectionManager.clearSelection();
    }

    // Write directly to WASM terminal (handles VT parsing internally)
    this.wasmTerm!.write(data);

    // Render will happen on next animation frame
  }

  /**
   * Write data with newline
   */
  writeln(data: string): void {
    this.write(data + '\r\n');
  }

  /**
   * Resize terminal
   */
  resize(cols: number, rows: number): void {
    this.assertOpen();

    if (cols === this.cols && rows === this.rows) {
      return; // No change
    }

    // Update dimensions
    this.cols = cols;
    this.rows = rows;

    // Resize WASM terminal
    this.wasmTerm!.resize(cols, rows);

    // Resize renderer
    this.renderer!.resize(cols, rows);

    // Update canvas dimensions
    const metrics = this.renderer!.getMetrics();
    this.canvas!.width = metrics.width * cols;
    this.canvas!.height = metrics.height * rows;
    this.canvas!.style.width = `${metrics.width * cols}px`;
    this.canvas!.style.height = `${metrics.height * rows}px`;

    // Fire resize event
    this.resizeEmitter.fire({ cols, rows });

    // Force full render
    this.renderer!.render(this.wasmTerm!, true);
  }

  /**
   * Clear terminal screen
   */
  clear(): void {
    this.assertOpen();
    // Send ANSI clear screen and cursor home sequences
    this.wasmTerm!.write('\x1b[2J\x1b[H');
  }

  /**
   * Reset terminal state
   */
  reset(): void {
    this.assertOpen();

    // Free old WASM terminal and create new one
    if (this.wasmTerm) {
      this.wasmTerm.free();
    }
    this.wasmTerm = this.ghostty!.createTerminal(this.cols, this.rows);

    // Clear renderer
    this.renderer!.clear();
  }

  /**
   * Focus terminal input
   */
  focus(): void {
    if (this.isOpen && this.element) {
      // Focus the container element to receive keyboard events
      // Use setTimeout to ensure DOM is fully ready
      setTimeout(() => {
        this.element?.focus();
      }, 0);
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
   * Select all text in the terminal
   */
  public selectAll(): void {
    this.selectionManager?.selectAll();
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Dispose terminal and clean up resources
   */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }

    this.isDisposed = true;
    this.isOpen = false;

    // Stop render loop
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = undefined;
    }

    // Dispose addons
    for (const addon of this.addons) {
      addon.dispose();
    }
    this.addons = [];

    // Clean up components
    this.cleanupComponents();

    // Dispose event emitters
    this.dataEmitter.dispose();
    this.resizeEmitter.dispose();
    this.bellEmitter.dispose();
    this.selectionChangeEmitter.dispose();
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Start the render loop
   */
  private startRenderLoop(): void {
    const loop = () => {
      if (!this.isDisposed && this.isOpen) {
        // Render only dirty lines for 60 FPS performance
        this.renderer!.render(this.wasmTerm!, false);
        this.animationFrameId = requestAnimationFrame(loop);
      }
    };
    loop();
  }

  /**
   * Clean up components (called on dispose or error)
   */
  private cleanupComponents(): void {
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

    // Remove canvas from DOM
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
      this.canvas = undefined;
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
    if (!this.isOpen) {
      throw new Error('Terminal must be opened before use. Call terminal.open(parent) first.');
    }
    if (this.isDisposed) {
      throw new Error('Terminal has been disposed');
    }
  }
}
