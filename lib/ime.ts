/**
 * IME (input method) support: put the composition where the cursor is.
 *
 * A browser draws an IME's preedit — the text being composed, before the user
 * commits it — inside whatever element holds focus, at that element's caret.
 * The terminal draws its own cursor on a canvas, and a canvas has no caret, so
 * nothing lines the two up on its own. Unless the focused input is moved to the
 * cursor cell on every frame, the preedit and the candidate window appear
 * wherever that input happens to sit — for a helper textarea parked at the
 * origin, that is the top-left corner of the terminal.
 *
 * Two elements, one cell:
 *
 *   - the helper textarea, which is what the browser and the platform IME treat
 *     as the input. It stays invisible (opacity 0, transparent caret) but must
 *     be *positioned* correctly, because the platform anchors the candidate
 *     window to it.
 *   - the composition view, which is what a person reads. The textarea is
 *     invisible, so the preedit inside it is invisible too; this element draws
 *     that text in the terminal's own font and colors, at the cursor cell.
 *
 * The view is not decoration for CJK. Korean composes *inside* a syllable — ㄱ
 * becomes 가 becomes 각 as you type — so a user who cannot see the preedit
 * cannot tell what they are about to commit. Chinese and Japanese at least have
 * a candidate window to read; Korean has nothing but the preedit itself.
 */

export interface ImeCellMetrics {
  /** Cell width in CSS pixels. */
  width: number;
  /** Cell height in CSS pixels. */
  height: number;
}

export interface ImeViewStyle {
  fontFamily: string;
  /** Font size in CSS pixels. */
  fontSize: number;
  /** CSS color for the composing text. */
  foreground: string;
  /** CSS color painted behind it, so the canvas underneath does not show. */
  background: string;
}

export interface ImeOverlayOptions {
  /** The terminal's parent element. Both elements are positioned inside it. */
  parent: HTMLElement;
  /** The helper textarea the browser treats as the input. */
  textarea: HTMLTextAreaElement;
  /** Current cell size. Read per move: a resize or a font change moves cells. */
  metrics: () => ImeCellMetrics;
  /** Current view styling. Read per composition, for the same reason. */
  style: () => ImeViewStyle;
}

/**
 * Keeps the IME target and the composition view on the terminal's cursor cell.
 */
export class ImeOverlay {
  private readonly parent: HTMLElement;
  private readonly textarea: HTMLTextAreaElement;
  private readonly metrics: () => ImeCellMetrics;
  private readonly style: () => ImeViewStyle;
  private view: HTMLElement | null = null;
  private col = 0;
  private row = 0;
  private composing = false;
  private disposed = false;

  constructor(options: ImeOverlayOptions) {
    this.parent = options.parent;
    this.textarea = options.textarea;
    this.metrics = options.metrics;
    this.style = options.style;
  }

  /** True while a composition is open. */
  get isComposing(): boolean {
    return this.composing;
  }

  /**
   * Move the IME target to a cell. Called every frame the cursor is drawn, so
   * it must stay cheap: bail out when the cell has not changed.
   */
  moveTo(col: number, row: number): void {
    if (this.disposed) return;
    if (col === this.col && row === this.row) return;
    this.col = col;
    this.row = row;
    this.applyPosition();
  }

  /** compositionstart: show the view (empty until the first update). */
  start(): void {
    if (this.disposed) return;
    this.composing = true;
    this.render('');
  }

  /** compositionupdate: draw what the user has composed so far. */
  update(text: string): void {
    if (this.disposed || !this.composing) return;
    this.render(text);
  }

  /** compositionend: the text has been committed (or cancelled) — hide. */
  end(): void {
    this.composing = false;
    this.hide();
  }

  dispose(): void {
    this.disposed = true;
    this.composing = false;
    this.view?.remove();
    this.view = null;
  }

  private applyPosition(): void {
    const { width, height } = this.metrics();
    if (!(width > 0) || !(height > 0)) return;
    const left = `${this.col * width}px`;
    const top = `${this.row * height}px`;
    // The textarea is one cell tall so the platform anchors the candidate
    // window under the cursor line rather than under the top of the terminal.
    if (this.textarea.style) {
      this.textarea.style.left = left;
      this.textarea.style.top = top;
      this.textarea.style.height = `${height}px`;
    }
    if (this.view) {
      this.view.style.left = left;
      this.view.style.top = top;
    }
  }

  private ensureView(): HTMLElement | null {
    if (this.view) return this.view;
    if (typeof document === 'undefined' || !document.createElement) return null;
    const view = document.createElement('div');
    view.setAttribute('aria-hidden', 'true');
    view.dataset.ghosttyComposition = '';
    view.style.position = 'absolute';
    view.style.zIndex = '10';
    view.style.pointerEvents = 'none';
    view.style.whiteSpace = 'pre';
    view.style.lineHeight = '1';
    // An underline is the convention every platform IME uses for "not
    // committed yet", and it is the one signal that survives a theme whose
    // preedit colors match ordinary text.
    view.style.textDecoration = 'underline';
    this.parent.appendChild(view);
    this.view = view;
    return view;
  }

  private render(text: string): void {
    const view = this.ensureView();
    if (!view) return;
    const { fontFamily, fontSize, foreground, background } = this.style();
    view.style.fontFamily = fontFamily;
    view.style.fontSize = `${fontSize}px`;
    view.style.color = foreground;
    view.style.background = background;
    const { height } = this.metrics();
    if (height > 0) {
      view.style.height = `${height}px`;
      view.style.lineHeight = `${height}px`;
    }
    view.textContent = text;
    view.style.display = text.length > 0 ? 'block' : 'none';
    this.applyPositionTo(view);
  }

  private applyPositionTo(view: HTMLElement): void {
    const { width, height } = this.metrics();
    if (!(width > 0) || !(height > 0)) return;
    view.style.left = `${this.col * width}px`;
    view.style.top = `${this.row * height}px`;
  }

  private hide(): void {
    if (!this.view) return;
    this.view.textContent = '';
    this.view.style.display = 'none';
  }
}
