/**
 * ImagePasteAddon - Handle image paste events
 *
 * Listens for paste events containing image data and emits them as
 * base64-encoded payloads. This is a ghostty-web extension addon,
 * not part of the xterm.js core API.
 *
 * Usage:
 * ```typescript
 * const imagePasteAddon = new ImagePasteAddon();
 * term.loadAddon(imagePasteAddon);
 *
 * imagePasteAddon.onImagePaste((data) => {
 *   console.log(data.name);       // e.g. "clipboard_1234567890.png"
 *   console.log(data.dataBase64); // base64-encoded image data
 * });
 * ```
 */

import type { IDisposable, IEvent, ITerminalAddon, ITerminalCore } from '../interfaces';
import { EventEmitter } from '../event-emitter';

// ============================================================================
// Types
// ============================================================================

export interface IImagePasteData {
  name: string;
  dataBase64: string;
}

// ============================================================================
// ImagePasteAddon Class
// ============================================================================

export class ImagePasteAddon implements ITerminalAddon {
  private _terminal?: ITerminalCore;
  private _pasteListener: ((e: ClipboardEvent) => void) | null = null;
  private _emitter = new EventEmitter<IImagePasteData>();

  /**
   * Event fired when an image is pasted from the clipboard.
   */
  public readonly onImagePaste: IEvent<IImagePasteData> = this._emitter.event;

  /**
   * Activate the addon (called by Terminal.loadAddon)
   */
  public activate(terminal: ITerminalCore): void {
    this._terminal = terminal;

    const element = terminal.element;
    if (element) {
      this._attachListener(element);
    }
  }

  /**
   * Dispose the addon and clean up resources
   */
  public dispose(): void {
    this._detachListener();
    this._emitter.dispose();
    this._terminal = undefined;
  }

  private _attachListener(element: HTMLElement): void {
    this._pasteListener = (event: ClipboardEvent) => {
      const clipboardData = event.clipboardData;
      if (!clipboardData?.items) return;

      for (const item of Array.from(clipboardData.items)) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            event.preventDefault();
            event.stopPropagation();

            const reader = new FileReader();
            reader.onload = () => {
              const result = reader.result as string;
              const base64 = result.split(',')[1];
              if (base64) {
                const ext = file.type.split('/')[1] || 'png';
                this._emitter.fire({
                  name: `clipboard_${Date.now()}.${ext}`,
                  dataBase64: base64,
                });
              }
            };
            reader.readAsDataURL(file);
            return;
          }
        }
      }
    };

    element.addEventListener('paste', this._pasteListener);
  }

  private _detachListener(): void {
    if (this._pasteListener && this._terminal?.element) {
      this._terminal.element.removeEventListener('paste', this._pasteListener);
    }
    this._pasteListener = null;
  }
}
