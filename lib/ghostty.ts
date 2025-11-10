/**
 * TypeScript wrapper for libghostty-vt WASM API
 * 
 * This provides a high-level, ergonomic API around the low-level C ABI
 * exports from libghostty-vt.wasm
 */

import {
  type GhosttyWasmExports,
  type SgrAttribute,
  SgrAttributeTag,
  type RGBColor,
  type KeyEvent,
  KeyEncoderOption,
  type KittyKeyFlags,
} from './types';

// Re-export types for convenience
export { SgrAttributeTag, type SgrAttribute, type RGBColor };

/**
 * Main Ghostty WASM wrapper class
 */
export class Ghostty {
  private exports: GhosttyWasmExports;
  private memory: WebAssembly.Memory;

  constructor(wasmInstance: WebAssembly.Instance) {
    this.exports = wasmInstance.exports as GhosttyWasmExports;
    this.memory = this.exports.memory;
  }

  /**
   * Get current memory buffer (may change when memory grows)
   */
  private getBuffer(): ArrayBuffer {
    return this.memory.buffer;
  }

  /**
   * Create an SGR parser instance
   */
  createSgrParser(): SgrParser {
    return new SgrParser(this.exports);
  }

  /**
   * Create a key encoder instance
   */
  createKeyEncoder(): KeyEncoder {
    return new KeyEncoder(this.exports);
  }

  /**
   * Load Ghostty WASM from URL or file path
   */
  static async load(wasmPath: string): Promise<Ghostty> {
    let wasmBytes: ArrayBuffer;
    
    // Try loading as file first (for Node/Bun environments)
    try {
      const fs = await import('fs/promises');
      const buffer = await fs.readFile(wasmPath);
      wasmBytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    } catch (e) {
      // Fall back to fetch (for browser environments)
      const response = await fetch(wasmPath);
      wasmBytes = await response.arrayBuffer();
    }

    const wasmModule = await WebAssembly.instantiate(wasmBytes, {
      env: {
        log: (ptr: number, len: number) => {
          const instance = (wasmModule as any).instance;
          const bytes = new Uint8Array(
            instance.exports.memory.buffer,
            ptr,
            len
          );
          const text = new TextDecoder().decode(bytes);
          console.log('[ghostty-wasm]', text);
        },
      },
    });

    return new Ghostty(wasmModule.instance);
  }
}

/**
 * SGR (Select Graphic Rendition) Parser
 * Parses ANSI color/style sequences like "1;31" (bold red)
 */
export class SgrParser {
  private exports: GhosttyWasmExports;
  private parser: number = 0;

  constructor(exports: GhosttyWasmExports) {
    this.exports = exports;

    // Allocate parser
    const parserPtrPtr = this.exports.ghostty_wasm_alloc_opaque();
    const result = this.exports.ghostty_sgr_new(0, parserPtrPtr);
    if (result !== 0) {
      throw new Error(`Failed to create SGR parser: ${result}`);
    }

    // Read the parser pointer
    const view = new DataView(this.exports.memory.buffer);
    this.parser = view.getUint32(parserPtrPtr, true);
    this.exports.ghostty_wasm_free_opaque(parserPtrPtr);
  }

  /**
   * Parse SGR parameters (e.g., [1, 31] for bold red)
   * @returns Iterator of SGR attributes
   */
  *parse(params: number[]): Generator<SgrAttribute> {
    if (params.length === 0) return;

    // Allocate parameter array
    const paramsPtr = this.exports.ghostty_wasm_alloc_u16_array(params.length);
    const view = new DataView(this.exports.memory.buffer);
    
    // Write parameters (uint16_t array)
    for (let i = 0; i < params.length; i++) {
      view.setUint16(paramsPtr + i * 2, params[i], true);
    }

    // Set params in parser (null for subs, we don't use subparams yet)
    const result = this.exports.ghostty_sgr_set_params(
      this.parser,
      paramsPtr,
      0, // subsPtr - null
      params.length
    );

    this.exports.ghostty_wasm_free_u16_array(paramsPtr, params.length);

    if (result !== 0) {
      throw new Error(`Failed to set SGR params: ${result}`);
    }

    // Iterate through attributes
    const attrPtr = this.exports.ghostty_wasm_alloc_sgr_attribute();
    
    try {
      while (this.exports.ghostty_sgr_next(this.parser, attrPtr)) {
        const attr = this.readAttribute(attrPtr);
        if (attr) yield attr;
      }
    } finally {
      this.exports.ghostty_wasm_free_sgr_attribute(attrPtr);
    }
  }

  private readAttribute(attrPtr: number): SgrAttribute | null {
    const tag = this.exports.ghostty_sgr_attribute_tag(attrPtr);
    const view = new DataView(this.exports.memory.buffer);

    switch (tag) {
      case SgrAttributeTag.BOLD:
        return { tag: SgrAttributeTag.BOLD };
      case SgrAttributeTag.RESET_BOLD:
        return { tag: SgrAttributeTag.RESET_BOLD };
      case SgrAttributeTag.ITALIC:
        return { tag: SgrAttributeTag.ITALIC };
      case SgrAttributeTag.RESET_ITALIC:
        return { tag: SgrAttributeTag.RESET_ITALIC };
      case SgrAttributeTag.FAINT:
        return { tag: SgrAttributeTag.FAINT };
      case SgrAttributeTag.RESET_FAINT:
        return { tag: SgrAttributeTag.RESET_FAINT };
      case SgrAttributeTag.UNDERLINE:
        return { tag: SgrAttributeTag.UNDERLINE };
      case SgrAttributeTag.RESET_UNDERLINE:
        return { tag: SgrAttributeTag.RESET_UNDERLINE };
      case SgrAttributeTag.BLINK:
        return { tag: SgrAttributeTag.BLINK };
      case SgrAttributeTag.RESET_BLINK:
        return { tag: SgrAttributeTag.RESET_BLINK };
      case SgrAttributeTag.INVERSE:
        return { tag: SgrAttributeTag.INVERSE };
      case SgrAttributeTag.RESET_INVERSE:
        return { tag: SgrAttributeTag.RESET_INVERSE };
      case SgrAttributeTag.INVISIBLE:
        return { tag: SgrAttributeTag.INVISIBLE };
      case SgrAttributeTag.RESET_INVISIBLE:
        return { tag: SgrAttributeTag.RESET_INVISIBLE };
      case SgrAttributeTag.STRIKETHROUGH:
        return { tag: SgrAttributeTag.STRIKETHROUGH };
      case SgrAttributeTag.RESET_STRIKETHROUGH:
        return { tag: SgrAttributeTag.RESET_STRIKETHROUGH };

      case SgrAttributeTag.FG_8:
      case SgrAttributeTag.FG_16:
      case SgrAttributeTag.FG_256: {
        // Color value is stored after the tag (uint8_t)
        const color = view.getUint8(attrPtr + 4);
        return { tag, color };
      }

      case SgrAttributeTag.FG_RGB:
      case SgrAttributeTag.BG_RGB:
      case SgrAttributeTag.UNDERLINE_COLOR_RGB: {
        // RGB color stored after the tag (3 bytes: r, g, b)
        const r = view.getUint8(attrPtr + 4);
        const g = view.getUint8(attrPtr + 5);
        const b = view.getUint8(attrPtr + 6);
        return { tag, color: { r, g, b } };
      }

      case SgrAttributeTag.FG_DEFAULT:
        return { tag: SgrAttributeTag.FG_DEFAULT };
      
      case SgrAttributeTag.BG_8:
      case SgrAttributeTag.BG_16:
      case SgrAttributeTag.BG_256: {
        const color = view.getUint8(attrPtr + 4);
        return { tag, color };
      }

      case SgrAttributeTag.BG_DEFAULT:
        return { tag: SgrAttributeTag.BG_DEFAULT };

      case SgrAttributeTag.UNDERLINE_COLOR_DEFAULT:
        return { tag: SgrAttributeTag.UNDERLINE_COLOR_DEFAULT };

      default:
        // Unknown or unhandled
        return null;
    }
  }

  /**
   * Reset parser state
   */
  reset(): void {
    this.exports.ghostty_sgr_reset(this.parser);
  }

  /**
   * Free parser resources
   */
  dispose(): void {
    if (this.parser) {
      this.exports.ghostty_sgr_free(this.parser);
      this.parser = 0;
    }
  }
}

/**
 * Key Encoder
 * Converts keyboard events into terminal escape sequences
 */
export class KeyEncoder {
  private exports: GhosttyWasmExports;
  private encoder: number = 0;

  constructor(exports: GhosttyWasmExports) {
    this.exports = exports;

    // Allocate encoder
    const encoderPtrPtr = this.exports.ghostty_wasm_alloc_opaque();
    const result = this.exports.ghostty_key_encoder_new(0, encoderPtrPtr);
    if (result !== 0) {
      throw new Error(`Failed to create key encoder: ${result}`);
    }

    // Read the encoder pointer
    const view = new DataView(this.exports.memory.buffer);
    this.encoder = view.getUint32(encoderPtrPtr, true);
    this.exports.ghostty_wasm_free_opaque(encoderPtrPtr);
  }

  /**
   * Set an encoder option
   */
  setOption(option: KeyEncoderOption, value: boolean | number): void {
    const valuePtr = this.exports.ghostty_wasm_alloc_u8();
    const view = new DataView(this.exports.memory.buffer);
    
    if (typeof value === 'boolean') {
      view.setUint8(valuePtr, value ? 1 : 0);
    } else {
      view.setUint8(valuePtr, value);
    }

    const result = this.exports.ghostty_key_encoder_setopt(
      this.encoder,
      option,
      valuePtr
    );

    this.exports.ghostty_wasm_free_u8(valuePtr);

    if (result !== 0) {
      throw new Error(`Failed to set encoder option: ${result}`);
    }
  }

  /**
   * Enable Kitty keyboard protocol with specified flags
   */
  setKittyFlags(flags: KittyKeyFlags): void {
    this.setOption(KeyEncoderOption.KITTY_KEYBOARD_FLAGS, flags);
  }

  /**
   * Encode a key event to escape sequence
   */
  encode(event: KeyEvent): Uint8Array {
    // Create key event structure
    const eventPtrPtr = this.exports.ghostty_wasm_alloc_opaque();
    const createResult = this.exports.ghostty_key_event_new(0, eventPtrPtr);
    if (createResult !== 0) {
      throw new Error(`Failed to create key event: ${createResult}`);
    }

    const view = new DataView(this.exports.memory.buffer);
    const eventPtr = view.getUint32(eventPtrPtr, true);
    this.exports.ghostty_wasm_free_opaque(eventPtrPtr);

    // Set event properties
    this.exports.ghostty_key_event_set_action(eventPtr, event.action);
    this.exports.ghostty_key_event_set_key(eventPtr, event.key);
    this.exports.ghostty_key_event_set_mods(eventPtr, event.mods);

    if (event.utf8) {
      const encoder = new TextEncoder();
      const utf8Bytes = encoder.encode(event.utf8);
      const utf8Ptr = this.exports.ghostty_wasm_alloc_u8_array(utf8Bytes.length);
      new Uint8Array(this.exports.memory.buffer).set(utf8Bytes, utf8Ptr);
      this.exports.ghostty_key_event_set_utf8(eventPtr, utf8Ptr, utf8Bytes.length);
      this.exports.ghostty_wasm_free_u8_array(utf8Ptr, utf8Bytes.length);
    }

    // Allocate output buffer
    const bufferSize = 32;
    const bufPtr = this.exports.ghostty_wasm_alloc_u8_array(bufferSize);
    const writtenPtr = this.exports.ghostty_wasm_alloc_usize();

    // Encode
    const encodeResult = this.exports.ghostty_key_encoder_encode(
      this.encoder,
      eventPtr,
      bufPtr,
      bufferSize,
      writtenPtr
    );

    if (encodeResult !== 0) {
      this.exports.ghostty_wasm_free_u8_array(bufPtr, bufferSize);
      this.exports.ghostty_wasm_free_usize(writtenPtr);
      this.exports.ghostty_key_event_free(eventPtr);
      throw new Error(`Failed to encode key: ${encodeResult}`);
    }

    // Read result
    const bytesWritten = view.getUint32(writtenPtr, true);
    const encoded = new Uint8Array(
      this.exports.memory.buffer,
      bufPtr,
      bytesWritten
    ).slice(); // Copy the data

    // Cleanup
    this.exports.ghostty_wasm_free_u8_array(bufPtr, bufferSize);
    this.exports.ghostty_wasm_free_usize(writtenPtr);
    this.exports.ghostty_key_event_free(eventPtr);

    return encoded;
  }

  /**
   * Free encoder resources
   */
  dispose(): void {
    if (this.encoder) {
      this.exports.ghostty_key_encoder_free(this.encoder);
      this.encoder = 0;
    }
  }
}
