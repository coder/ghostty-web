var N = /* @__PURE__ */ ((i) => (i[i.CURSOR_KEY_APPLICATION = 0] = "CURSOR_KEY_APPLICATION", i[i.KEYPAD_KEY_APPLICATION = 1] = "KEYPAD_KEY_APPLICATION", i[i.IGNORE_KEYPAD_WITH_NUMLOCK = 2] = "IGNORE_KEYPAD_WITH_NUMLOCK", i[i.ALT_ESC_PREFIX = 3] = "ALT_ESC_PREFIX", i[i.MODIFY_OTHER_KEYS_STATE_2 = 4] = "MODIFY_OTHER_KEYS_STATE_2", i[i.KITTY_KEYBOARD_FLAGS = 5] = "KITTY_KEYBOARD_FLAGS", i))(N || {}), G = /* @__PURE__ */ ((i) => (i[i.RELEASE = 0] = "RELEASE", i[i.PRESS = 1] = "PRESS", i[i.REPEAT = 2] = "REPEAT", i))(G || {}), h = /* @__PURE__ */ ((i) => (i[i.UNIDENTIFIED = 0] = "UNIDENTIFIED", i[i.GRAVE = 1] = "GRAVE", i[i.BACKSLASH = 2] = "BACKSLASH", i[i.BRACKET_LEFT = 3] = "BRACKET_LEFT", i[i.BRACKET_RIGHT = 4] = "BRACKET_RIGHT", i[i.COMMA = 5] = "COMMA", i[i.ZERO = 6] = "ZERO", i[i.ONE = 7] = "ONE", i[i.TWO = 8] = "TWO", i[i.THREE = 9] = "THREE", i[i.FOUR = 10] = "FOUR", i[i.FIVE = 11] = "FIVE", i[i.SIX = 12] = "SIX", i[i.SEVEN = 13] = "SEVEN", i[i.EIGHT = 14] = "EIGHT", i[i.NINE = 15] = "NINE", i[i.EQUAL = 16] = "EQUAL", i[i.INTL_BACKSLASH = 17] = "INTL_BACKSLASH", i[i.INTL_RO = 18] = "INTL_RO", i[i.INTL_YEN = 19] = "INTL_YEN", i[i.A = 20] = "A", i[i.B = 21] = "B", i[i.C = 22] = "C", i[i.D = 23] = "D", i[i.E = 24] = "E", i[i.F = 25] = "F", i[i.G = 26] = "G", i[i.H = 27] = "H", i[i.I = 28] = "I", i[i.J = 29] = "J", i[i.K = 30] = "K", i[i.L = 31] = "L", i[i.M = 32] = "M", i[i.N = 33] = "N", i[i.O = 34] = "O", i[i.P = 35] = "P", i[i.Q = 36] = "Q", i[i.R = 37] = "R", i[i.S = 38] = "S", i[i.T = 39] = "T", i[i.U = 40] = "U", i[i.V = 41] = "V", i[i.W = 42] = "W", i[i.X = 43] = "X", i[i.Y = 44] = "Y", i[i.Z = 45] = "Z", i[i.MINUS = 46] = "MINUS", i[i.PERIOD = 47] = "PERIOD", i[i.QUOTE = 48] = "QUOTE", i[i.SEMICOLON = 49] = "SEMICOLON", i[i.SLASH = 50] = "SLASH", i[i.ALT_LEFT = 51] = "ALT_LEFT", i[i.ALT_RIGHT = 52] = "ALT_RIGHT", i[i.BACKSPACE = 53] = "BACKSPACE", i[i.CAPS_LOCK = 54] = "CAPS_LOCK", i[i.CONTEXT_MENU = 55] = "CONTEXT_MENU", i[i.CONTROL_LEFT = 56] = "CONTROL_LEFT", i[i.CONTROL_RIGHT = 57] = "CONTROL_RIGHT", i[i.ENTER = 58] = "ENTER", i[i.META_LEFT = 59] = "META_LEFT", i[i.META_RIGHT = 60] = "META_RIGHT", i[i.SHIFT_LEFT = 61] = "SHIFT_LEFT", i[i.SHIFT_RIGHT = 62] = "SHIFT_RIGHT", i[i.SPACE = 63] = "SPACE", i[i.TAB = 64] = "TAB", i[i.CONVERT = 65] = "CONVERT", i[i.KANA_MODE = 66] = "KANA_MODE", i[i.NON_CONVERT = 67] = "NON_CONVERT", i[i.DELETE = 68] = "DELETE", i[i.END = 69] = "END", i[i.HELP = 70] = "HELP", i[i.HOME = 71] = "HOME", i[i.INSERT = 72] = "INSERT", i[i.PAGE_DOWN = 73] = "PAGE_DOWN", i[i.PAGE_UP = 74] = "PAGE_UP", i[i.DOWN = 75] = "DOWN", i[i.LEFT = 76] = "LEFT", i[i.RIGHT = 77] = "RIGHT", i[i.UP = 78] = "UP", i[i.NUM_LOCK = 79] = "NUM_LOCK", i[i.KP_0 = 80] = "KP_0", i[i.KP_1 = 81] = "KP_1", i[i.KP_2 = 82] = "KP_2", i[i.KP_3 = 83] = "KP_3", i[i.KP_4 = 84] = "KP_4", i[i.KP_5 = 85] = "KP_5", i[i.KP_6 = 86] = "KP_6", i[i.KP_7 = 87] = "KP_7", i[i.KP_8 = 88] = "KP_8", i[i.KP_9 = 89] = "KP_9", i[i.KP_PLUS = 90] = "KP_PLUS", i[i.KP_BACKSPACE = 91] = "KP_BACKSPACE", i[i.KP_CLEAR = 92] = "KP_CLEAR", i[i.KP_CLEAR_ENTRY = 93] = "KP_CLEAR_ENTRY", i[i.KP_COMMA = 94] = "KP_COMMA", i[i.KP_PERIOD = 95] = "KP_PERIOD", i[i.KP_DIVIDE = 96] = "KP_DIVIDE", i[i.KP_ENTER = 97] = "KP_ENTER", i[i.KP_EQUAL = 98] = "KP_EQUAL", i[i.KP_MEMORY_ADD = 99] = "KP_MEMORY_ADD", i[i.KP_MEMORY_CLEAR = 100] = "KP_MEMORY_CLEAR", i[i.KP_MEMORY_RECALL = 101] = "KP_MEMORY_RECALL", i[i.KP_MEMORY_STORE = 102] = "KP_MEMORY_STORE", i[i.KP_MEMORY_SUBTRACT = 103] = "KP_MEMORY_SUBTRACT", i[i.KP_MULTIPLY = 104] = "KP_MULTIPLY", i[i.KP_PAREN_LEFT = 105] = "KP_PAREN_LEFT", i[i.KP_PAREN_RIGHT = 106] = "KP_PAREN_RIGHT", i[i.KP_MINUS = 107] = "KP_MINUS", i[i.KP_SEPARATOR = 108] = "KP_SEPARATOR", i[i.NUMPAD_UP = 109] = "NUMPAD_UP", i[i.NUMPAD_DOWN = 110] = "NUMPAD_DOWN", i[i.NUMPAD_RIGHT = 111] = "NUMPAD_RIGHT", i[i.NUMPAD_LEFT = 112] = "NUMPAD_LEFT", i[i.NUMPAD_BEGIN = 113] = "NUMPAD_BEGIN", i[i.NUMPAD_HOME = 114] = "NUMPAD_HOME", i[i.NUMPAD_END = 115] = "NUMPAD_END", i[i.NUMPAD_INSERT = 116] = "NUMPAD_INSERT", i[i.NUMPAD_DELETE = 117] = "NUMPAD_DELETE", i[i.NUMPAD_PAGE_UP = 118] = "NUMPAD_PAGE_UP", i[i.NUMPAD_PAGE_DOWN = 119] = "NUMPAD_PAGE_DOWN", i[i.ESCAPE = 120] = "ESCAPE", i[i.F1 = 121] = "F1", i[i.F2 = 122] = "F2", i[i.F3 = 123] = "F3", i[i.F4 = 124] = "F4", i[i.F5 = 125] = "F5", i[i.F6 = 126] = "F6", i[i.F7 = 127] = "F7", i[i.F8 = 128] = "F8", i[i.F9 = 129] = "F9", i[i.F10 = 130] = "F10", i[i.F11 = 131] = "F11", i[i.F12 = 132] = "F12", i[i.F13 = 133] = "F13", i[i.F14 = 134] = "F14", i[i.F15 = 135] = "F15", i[i.F16 = 136] = "F16", i[i.F17 = 137] = "F17", i[i.F18 = 138] = "F18", i[i.F19 = 139] = "F19", i[i.F20 = 140] = "F20", i[i.F21 = 141] = "F21", i[i.F22 = 142] = "F22", i[i.F23 = 143] = "F23", i[i.F24 = 144] = "F24", i[i.F25 = 145] = "F25", i[i.FN_LOCK = 146] = "FN_LOCK", i[i.PRINT_SCREEN = 147] = "PRINT_SCREEN", i[i.SCROLL_LOCK = 148] = "SCROLL_LOCK", i[i.PAUSE = 149] = "PAUSE", i[i.BROWSER_BACK = 150] = "BROWSER_BACK", i[i.BROWSER_FAVORITES = 151] = "BROWSER_FAVORITES", i[i.BROWSER_FORWARD = 152] = "BROWSER_FORWARD", i[i.BROWSER_HOME = 153] = "BROWSER_HOME", i[i.BROWSER_REFRESH = 154] = "BROWSER_REFRESH", i[i.BROWSER_SEARCH = 155] = "BROWSER_SEARCH", i[i.BROWSER_STOP = 156] = "BROWSER_STOP", i[i.EJECT = 157] = "EJECT", i[i.LAUNCH_APP_1 = 158] = "LAUNCH_APP_1", i[i.LAUNCH_APP_2 = 159] = "LAUNCH_APP_2", i[i.LAUNCH_MAIL = 160] = "LAUNCH_MAIL", i[i.MEDIA_PLAY_PAUSE = 161] = "MEDIA_PLAY_PAUSE", i[i.MEDIA_SELECT = 162] = "MEDIA_SELECT", i[i.MEDIA_STOP = 163] = "MEDIA_STOP", i[i.MEDIA_TRACK_NEXT = 164] = "MEDIA_TRACK_NEXT", i[i.MEDIA_TRACK_PREVIOUS = 165] = "MEDIA_TRACK_PREVIOUS", i[i.POWER = 166] = "POWER", i[i.SLEEP = 167] = "SLEEP", i[i.AUDIO_VOLUME_DOWN = 168] = "AUDIO_VOLUME_DOWN", i[i.AUDIO_VOLUME_MUTE = 169] = "AUDIO_VOLUME_MUTE", i[i.AUDIO_VOLUME_UP = 170] = "AUDIO_VOLUME_UP", i[i.WAKE_UP = 171] = "WAKE_UP", i[i.COPY = 172] = "COPY", i[i.CUT = 173] = "CUT", i[i.PASTE = 174] = "PASTE", i))(h || {}), C = /* @__PURE__ */ ((i) => (i[i.NONE = 0] = "NONE", i[i.SHIFT = 1] = "SHIFT", i[i.CTRL = 2] = "CTRL", i[i.ALT = 4] = "ALT", i[i.SUPER = 8] = "SUPER", i[i.CAPSLOCK = 16] = "CAPSLOCK", i[i.NUMLOCK = 32] = "NUMLOCK", i))(C || {}), I = /* @__PURE__ */ ((i) => (i[i.NONE = 0] = "NONE", i[i.PARTIAL = 1] = "PARTIAL", i[i.FULL = 2] = "FULL", i))(I || {});
const Y = 80;
var E = /* @__PURE__ */ ((i) => (i[i.BOLD = 1] = "BOLD", i[i.ITALIC = 2] = "ITALIC", i[i.UNDERLINE = 4] = "UNDERLINE", i[i.STRIKETHROUGH = 8] = "STRIKETHROUGH", i[i.INVERSE = 16] = "INVERSE", i[i.INVISIBLE = 32] = "INVISIBLE", i[i.BLINK = 64] = "BLINK", i[i.FAINT = 128] = "FAINT", i))(E || {});
class k {
  constructor(t) {
    this.exports = t.exports, this.memory = this.exports.memory;
  }
  createKeyEncoder() {
    return new q(this.exports);
  }
  createTerminal(t = 80, e = 24, s) {
    return new Z(this.exports, this.memory, t, e, s);
  }
  static async load(t) {
    if (t)
      return k.loadFromPath(t);
    const e = new URL("../ghostty-vt.wasm", self.location), s = [];
    if (e.protocol === "file:") {
      let o = e.pathname;
      o.match(/^\/[A-Za-z]:\//) && (o = o.slice(1)), s.push(o);
    }
    s.push(e.href, "./ghostty-vt.wasm", "/ghostty-vt.wasm");
    let r = null;
    for (const o of s)
      try {
        return await k.loadFromPath(o);
      } catch (n) {
        r = n instanceof Error ? n : new Error(String(n));
      }
    throw r || new Error("Failed to load Ghostty WASM");
  }
  static async loadFromPath(t) {
    let e;
    if (typeof Bun < "u" && typeof Bun.file == "function")
      try {
        const o = Bun.file(t);
        await o.exists() && (e = await o.arrayBuffer());
      } catch {
      }
    if (!e)
      try {
        const n = await (await import("./__vite-browser-external-2447137e.js")).readFile(t);
        e = n.buffer.slice(n.byteOffset, n.byteOffset + n.byteLength);
      } catch {
      }
    if (!e) {
      const o = await fetch(t);
      if (!o.ok)
        throw new Error(`Failed to fetch WASM: ${o.status} ${o.statusText}`);
      if (e = await o.arrayBuffer(), e.byteLength === 0)
        throw new Error(`WASM file is empty (0 bytes). Check path: ${t}`);
    }
    if (!e)
      throw new Error(`Could not load WASM from path: ${t}`);
    const s = await WebAssembly.compile(e), r = await WebAssembly.instantiate(s, {
      env: {
        log: (o, n) => {
          const a = new Uint8Array(
            r.exports.memory.buffer,
            o,
            n
          );
          console.log("[ghostty-vt]", new TextDecoder().decode(a));
        }
      }
    });
    return new k(r);
  }
}
class q {
  constructor(t) {
    this.encoder = 0, this.exports = t;
    const e = this.exports.ghostty_wasm_alloc_opaque(), s = this.exports.ghostty_key_encoder_new(0, e);
    if (s !== 0)
      throw new Error(`Failed to create key encoder: ${s}`);
    const r = new DataView(this.exports.memory.buffer);
    this.encoder = r.getUint32(e, !0), this.exports.ghostty_wasm_free_opaque(e);
  }
  setOption(t, e) {
    const s = this.exports.ghostty_wasm_alloc_u8();
    new DataView(this.exports.memory.buffer).setUint8(s, typeof e == "boolean" ? e ? 1 : 0 : e), this.exports.ghostty_key_encoder_setopt(this.encoder, t, s), this.exports.ghostty_wasm_free_u8(s);
  }
  setKittyFlags(t) {
    this.setOption(N.KITTY_KEYBOARD_FLAGS, t);
  }
  encode(t) {
    const e = this.exports.ghostty_wasm_alloc_opaque(), s = this.exports.ghostty_key_event_new(0, e);
    if (s !== 0)
      throw new Error(`Failed to create key event: ${s}`);
    const r = new DataView(this.exports.memory.buffer), o = r.getUint32(e, !0);
    if (this.exports.ghostty_wasm_free_opaque(e), this.exports.ghostty_key_event_set_action(o, t.action), this.exports.ghostty_key_event_set_key(o, t.key), this.exports.ghostty_key_event_set_mods(o, t.mods), t.utf8) {
      const w = new TextEncoder().encode(t.utf8), d = this.exports.ghostty_wasm_alloc_u8_array(w.length);
      new Uint8Array(this.exports.memory.buffer).set(w, d), this.exports.ghostty_key_event_set_utf8(o, d, w.length), this.exports.ghostty_wasm_free_u8_array(d, w.length);
    }
    const n = 32, a = this.exports.ghostty_wasm_alloc_u8_array(n), l = this.exports.ghostty_wasm_alloc_usize(), c = this.exports.ghostty_key_encoder_encode(
      this.encoder,
      o,
      a,
      n,
      l
    );
    if (c !== 0)
      throw this.exports.ghostty_wasm_free_u8_array(a, n), this.exports.ghostty_wasm_free_usize(l), this.exports.ghostty_key_event_free(o), new Error(`Failed to encode key: ${c}`);
    const u = r.getUint32(l, !0), m = new Uint8Array(this.exports.memory.buffer, a, u).slice();
    return this.exports.ghostty_wasm_free_u8_array(a, n), this.exports.ghostty_wasm_free_usize(l), this.exports.ghostty_key_event_free(o), m;
  }
  dispose() {
    this.encoder && (this.exports.ghostty_key_encoder_free(this.encoder), this.encoder = 0);
  }
}
const z = class L {
  constructor(t, e, s = 80, r = 24, o) {
    var n;
    if (this.viewportBufferPtr = 0, this.viewportBufferSize = 0, this.cellPool = [], this.graphemeBuffer = null, this.graphemeBufferPtr = 0, this.exports = t, this.memory = e, this._cols = s, this._rows = r, o) {
      const a = this.exports.ghostty_wasm_alloc_u8_array(Y);
      if (a === 0)
        throw new Error("Failed to allocate config (out of memory)");
      try {
        const l = new DataView(this.memory.buffer);
        let c = a;
        l.setUint32(c, o.scrollbackLimit ?? 1e4, !0), c += 4, l.setUint32(c, o.fgColor ?? 0, !0), c += 4, l.setUint32(c, o.bgColor ?? 0, !0), c += 4, l.setUint32(c, o.cursorColor ?? 0, !0), c += 4;
        for (let u = 0; u < 16; u++)
          l.setUint32(c, ((n = o.palette) == null ? void 0 : n[u]) ?? 0, !0), c += 4;
        this.handle = this.exports.ghostty_terminal_new_with_config(s, r, a);
      } finally {
        this.exports.ghostty_wasm_free_u8_array(a, Y);
      }
    } else
      this.handle = this.exports.ghostty_terminal_new(s, r);
    if (!this.handle)
      throw new Error("Failed to create terminal");
    this.initCellPool();
  }
  get cols() {
    return this._cols;
  }
  get rows() {
    return this._rows;
  }
  // ==========================================================================
  // Lifecycle
  // ==========================================================================
  write(t) {
    const e = typeof t == "string" ? new TextEncoder().encode(t) : t, s = this.exports.ghostty_wasm_alloc_u8_array(e.length);
    new Uint8Array(this.memory.buffer).set(e, s), this.exports.ghostty_terminal_write(this.handle, s, e.length), this.exports.ghostty_wasm_free_u8_array(s, e.length);
  }
  resize(t, e) {
    t === this._cols && e === this._rows || (this._cols = t, this._rows = e, this.exports.ghostty_terminal_resize(this.handle, t, e), this.invalidateBuffers(), this.initCellPool());
  }
  free() {
    this.viewportBufferPtr && (this.exports.ghostty_wasm_free_u8_array(this.viewportBufferPtr, this.viewportBufferSize), this.viewportBufferPtr = 0), this.exports.ghostty_terminal_free(this.handle);
  }
  // ==========================================================================
  // RenderState API - The key performance optimization
  // ==========================================================================
  /**
   * Update render state from terminal.
   *
   * This syncs the RenderState with the current Terminal state.
   * The dirty state (full/partial/none) is stored in the WASM RenderState
   * and can be queried via isRowDirty(). When dirty==full, isRowDirty()
   * returns true for ALL rows.
   *
   * The WASM layer automatically detects screen switches (normal <-> alternate)
   * and returns FULL dirty state when switching screens (e.g., vim exit).
   *
   * Safe to call multiple times - dirty state persists until markClean().
   */
  update() {
    return this.exports.ghostty_render_state_update(this.handle);
  }
  /**
   * Get cursor state from render state.
   * Ensures render state is fresh by calling update().
   */
  getCursor() {
    return this.update(), {
      x: this.exports.ghostty_render_state_get_cursor_x(this.handle),
      y: this.exports.ghostty_render_state_get_cursor_y(this.handle),
      viewportX: this.exports.ghostty_render_state_get_cursor_x(this.handle),
      viewportY: this.exports.ghostty_render_state_get_cursor_y(this.handle),
      visible: this.exports.ghostty_render_state_get_cursor_visible(this.handle),
      blinking: !1,
      // TODO: Add blinking support
      style: "block"
      // TODO: Add style support
    };
  }
  /**
   * Get default colors from render state
   */
  getColors() {
    const t = this.exports.ghostty_render_state_get_bg_color(this.handle), e = this.exports.ghostty_render_state_get_fg_color(this.handle);
    return {
      background: {
        r: t >> 16 & 255,
        g: t >> 8 & 255,
        b: t & 255
      },
      foreground: {
        r: e >> 16 & 255,
        g: e >> 8 & 255,
        b: e & 255
      },
      cursor: null
      // TODO: Add cursor color support
    };
  }
  /**
   * Check if a specific row is dirty
   */
  isRowDirty(t) {
    return this.exports.ghostty_render_state_is_row_dirty(this.handle, t);
  }
  /**
   * Mark render state as clean (call after rendering)
   */
  markClean() {
    this.exports.ghostty_render_state_mark_clean(this.handle);
  }
  /**
   * Get ALL viewport cells in ONE WASM call - the key performance optimization!
   * Returns a reusable cell array (zero allocation after warmup).
   */
  getViewport() {
    const t = this._cols * this._rows, e = t * L.CELL_SIZE;
    return (!this.viewportBufferPtr || this.viewportBufferSize < e) && (this.viewportBufferPtr && this.exports.ghostty_wasm_free_u8_array(this.viewportBufferPtr, this.viewportBufferSize), this.viewportBufferPtr = this.exports.ghostty_wasm_alloc_u8_array(e), this.viewportBufferSize = e), this.exports.ghostty_render_state_get_viewport(
      this.handle,
      this.viewportBufferPtr,
      t
    ) < 0 ? this.cellPool : (this.parseCellsIntoPool(this.viewportBufferPtr, t), this.cellPool);
  }
  // ==========================================================================
  // Compatibility methods (delegate to render state)
  // ==========================================================================
  /**
   * Get line - for compatibility, extracts from viewport.
   * Ensures render state is fresh by calling update().
   * Returns a COPY of the cells to avoid pool reference issues.
   */
  getLine(t) {
    if (t < 0 || t >= this._rows)
      return null;
    this.update();
    const e = this.getViewport(), s = t * this._cols;
    return e.slice(s, s + this._cols).map((r) => ({ ...r }));
  }
  /** For compatibility with old API */
  isDirty() {
    return this.update() !== I.NONE;
  }
  /**
   * Check if a full redraw is needed (screen change, resize, etc.)
   * Note: This calls update() to ensure fresh state. Safe to call multiple times.
   */
  needsFullRedraw() {
    return this.update() === I.FULL;
  }
  /** Mark render state as clean after rendering */
  clearDirty() {
    this.markClean();
  }
  // ==========================================================================
  // Terminal modes
  // ==========================================================================
  isAlternateScreen() {
    return !!this.exports.ghostty_terminal_is_alternate_screen(this.handle);
  }
  hasBracketedPaste() {
    return this.getMode(2004, !1);
  }
  hasFocusEvents() {
    return this.getMode(1004, !1);
  }
  hasMouseTracking() {
    return this.exports.ghostty_terminal_has_mouse_tracking(this.handle) !== 0;
  }
  // ==========================================================================
  // Extended API (scrollback, modes, etc.)
  // ==========================================================================
  /** Get dimensions - for compatibility */
  getDimensions() {
    return { cols: this._cols, rows: this._rows };
  }
  /** Get number of scrollback lines (history, not including active screen) */
  getScrollbackLength() {
    return this.exports.ghostty_terminal_get_scrollback_length(this.handle);
  }
  /**
   * Get a line from the scrollback buffer.
   * Ensures render state is fresh by calling update().
   * @param offset 0 = oldest line, (length-1) = most recent scrollback line
   */
  getScrollbackLine(t) {
    const e = this._cols * L.CELL_SIZE;
    (!this.viewportBufferPtr || this.viewportBufferSize < e) && (this.viewportBufferPtr && this.exports.ghostty_wasm_free_u8_array(this.viewportBufferPtr, this.viewportBufferSize), this.viewportBufferPtr = this.exports.ghostty_wasm_alloc_u8_array(e), this.viewportBufferSize = e), this.update();
    const s = this.exports.ghostty_terminal_get_scrollback_line(
      this.handle,
      t,
      this.viewportBufferPtr,
      this._cols
    );
    if (s < 0)
      return null;
    const r = [], o = this.memory.buffer, n = new Uint8Array(o, this.viewportBufferPtr, s * L.CELL_SIZE), a = new DataView(o, this.viewportBufferPtr, s * L.CELL_SIZE);
    for (let l = 0; l < s; l++) {
      const c = l * L.CELL_SIZE;
      r.push({
        codepoint: a.getUint32(c, !0),
        fg_r: n[c + 4],
        fg_g: n[c + 5],
        fg_b: n[c + 6],
        bg_r: n[c + 7],
        bg_g: n[c + 8],
        bg_b: n[c + 9],
        flags: n[c + 10],
        width: n[c + 11],
        hyperlink_id: a.getUint16(c + 12, !0),
        grapheme_len: n[c + 14]
      });
    }
    return r;
  }
  /** Check if a row in the active screen is wrapped (soft-wrapped to next line) */
  isRowWrapped(t) {
    return this.exports.ghostty_terminal_is_row_wrapped(this.handle, t) !== 0;
  }
  /**
   * Get the hyperlink URI for a cell at the given position.
   * @param row Row index (0-based, in active viewport)
   * @param col Column index (0-based)
   * @returns The URI string, or null if no hyperlink at that position
   */
  getHyperlinkUri(t, e) {
    if (!this.exports.ghostty_terminal_get_hyperlink_uri)
      return null;
    const s = [2048, 8192, 32768];
    for (const r of s) {
      const o = this.exports.ghostty_wasm_alloc_u8_array(r);
      try {
        const n = this.exports.ghostty_terminal_get_hyperlink_uri(
          this.handle,
          t,
          e,
          o,
          r
        );
        if (n === 0)
          return null;
        if (n === -1)
          continue;
        if (n < 0)
          return null;
        const a = new Uint8Array(this.memory.buffer, o, n);
        return new TextDecoder().decode(a.slice());
      } finally {
        this.exports.ghostty_wasm_free_u8_array(o, r);
      }
    }
    return null;
  }
  /**
   * Get the hyperlink URI for a cell in the scrollback buffer.
   * @param offset Scrollback line offset (0 = oldest, scrollback_len-1 = newest)
   * @param col Column index (0-based)
   * @returns The URI string, or null if no hyperlink at that position
   */
  getScrollbackHyperlinkUri(t, e) {
    if (!this.exports.ghostty_terminal_get_scrollback_hyperlink_uri)
      return null;
    const s = [2048, 8192, 32768];
    for (const r of s) {
      const o = this.exports.ghostty_wasm_alloc_u8_array(r);
      try {
        const n = this.exports.ghostty_terminal_get_scrollback_hyperlink_uri(
          this.handle,
          t,
          e,
          o,
          r
        );
        if (n === 0)
          return null;
        if (n === -1)
          continue;
        if (n < 0)
          return null;
        const a = new Uint8Array(this.memory.buffer, o, n);
        return new TextDecoder().decode(a.slice());
      } finally {
        this.exports.ghostty_wasm_free_u8_array(o, r);
      }
    }
    return null;
  }
  /**
   * Check if there are pending responses from the terminal.
   * Responses are generated by escape sequences like DSR (Device Status Report).
   */
  hasResponse() {
    return this.exports.ghostty_terminal_has_response(this.handle);
  }
  /**
   * Read pending responses from the terminal.
   * Returns the response string, or null if no responses pending.
   *
   * Responses are generated by escape sequences that require replies:
   * - DSR 6 (cursor position): Returns \x1b[row;colR
   * - DSR 5 (operating status): Returns \x1b[0n
   */
  readResponse() {
    if (!this.hasResponse())
      return null;
    const t = 256, e = this.exports.ghostty_wasm_alloc_u8_array(t);
    try {
      const s = this.exports.ghostty_terminal_read_response(this.handle, e, t);
      if (s <= 0)
        return null;
      const r = new Uint8Array(this.memory.buffer, e, s);
      return new TextDecoder().decode(r.slice());
    } finally {
      this.exports.ghostty_wasm_free_u8_array(e, t);
    }
  }
  /**
   * Query arbitrary terminal mode by number
   * @param mode Mode number (e.g., 25 for cursor visibility, 2004 for bracketed paste)
   * @param isAnsi True for ANSI modes, false for DEC modes (default: false)
   */
  getMode(t, e = !1) {
    return this.exports.ghostty_terminal_get_mode(this.handle, t, e) !== 0;
  }
  // ==========================================================================
  // Private helpers
  // ==========================================================================
  initCellPool() {
    const t = this._cols * this._rows;
    if (this.cellPool.length < t)
      for (let e = this.cellPool.length; e < t; e++)
        this.cellPool.push({
          codepoint: 0,
          fg_r: 204,
          fg_g: 204,
          fg_b: 204,
          bg_r: 0,
          bg_g: 0,
          bg_b: 0,
          flags: 0,
          width: 1,
          hyperlink_id: 0,
          grapheme_len: 0
        });
  }
  parseCellsIntoPool(t, e) {
    const s = this.memory.buffer, r = new Uint8Array(s, t, e * L.CELL_SIZE), o = new DataView(s, t, e * L.CELL_SIZE);
    for (let n = 0; n < e; n++) {
      const a = n * L.CELL_SIZE, l = this.cellPool[n];
      l.codepoint = o.getUint32(a, !0), l.fg_r = r[a + 4], l.fg_g = r[a + 5], l.fg_b = r[a + 6], l.bg_r = r[a + 7], l.bg_g = r[a + 8], l.bg_b = r[a + 9], l.flags = r[a + 10], l.width = r[a + 11], l.hyperlink_id = o.getUint16(a + 12, !0), l.grapheme_len = r[a + 14];
    }
  }
  /**
   * Get all codepoints for a grapheme cluster at the given position.
   * For most cells this returns a single codepoint, but for complex scripts
   * (Hindi, emoji with ZWJ, etc.) it returns multiple codepoints.
   * @returns Array of codepoints, or null on error
   */
  getGrapheme(t, e) {
    this.graphemeBuffer || (this.graphemeBufferPtr = this.exports.ghostty_wasm_alloc_u8_array(16 * 4), this.graphemeBuffer = new Uint32Array(this.memory.buffer, this.graphemeBufferPtr, 16));
    const s = this.exports.ghostty_render_state_get_grapheme(
      this.handle,
      t,
      e,
      this.graphemeBufferPtr,
      16
    );
    if (s < 0)
      return null;
    const r = new Uint32Array(this.memory.buffer, this.graphemeBufferPtr, s);
    return Array.from(r);
  }
  /**
   * Get a string representation of the grapheme at the given position.
   * This properly handles complex scripts like Hindi, emoji with ZWJ, etc.
   */
  getGraphemeString(t, e) {
    const s = this.getGrapheme(t, e);
    return !s || s.length === 0 ? " " : String.fromCodePoint(...s);
  }
  /**
   * Get all codepoints for a grapheme cluster in the scrollback buffer.
   * @param offset Scrollback line offset (0 = oldest)
   * @param col Column index
   * @returns Array of codepoints, or null on error
   */
  getScrollbackGrapheme(t, e) {
    this.graphemeBuffer || (this.graphemeBufferPtr = this.exports.ghostty_wasm_alloc_u8_array(16 * 4), this.graphemeBuffer = new Uint32Array(this.memory.buffer, this.graphemeBufferPtr, 16));
    const s = this.exports.ghostty_terminal_get_scrollback_grapheme(
      this.handle,
      t,
      e,
      this.graphemeBufferPtr,
      16
    );
    if (s < 0)
      return null;
    const r = new Uint32Array(this.memory.buffer, this.graphemeBufferPtr, s);
    return Array.from(r);
  }
  /**
   * Get a string representation of a grapheme in the scrollback buffer.
   */
  getScrollbackGraphemeString(t, e) {
    const s = this.getScrollbackGrapheme(t, e);
    return !s || s.length === 0 ? " " : String.fromCodePoint(...s);
  }
  invalidateBuffers() {
    this.viewportBufferPtr && (this.exports.ghostty_wasm_free_u8_array(this.viewportBufferPtr, this.viewportBufferSize), this.viewportBufferPtr = 0, this.viewportBufferSize = 0), this.graphemeBufferPtr && (this.exports.ghostty_wasm_free_u8_array(this.graphemeBufferPtr, 16 * 4), this.graphemeBufferPtr = 0), this.graphemeBuffer = null;
  }
};
z.CELL_SIZE = 16;
let Z = z;
class T {
  constructor() {
    this.listeners = [], this.event = (t) => (this.listeners.push(t), {
      dispose: () => {
        const e = this.listeners.indexOf(t);
        e >= 0 && this.listeners.splice(e, 1);
      }
    });
  }
  fire(t) {
    for (const e of this.listeners)
      e(t);
  }
  dispose() {
    this.listeners = [];
  }
}
class Q {
  constructor(t) {
    this.bufferChangeEmitter = new T(), this.terminal = t;
  }
  get active() {
    const t = this.terminal.wasmTerm;
    return t ? t.isAlternateScreen() ? this.alternate : this.normal : this.normal;
  }
  get normal() {
    return this._normalBuffer || (this._normalBuffer = new W(this.terminal, "normal")), this._normalBuffer;
  }
  get alternate() {
    return this._alternateBuffer || (this._alternateBuffer = new W(this.terminal, "alternate")), this._alternateBuffer;
  }
  get onBufferChange() {
    return this.bufferChangeEmitter.event;
  }
  /**
   * Internal: Fire buffer change event when screen switches
   * Should be called by Terminal when detecting screen change
   */
  _fireBufferChange(t) {
    this.bufferChangeEmitter.fire(t);
  }
}
class W {
  constructor(t, e) {
    this.terminal = t, this.bufferType = e;
    const s = {
      codepoint: 0,
      fg_r: 204,
      fg_g: 204,
      fg_b: 204,
      bg_r: 0,
      bg_g: 0,
      bg_b: 0,
      flags: 0,
      width: 1,
      hyperlink_id: 0,
      grapheme_len: 0
    };
    this.nullCell = new B(s, 0);
  }
  get type() {
    return this.bufferType;
  }
  get cursorX() {
    const t = this.getWasmTerm();
    return t ? t.getCursor().x : 0;
  }
  get cursorY() {
    const t = this.getWasmTerm();
    return t ? t.getCursor().y : 0;
  }
  get viewportY() {
    return 0;
  }
  get baseY() {
    return 0;
  }
  get length() {
    const t = this.getWasmTerm();
    return t ? this.bufferType === "alternate" ? t.rows : t.getScrollbackLength() + t.rows : 0;
  }
  getLine(t) {
    const e = this.getWasmTerm();
    if (!e || t < 0 || t >= this.length)
      return;
    const s = e.getScrollbackLength();
    let r, o, n;
    if (this.bufferType === "normal" && t < s) {
      const a = t;
      r = e.getScrollbackLine(a), n = !1;
    } else
      o = this.bufferType === "normal" ? t - s : t, r = e.getLine(o), n = e.isRowWrapped(o);
    if (r)
      return new J(r, n, e.cols);
  }
  getNullCell() {
    return this.nullCell;
  }
  getWasmTerm() {
    return this.terminal.wasmTerm;
  }
}
class J {
  constructor(t, e, s) {
    this.cells = t, this._isWrapped = e, this._length = s;
  }
  get length() {
    return this._length;
  }
  get isWrapped() {
    return this._isWrapped;
  }
  getCell(t) {
    if (!(t < 0 || t >= this._length))
      return t >= this.cells.length ? new B(
        {
          codepoint: 0,
          fg_r: 204,
          fg_g: 204,
          fg_b: 204,
          bg_r: 0,
          bg_g: 0,
          bg_b: 0,
          flags: 0,
          width: 1,
          hyperlink_id: 0,
          grapheme_len: 0
        },
        t
      ) : new B(this.cells[t], t);
  }
  translateToString(t = !1, e = 0, s = this._length) {
    const r = Math.max(0, Math.min(e, this._length)), o = Math.max(r, Math.min(s, this._length));
    let n = "";
    for (let a = r; a < o; a++) {
      const l = this.getCell(a);
      if (l) {
        const c = l.getChars();
        n += c;
      }
    }
    return t && (n = n.trimEnd()), n;
  }
}
class B {
  constructor(t, e) {
    this.cell = t, this.x = e;
  }
  getChars() {
    const t = this.cell.codepoint;
    return t === 0 ? "" : t < 0 || t > 1114111 || t >= 55296 && t <= 57343 ? "�" : String.fromCodePoint(t);
  }
  getCode() {
    return this.cell.codepoint;
  }
  getWidth() {
    return this.cell.width;
  }
  getFgColorMode() {
    return -1;
  }
  getBgColorMode() {
    return -1;
  }
  getFgColor() {
    return this.cell.fg_r << 16 | this.cell.fg_g << 8 | this.cell.fg_b;
  }
  getBgColor() {
    return this.cell.bg_r << 16 | this.cell.bg_g << 8 | this.cell.bg_b;
  }
  isBold() {
    return this.cell.flags & E.BOLD ? 1 : 0;
  }
  isItalic() {
    return this.cell.flags & E.ITALIC ? 1 : 0;
  }
  isUnderline() {
    return this.cell.flags & E.UNDERLINE ? 1 : 0;
  }
  isStrikethrough() {
    return this.cell.flags & E.STRIKETHROUGH ? 1 : 0;
  }
  isBlink() {
    return this.cell.flags & E.BLINK ? 1 : 0;
  }
  isInverse() {
    return this.cell.flags & E.INVERSE ? 1 : 0;
  }
  isInvisible() {
    return this.cell.flags & E.INVISIBLE ? 1 : 0;
  }
  isFaint() {
    return this.cell.flags & E.FAINT ? 1 : 0;
  }
  /**
   * Get hyperlink ID for this cell (0 = no link)
   * Used by link detection system
   */
  getHyperlinkId() {
    return this.cell.hyperlink_id;
  }
  /**
   * Get the Unicode codepoint for this cell
   * Used by link detection system
   */
  getCodepoint() {
    return this.cell.codepoint;
  }
  /**
   * Check if cell has dim/faint attribute
   * Added for IBufferCell compatibility
   */
  isDim() {
    return (this.cell.flags & E.FAINT) !== 0;
  }
}
const j = {
  // Letters
  KeyA: h.A,
  KeyB: h.B,
  KeyC: h.C,
  KeyD: h.D,
  KeyE: h.E,
  KeyF: h.F,
  KeyG: h.G,
  KeyH: h.H,
  KeyI: h.I,
  KeyJ: h.J,
  KeyK: h.K,
  KeyL: h.L,
  KeyM: h.M,
  KeyN: h.N,
  KeyO: h.O,
  KeyP: h.P,
  KeyQ: h.Q,
  KeyR: h.R,
  KeyS: h.S,
  KeyT: h.T,
  KeyU: h.U,
  KeyV: h.V,
  KeyW: h.W,
  KeyX: h.X,
  KeyY: h.Y,
  KeyZ: h.Z,
  // Numbers
  Digit1: h.ONE,
  Digit2: h.TWO,
  Digit3: h.THREE,
  Digit4: h.FOUR,
  Digit5: h.FIVE,
  Digit6: h.SIX,
  Digit7: h.SEVEN,
  Digit8: h.EIGHT,
  Digit9: h.NINE,
  Digit0: h.ZERO,
  // Special keys
  Enter: h.ENTER,
  Escape: h.ESCAPE,
  Backspace: h.BACKSPACE,
  Tab: h.TAB,
  Space: h.SPACE,
  // Punctuation
  Minus: h.MINUS,
  Equal: h.EQUAL,
  BracketLeft: h.BRACKET_LEFT,
  BracketRight: h.BRACKET_RIGHT,
  Backslash: h.BACKSLASH,
  Semicolon: h.SEMICOLON,
  Quote: h.QUOTE,
  Backquote: h.GRAVE,
  Comma: h.COMMA,
  Period: h.PERIOD,
  Slash: h.SLASH,
  // Function keys
  CapsLock: h.CAPS_LOCK,
  F1: h.F1,
  F2: h.F2,
  F3: h.F3,
  F4: h.F4,
  F5: h.F5,
  F6: h.F6,
  F7: h.F7,
  F8: h.F8,
  F9: h.F9,
  F10: h.F10,
  F11: h.F11,
  F12: h.F12,
  // Special function keys
  PrintScreen: h.PRINT_SCREEN,
  ScrollLock: h.SCROLL_LOCK,
  Pause: h.PAUSE,
  Insert: h.INSERT,
  Home: h.HOME,
  PageUp: h.PAGE_UP,
  Delete: h.DELETE,
  End: h.END,
  PageDown: h.PAGE_DOWN,
  // Arrow keys
  ArrowRight: h.RIGHT,
  ArrowLeft: h.LEFT,
  ArrowDown: h.DOWN,
  ArrowUp: h.UP,
  // Keypad
  NumLock: h.NUM_LOCK,
  NumpadDivide: h.KP_DIVIDE,
  NumpadMultiply: h.KP_MULTIPLY,
  NumpadSubtract: h.KP_MINUS,
  NumpadAdd: h.KP_PLUS,
  NumpadEnter: h.KP_ENTER,
  Numpad1: h.KP_1,
  Numpad2: h.KP_2,
  Numpad3: h.KP_3,
  Numpad4: h.KP_4,
  Numpad5: h.KP_5,
  Numpad6: h.KP_6,
  Numpad7: h.KP_7,
  Numpad8: h.KP_8,
  Numpad9: h.KP_9,
  Numpad0: h.KP_0,
  NumpadDecimal: h.KP_PERIOD,
  // International
  IntlBackslash: h.INTL_BACKSLASH,
  ContextMenu: h.CONTEXT_MENU,
  // Additional function keys
  F13: h.F13,
  F14: h.F14,
  F15: h.F15,
  F16: h.F16,
  F17: h.F17,
  F18: h.F18,
  F19: h.F19,
  F20: h.F20,
  F21: h.F21,
  F22: h.F22,
  F23: h.F23,
  F24: h.F24
}, X = class x {
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
  constructor(t, e, s, r, o, n, a, l, c, u) {
    this.keydownListener = null, this.keypressListener = null, this.pasteListener = null, this.beforeInputListener = null, this.compositionStartListener = null, this.compositionUpdateListener = null, this.compositionEndListener = null, this.mousedownListener = null, this.mouseupListener = null, this.mousemoveListener = null, this.wheelListener = null, this.isComposing = !1, this.isDisposed = !1, this.mouseButtonsPressed = 0, this.lastKeyDownData = null, this.lastKeyDownTime = 0, this.lastPasteData = null, this.lastPasteTime = 0, this.lastPasteSource = null, this.lastCompositionData = null, this.lastCompositionTime = 0, this.lastBeforeInputData = null, this.lastBeforeInputTime = 0, this.encoder = t.createKeyEncoder(), this.container = e, this.inputElement = c, this.onDataCallback = s, this.onBellCallback = r, this.onKeyCallback = o, this.customKeyEventHandler = n, this.getModeCallback = a, this.onCopyCallback = l, this.mouseConfig = u, this.attach();
  }
  /**
   * Set custom key event handler (for runtime updates)
   */
  setCustomKeyEventHandler(t) {
    this.customKeyEventHandler = t;
  }
  /**
   * Attach keyboard event listeners to container
   */
  attach() {
    typeof this.container.hasAttribute == "function" && typeof this.container.setAttribute == "function" && (this.container.hasAttribute("tabindex") || this.container.setAttribute("tabindex", "0"), this.container.style && (this.container.style.outline = "none")), this.keydownListener = this.handleKeyDown.bind(this), this.container.addEventListener("keydown", this.keydownListener), this.pasteListener = this.handlePaste.bind(this), this.container.addEventListener("paste", this.pasteListener), this.inputElement && this.inputElement !== this.container && this.inputElement.addEventListener("paste", this.pasteListener), this.inputElement && (this.beforeInputListener = this.handleBeforeInput.bind(this), this.inputElement.addEventListener("beforeinput", this.beforeInputListener)), this.compositionStartListener = this.handleCompositionStart.bind(this), this.container.addEventListener("compositionstart", this.compositionStartListener), this.compositionUpdateListener = this.handleCompositionUpdate.bind(this), this.container.addEventListener("compositionupdate", this.compositionUpdateListener), this.compositionEndListener = this.handleCompositionEnd.bind(this), this.container.addEventListener("compositionend", this.compositionEndListener), this.mousedownListener = this.handleMouseDown.bind(this), this.container.addEventListener("mousedown", this.mousedownListener), this.mouseupListener = this.handleMouseUp.bind(this), this.container.addEventListener("mouseup", this.mouseupListener), this.mousemoveListener = this.handleMouseMove.bind(this), this.container.addEventListener("mousemove", this.mousemoveListener), this.wheelListener = this.handleWheel.bind(this), this.container.addEventListener("wheel", this.wheelListener, { passive: !1 });
  }
  /**
   * Map KeyboardEvent.code to USB HID Key enum value
   * @param code - KeyboardEvent.code value
   * @returns Key enum value or null if unmapped
   */
  mapKeyCode(t) {
    return j[t] ?? null;
  }
  /**
   * Extract modifier flags from KeyboardEvent
   * @param event - KeyboardEvent
   * @returns Mods flags
   */
  extractModifiers(t) {
    let e = C.NONE;
    return t.shiftKey && (e |= C.SHIFT), t.ctrlKey && (e |= C.CTRL), t.altKey && (e |= C.ALT), t.metaKey && (e |= C.SUPER), e;
  }
  /**
   * Check if this is a printable character with no special modifiers
   * @param event - KeyboardEvent
   * @returns true if printable character
   */
  isPrintableCharacter(t) {
    return t.ctrlKey && !t.altKey || t.altKey && !t.ctrlKey || t.metaKey ? !1 : t.key.length === 1;
  }
  /**
   * Handle keydown event
   * @param event - KeyboardEvent
   */
  handleKeyDown(t) {
    if (this.isDisposed || this.isComposing || t.isComposing || t.keyCode === 229)
      return;
    if (this.onKeyCallback && this.onKeyCallback({ key: t.key, domEvent: t }), this.customKeyEventHandler && this.customKeyEventHandler(t)) {
      t.preventDefault();
      return;
    }
    if ((t.ctrlKey || t.metaKey) && t.code === "KeyV")
      return;
    if (t.metaKey && t.code === "KeyC") {
      this.onCopyCallback && this.onCopyCallback() && t.preventDefault();
      return;
    }
    if (this.isPrintableCharacter(t)) {
      t.preventDefault(), this.onDataCallback(t.key), this.recordKeyDownData(t.key);
      return;
    }
    const e = this.mapKeyCode(t.code);
    if (e === null)
      return;
    const s = this.extractModifiers(t);
    if (s === C.NONE || s === C.SHIFT) {
      let o = null;
      switch (e) {
        case h.ENTER:
          o = "\r";
          break;
        case h.TAB:
          s === C.SHIFT ? o = "\x1B[Z" : o = "	";
          break;
        case h.BACKSPACE:
          o = "";
          break;
        case h.ESCAPE:
          o = "\x1B";
          break;
        case h.HOME:
          o = "\x1B[H";
          break;
        case h.END:
          o = "\x1B[F";
          break;
        case h.INSERT:
          o = "\x1B[2~";
          break;
        case h.DELETE:
          o = "\x1B[3~";
          break;
        case h.PAGE_UP:
          o = "\x1B[5~";
          break;
        case h.PAGE_DOWN:
          o = "\x1B[6~";
          break;
        case h.F1:
          o = "\x1BOP";
          break;
        case h.F2:
          o = "\x1BOQ";
          break;
        case h.F3:
          o = "\x1BOR";
          break;
        case h.F4:
          o = "\x1BOS";
          break;
        case h.F5:
          o = "\x1B[15~";
          break;
        case h.F6:
          o = "\x1B[17~";
          break;
        case h.F7:
          o = "\x1B[18~";
          break;
        case h.F8:
          o = "\x1B[19~";
          break;
        case h.F9:
          o = "\x1B[20~";
          break;
        case h.F10:
          o = "\x1B[21~";
          break;
        case h.F11:
          o = "\x1B[23~";
          break;
        case h.F12:
          o = "\x1B[24~";
          break;
      }
      if (o !== null) {
        t.preventDefault(), this.onDataCallback(o), this.recordKeyDownData(o);
        return;
      }
    }
    const r = G.PRESS;
    try {
      if (this.getModeCallback) {
        const c = this.getModeCallback(1);
        this.encoder.setOption(N.CURSOR_KEY_APPLICATION, c);
      }
      const o = t.key.length === 1 && t.key.charCodeAt(0) < 128 ? t.key.toLowerCase() : void 0, n = this.encoder.encode({
        action: r,
        key: e,
        mods: s,
        utf8: o
      }), l = new TextDecoder().decode(n);
      t.preventDefault(), t.stopPropagation(), l.length > 0 && (this.onDataCallback(l), this.recordKeyDownData(l));
    } catch (o) {
      console.warn("Failed to encode key:", t.code, o);
    }
  }
  /**
   * Handle paste event from clipboard
   * @param event - ClipboardEvent
   */
  handlePaste(t) {
    if (this.isDisposed)
      return;
    t.preventDefault(), t.stopPropagation();
    const e = t.clipboardData;
    if (!e) {
      console.warn("No clipboard data available");
      return;
    }
    const s = e.getData("text/plain");
    if (!s) {
      console.warn("No text in clipboard");
      return;
    }
    this.shouldIgnorePasteEvent(s, "paste") || (this.emitPasteData(s), this.recordPasteData(s, "paste"));
  }
  /**
   * Handle beforeinput event (mobile/IME input)
   * @param event - InputEvent
   */
  handleBeforeInput(t) {
    if (this.isDisposed || this.isComposing || t.isComposing)
      return;
    const e = t.inputType, s = t.data ?? "";
    let r = null;
    switch (e) {
      case "insertText":
      case "insertReplacementText":
        r = s.length > 0 ? s.replace(/\n/g, "\r") : null;
        break;
      case "insertLineBreak":
      case "insertParagraph":
        r = "\r";
        break;
      case "deleteContentBackward":
        r = "";
        break;
      case "deleteContentForward":
        r = "\x1B[3~";
        break;
      case "insertFromPaste":
        if (!s)
          return;
        if (this.shouldIgnorePasteEvent(s, "beforeinput")) {
          t.preventDefault(), t.stopPropagation();
          return;
        }
        t.preventDefault(), t.stopPropagation(), this.emitPasteData(s), this.recordPasteData(s, "beforeinput");
        return;
      default:
        return;
    }
    if (r) {
      if (this.shouldIgnoreBeforeInput(r)) {
        t.preventDefault(), t.stopPropagation();
        return;
      }
      if (s && this.shouldIgnoreBeforeInputFromComposition(s)) {
        t.preventDefault(), t.stopPropagation();
        return;
      }
      t.preventDefault(), t.stopPropagation(), this.onDataCallback(r), s && this.recordBeforeInputData(s);
    }
  }
  /**
   * Handle compositionstart event
   */
  handleCompositionStart(t) {
    this.isDisposed || (this.isComposing = !0);
  }
  /**
   * Handle compositionupdate event
   */
  handleCompositionUpdate(t) {
    this.isDisposed;
  }
  /**
   * Handle compositionend event
   */
  handleCompositionEnd(t) {
    if (this.isDisposed)
      return;
    this.isComposing = !1;
    const e = t.data;
    if (e && e.length > 0) {
      if (this.shouldIgnoreCompositionEnd(e)) {
        this.cleanupCompositionTextNodes();
        return;
      }
      this.onDataCallback(e), this.recordCompositionData(e);
    }
    this.cleanupCompositionTextNodes();
  }
  /**
   * Cleanup text nodes in container after composition
   */
  cleanupCompositionTextNodes() {
    if (this.container && this.container.childNodes)
      for (let t = this.container.childNodes.length - 1; t >= 0; t--) {
        const e = this.container.childNodes[t];
        e.nodeType === 3 && this.container.removeChild(e);
      }
  }
  // ==========================================================================
  // Mouse Event Handling (for terminal mouse tracking)
  // ==========================================================================
  /**
   * Convert pixel coordinates to terminal cell coordinates
   */
  pixelToCell(t) {
    if (!this.mouseConfig)
      return null;
    const e = this.mouseConfig.getCellDimensions(), s = this.mouseConfig.getCanvasOffset();
    if (e.width <= 0 || e.height <= 0)
      return null;
    const r = t.clientX - s.left, o = t.clientY - s.top, n = Math.floor(r / e.width) + 1, a = Math.floor(o / e.height) + 1;
    return {
      col: Math.max(1, n),
      row: Math.max(1, a)
    };
  }
  /**
   * Get modifier flags for mouse event
   */
  getMouseModifiers(t) {
    let e = 0;
    return t.shiftKey && (e |= 4), t.metaKey && (e |= 8), t.ctrlKey && (e |= 16), e;
  }
  /**
   * Encode mouse event as SGR sequence
   * SGR format: \x1b[<Btn;Col;RowM (press/motion) or \x1b[<Btn;Col;Rowm (release)
   */
  encodeMouseSGR(t, e, s, r, o) {
    return `\x1B[<${t + o};${e};${s}${r ? "m" : "M"}`;
  }
  /**
   * Encode mouse event as X10/normal sequence (legacy format)
   * Format: \x1b[M<Btn+32><Col+32><Row+32>
   */
  encodeMouseX10(t, e, s, r) {
    const o = t + r + 32, n = String.fromCharCode(Math.min(e + 32, 255)), a = String.fromCharCode(Math.min(s + 32, 255));
    return `\x1B[M${String.fromCharCode(o)}${n}${a}`;
  }
  /**
   * Send mouse event to terminal
   */
  sendMouseEvent(t, e, s, r, o) {
    var c, u;
    const n = this.getMouseModifiers(o), a = ((u = (c = this.mouseConfig) == null ? void 0 : c.hasSgrMouseMode) == null ? void 0 : u.call(c)) ?? !0;
    let l;
    if (a)
      l = this.encodeMouseSGR(t, e, s, r, n);
    else {
      const m = r ? 3 : t;
      l = this.encodeMouseX10(m, e, s, n);
    }
    this.onDataCallback(l);
  }
  /**
   * Handle mousedown event
   */
  handleMouseDown(t) {
    var r;
    if (this.isDisposed || !((r = this.mouseConfig) != null && r.hasMouseTracking()))
      return;
    const e = this.pixelToCell(t);
    if (!e)
      return;
    const s = t.button;
    this.mouseButtonsPressed |= 1 << s, this.sendMouseEvent(s, e.col, e.row, !1, t);
  }
  /**
   * Handle mouseup event
   */
  handleMouseUp(t) {
    var r;
    if (this.isDisposed || !((r = this.mouseConfig) != null && r.hasMouseTracking()))
      return;
    const e = this.pixelToCell(t);
    if (!e)
      return;
    const s = t.button;
    this.mouseButtonsPressed &= ~(1 << s), this.sendMouseEvent(s, e.col, e.row, !0, t);
  }
  /**
   * Handle mousemove event
   */
  handleMouseMove(t) {
    var n, a, l;
    if (this.isDisposed || !((n = this.mouseConfig) != null && n.hasMouseTracking()))
      return;
    const e = ((a = this.getModeCallback) == null ? void 0 : a.call(this, 1002)) ?? !1, s = ((l = this.getModeCallback) == null ? void 0 : l.call(this, 1003)) ?? !1;
    if (!e && !s || e && !s && this.mouseButtonsPressed === 0)
      return;
    const r = this.pixelToCell(t);
    if (!r)
      return;
    let o = 32;
    this.mouseButtonsPressed & 1 ? o += 0 : this.mouseButtonsPressed & 2 ? o += 1 : this.mouseButtonsPressed & 4 && (o += 2), this.sendMouseEvent(o, r.col, r.row, !1, t);
  }
  /**
   * Handle wheel event (scroll)
   */
  handleWheel(t) {
    var r;
    if (this.isDisposed || !((r = this.mouseConfig) != null && r.hasMouseTracking()))
      return;
    const e = this.pixelToCell(t);
    if (!e)
      return;
    const s = t.deltaY < 0 ? 64 : 65;
    this.sendMouseEvent(s, e.col, e.row, !1, t), t.preventDefault();
  }
  /**
   * Emit paste data with bracketed paste support
   */
  emitPasteData(t) {
    var s;
    ((s = this.getModeCallback) == null ? void 0 : s.call(this, 2004)) ?? !1 ? this.onDataCallback("\x1B[200~" + t + "\x1B[201~") : this.onDataCallback(t);
  }
  /**
   * Record keydown data for beforeinput de-duplication
   */
  recordKeyDownData(t) {
    this.lastKeyDownData = t, this.lastKeyDownTime = this.getNow();
  }
  /**
   * Record paste data for beforeinput de-duplication
   */
  recordPasteData(t, e) {
    this.lastPasteData = t, this.lastPasteTime = this.getNow(), this.lastPasteSource = e;
  }
  /**
   * Check if beforeinput should be ignored due to a recent keydown
   */
  shouldIgnoreBeforeInput(t) {
    if (!this.lastKeyDownData)
      return !1;
    const s = this.getNow() - this.lastKeyDownTime < x.BEFORE_INPUT_IGNORE_MS && this.lastKeyDownData === t;
    return this.lastKeyDownData = null, s;
  }
  /**
   * Check if beforeinput text should be ignored due to a recent composition end
   */
  shouldIgnoreBeforeInputFromComposition(t) {
    if (!this.lastCompositionData)
      return !1;
    const s = this.getNow() - this.lastCompositionTime < x.BEFORE_INPUT_IGNORE_MS && this.lastCompositionData === t;
    return s && (this.lastCompositionData = null), s;
  }
  /**
   * Check if composition end should be ignored due to a recent beforeinput text
   */
  shouldIgnoreCompositionEnd(t) {
    if (!this.lastBeforeInputData)
      return !1;
    const s = this.getNow() - this.lastBeforeInputTime < x.BEFORE_INPUT_IGNORE_MS && this.lastBeforeInputData === t;
    return s && (this.lastBeforeInputData = null), s;
  }
  /**
   * Record beforeinput text for composition de-duplication
   */
  recordBeforeInputData(t) {
    this.lastBeforeInputData = t, this.lastBeforeInputTime = this.getNow();
  }
  /**
   * Record composition end data for beforeinput de-duplication
   */
  recordCompositionData(t) {
    this.lastCompositionData = t, this.lastCompositionTime = this.getNow();
  }
  /**
   * Check if paste should be ignored due to a recent paste event from another source
   */
  shouldIgnorePasteEvent(t, e) {
    if (!this.lastPasteData || this.lastPasteSource === e)
      return !1;
    const r = this.getNow() - this.lastPasteTime < x.BEFORE_INPUT_IGNORE_MS && this.lastPasteData === t;
    return r && (this.lastPasteData = null, this.lastPasteSource = null), r;
  }
  /**
   * Get current time in milliseconds
   */
  getNow() {
    return typeof performance < "u" && typeof performance.now == "function" ? performance.now() : Date.now();
  }
  /**
   * Dispose the InputHandler and remove event listeners
   */
  dispose() {
    this.isDisposed || (this.keydownListener && (this.container.removeEventListener("keydown", this.keydownListener), this.keydownListener = null), this.keypressListener && (this.container.removeEventListener("keypress", this.keypressListener), this.keypressListener = null), this.pasteListener && (this.container.removeEventListener("paste", this.pasteListener), this.inputElement && this.inputElement !== this.container && this.inputElement.removeEventListener("paste", this.pasteListener), this.pasteListener = null), this.beforeInputListener && this.inputElement && (this.inputElement.removeEventListener("beforeinput", this.beforeInputListener), this.beforeInputListener = null), this.compositionStartListener && (this.container.removeEventListener("compositionstart", this.compositionStartListener), this.compositionStartListener = null), this.compositionUpdateListener && (this.container.removeEventListener("compositionupdate", this.compositionUpdateListener), this.compositionUpdateListener = null), this.compositionEndListener && (this.container.removeEventListener("compositionend", this.compositionEndListener), this.compositionEndListener = null), this.mousedownListener && (this.container.removeEventListener("mousedown", this.mousedownListener), this.mousedownListener = null), this.mouseupListener && (this.container.removeEventListener("mouseup", this.mouseupListener), this.mouseupListener = null), this.mousemoveListener && (this.container.removeEventListener("mousemove", this.mousemoveListener), this.mousemoveListener = null), this.wheelListener && (this.container.removeEventListener("wheel", this.wheelListener), this.wheelListener = null), this.isDisposed = !0);
  }
  /**
   * Check if handler is disposed
   */
  isActive() {
    return !this.isDisposed;
  }
};
X.BEFORE_INPUT_IGNORE_MS = 100;
let K = X;
class tt {
  // Terminal instance for buffer access
  constructor(t) {
    this.terminal = t, this.providers = [], this.linkCache = /* @__PURE__ */ new Map(), this.scannedRows = /* @__PURE__ */ new Set();
  }
  /**
   * Register a link provider
   */
  registerProvider(t) {
    this.providers.push(t), this.invalidateCache();
  }
  /**
   * Get link at the specified buffer position
   * @param col Column (0-based)
   * @param row Absolute row in buffer (0-based)
   * @returns Link at position, or undefined if none
   */
  async getLinkAt(t, e) {
    const s = this.terminal.buffer.active.getLine(e);
    if (!(!s || t < 0 || t >= s.length || !s.getCell(t))) {
      for (const o of this.linkCache.values())
        if (this.isPositionInLink(t, e, o))
          return o;
      this.scannedRows.has(e) || await this.scanRow(e);
      for (const o of this.linkCache.values())
        if (this.isPositionInLink(t, e, o))
          return o;
    }
  }
  /**
   * Scan a row for links using all registered providers
   */
  async scanRow(t) {
    this.scannedRows.add(t);
    const e = [];
    for (const s of this.providers) {
      const r = await new Promise((o) => {
        s.provideLinks(t, o);
      });
      r && e.push(...r);
    }
    for (const s of e)
      this.cacheLink(s);
  }
  /**
   * Cache a link for fast lookup
   *
   * Note: We cache by position range, not hyperlink_id, because the WASM
   * returns hyperlink_id as a boolean (0 or 1), not a unique identifier.
   * The actual unique identifier is the URI which is retrieved separately.
   */
  cacheLink(t) {
    const { start: e, end: s } = t.range, r = `r${e.y}:${e.x}-${s.x}`;
    this.linkCache.has(r) || this.linkCache.set(r, t);
  }
  /**
   * Check if a position is within a link's range
   */
  isPositionInLink(t, e, s) {
    const { start: r, end: o } = s.range;
    return e < r.y || e > o.y ? !1 : r.y === o.y ? t >= r.x && t <= o.x : e === r.y ? t >= r.x : e === o.y ? t <= o.x : !0;
  }
  /**
   * Invalidate cache when terminal content changes
   * Should be called on terminal write, resize, or clear
   */
  invalidateCache() {
    this.linkCache.clear(), this.scannedRows.clear();
  }
  /**
   * Invalidate cache for specific rows
   * Used when only part of the terminal changed
   */
  invalidateRows(t, e) {
    for (let r = t; r <= e; r++)
      this.scannedRows.delete(r);
    const s = [];
    for (const [r, o] of this.linkCache.entries()) {
      const { start: n, end: a } = o.range;
      (n.y >= t && n.y <= e || a.y >= t && a.y <= e || n.y < t && a.y > e) && s.push(r);
    }
    for (const r of s)
      this.linkCache.delete(r);
  }
  /**
   * Dispose and cleanup
   */
  dispose() {
    var t;
    this.linkCache.clear(), this.scannedRows.clear();
    for (const e of this.providers)
      (t = e.dispose) == null || t.call(e);
    this.providers = [];
  }
}
class et {
  constructor(t) {
    this.terminal = t;
  }
  /**
   * Provide all OSC 8 links on the given row
   * Note: This may return links that span multiple rows
   */
  provideLinks(t, e) {
    const s = [], r = /* @__PURE__ */ new Set(), o = this.terminal.buffer.active.getLine(t);
    if (!o) {
      e(void 0);
      return;
    }
    for (let n = 0; n < o.length; n++) {
      if (r.has(n))
        continue;
      const a = o.getCell(n);
      if (!a || a.getHyperlinkId() === 0 || !this.terminal.wasmTerm)
        continue;
      const c = this.terminal.wasmTerm.getScrollbackLength(), u = t - c;
      let m;
      if (u < 0 ? m = this.terminal.wasmTerm.getScrollbackHyperlinkUri(t, n) : m = this.terminal.wasmTerm.getHyperlinkUri(u, n), m) {
        let g = n;
        for (let d = n + 1; d < o.length; d++) {
          const p = o.getCell(d);
          if (!p || p.getHyperlinkId() === 0 || (u < 0 ? this.terminal.wasmTerm.getScrollbackHyperlinkUri(t, d) : this.terminal.wasmTerm.getHyperlinkUri(u, d)) !== m)
            break;
          g = d;
        }
        for (let d = n; d <= g; d++)
          r.add(d);
        const w = {
          start: { x: n, y: t },
          end: { x: g, y: t }
        };
        s.push({
          text: m,
          range: w,
          activate: (d) => {
            (d.ctrlKey || d.metaKey) && window.open(m, "_blank", "noopener,noreferrer");
          }
        });
      }
    }
    e(s.length > 0 ? s : void 0);
  }
  /**
   * Find the full extent of a link by scanning for contiguous cells
   * with the same hyperlink_id. Handles multi-line links.
   */
  findLinkRange(t, e, s) {
    const r = this.terminal.buffer.active;
    let o = e, n = s;
    for (; n > 0; ) {
      const u = r.getLine(o);
      if (!u)
        break;
      const m = u.getCell(n - 1);
      if (!m || m.getHyperlinkId() !== t)
        break;
      n--;
    }
    if (n === 0 && o > 0) {
      let u = o - 1;
      for (; u >= 0; ) {
        const m = r.getLine(u);
        if (!m || m.length === 0)
          break;
        const g = m.getCell(m.length - 1);
        if (!g || g.getHyperlinkId() !== t)
          break;
        o = u, n = 0;
        for (let w = m.length - 1; w >= 0; w--) {
          const d = m.getCell(w);
          if (!d || d.getHyperlinkId() !== t) {
            n = w + 1;
            break;
          }
        }
        if (n === 0)
          u--;
        else
          break;
      }
    }
    let a = e, l = s;
    const c = r.getLine(a);
    if (c) {
      for (; l < c.length - 1; ) {
        const u = c.getCell(l + 1);
        if (!u || u.getHyperlinkId() !== t)
          break;
        l++;
      }
      if (l === c.length - 1) {
        let u = a + 1;
        const m = r.length;
        for (; u < m; ) {
          const g = r.getLine(u);
          if (!g || g.length === 0)
            break;
          const w = g.getCell(0);
          if (!w || w.getHyperlinkId() !== t)
            break;
          a = u, l = 0;
          for (let d = 0; d < g.length; d++) {
            const p = g.getCell(d);
            if (!p)
              break;
            if (p.getHyperlinkId() !== t) {
              l = d - 1;
              break;
            }
            l = d;
          }
          if (l === g.length - 1)
            u++;
          else
            break;
        }
      }
    }
    return {
      start: { x: n, y: o },
      end: { x: l, y: a }
    };
  }
  dispose() {
  }
}
const y = class R {
  constructor(t) {
    this.terminal = t;
  }
  /**
   * Provide all regex-detected URLs on the given row
   */
  provideLinks(t, e) {
    const s = [], r = this.terminal.buffer.active.getLine(t);
    if (!r) {
      e(void 0);
      return;
    }
    const o = this.lineToText(r);
    R.URL_REGEX.lastIndex = 0;
    let n = R.URL_REGEX.exec(o);
    for (; n !== null; ) {
      let a = n[0];
      const l = n.index;
      let c = n.index + a.length - 1;
      const u = a.replace(R.TRAILING_PUNCTUATION, "");
      u.length < a.length && (a = u, c = l + a.length - 1), a.length > 8 && s.push({
        text: a,
        range: {
          start: { x: l, y: t },
          end: { x: c, y: t }
        },
        activate: (m) => {
          (m.ctrlKey || m.metaKey) && window.open(a, "_blank", "noopener,noreferrer");
        }
      }), n = R.URL_REGEX.exec(o);
    }
    e(s.length > 0 ? s : void 0);
  }
  /**
   * Convert a buffer line to plain text string
   */
  lineToText(t) {
    const e = [];
    for (let s = 0; s < t.length; s++) {
      const r = t.getCell(s);
      if (!r) {
        e.push(" ");
        continue;
      }
      const o = r.getCodepoint();
      o === 0 || o < 32 ? e.push(" ") : e.push(String.fromCodePoint(o));
    }
    return e.join("");
  }
  dispose() {
  }
};
y.URL_REGEX = /(?:https?:\/\/|mailto:|ftp:\/\/|ssh:\/\/|git:\/\/|tel:|magnet:|gemini:\/\/|gopher:\/\/|news:)[\w\-.~:\/?#@!$&*+,;=%]+/gi;
y.TRAILING_PUNCTUATION = /[.,;!?)\]]+$/;
let st = y;
const O = {
  foreground: "#d4d4d4",
  background: "#1e1e1e",
  cursor: "#ffffff",
  cursorAccent: "#1e1e1e",
  // Selection colors: solid colors that replace cell bg/fg when selected
  // Using Ghostty's approach: selection bg = default fg, selection fg = default bg
  selectionBackground: "#d4d4d4",
  selectionForeground: "#1e1e1e",
  black: "#000000",
  red: "#cd3131",
  green: "#0dbc79",
  yellow: "#e5e510",
  blue: "#2472c8",
  magenta: "#bc3fbc",
  cyan: "#11a8cd",
  white: "#e5e5e5",
  brightBlack: "#666666",
  brightRed: "#f14c4c",
  brightGreen: "#23d18b",
  brightYellow: "#f5f543",
  brightBlue: "#3b8eea",
  brightMagenta: "#d670d6",
  brightCyan: "#29b8db",
  brightWhite: "#ffffff"
};
class it {
  constructor(t, e = {}) {
    this.cursorVisible = !0, this.lastCursorPosition = { x: 0, y: 0 }, this.lastViewportY = 0, this.currentBuffer = null, this.currentSelectionCoords = null, this.hoveredHyperlinkId = 0, this.previousHoveredHyperlinkId = 0, this.hoveredLinkRange = null, this.previousHoveredLinkRange = null, this.canvas = t;
    const s = t.getContext("2d", { alpha: !0 });
    if (!s)
      throw new Error("Failed to get 2D rendering context");
    this.ctx = s, this.fontSize = e.fontSize ?? 15, this.fontFamily = e.fontFamily ?? "monospace", this.cursorStyle = e.cursorStyle ?? "block", this.cursorBlink = e.cursorBlink ?? !1, this.theme = { ...O, ...e.theme }, this.devicePixelRatio = e.devicePixelRatio ?? window.devicePixelRatio ?? 1, this.palette = [
      this.theme.black,
      this.theme.red,
      this.theme.green,
      this.theme.yellow,
      this.theme.blue,
      this.theme.magenta,
      this.theme.cyan,
      this.theme.white,
      this.theme.brightBlack,
      this.theme.brightRed,
      this.theme.brightGreen,
      this.theme.brightYellow,
      this.theme.brightBlue,
      this.theme.brightMagenta,
      this.theme.brightCyan,
      this.theme.brightWhite
    ], this.metrics = this.measureFont(), this.cursorBlink && this.startCursorBlink();
  }
  // ==========================================================================
  // Font Metrics Measurement
  // ==========================================================================
  measureFont() {
    const e = document.createElement("canvas").getContext("2d");
    e.font = `${this.fontSize}px ${this.fontFamily}`;
    const s = e.measureText("M"), r = Math.ceil(s.width), o = s.actualBoundingBoxAscent || this.fontSize * 0.8, n = s.actualBoundingBoxDescent || this.fontSize * 0.2, a = Math.ceil(o + n) + 2, l = Math.ceil(o) + 1;
    return { width: r, height: a, baseline: l };
  }
  /**
   * Remeasure font metrics (call after font loads or changes)
   */
  remeasureFont() {
    this.metrics = this.measureFont();
  }
  // ==========================================================================
  // Color Conversion
  // ==========================================================================
  rgbToCSS(t, e, s) {
    return `rgb(${t}, ${e}, ${s})`;
  }
  // ==========================================================================
  // Canvas Sizing
  // ==========================================================================
  /**
   * Resize canvas to fit terminal dimensions
   */
  resize(t, e) {
    const s = t * this.metrics.width, r = e * this.metrics.height;
    this.canvas.style.width = `${s}px`, this.canvas.style.height = `${r}px`, this.canvas.width = s * this.devicePixelRatio, this.canvas.height = r * this.devicePixelRatio, this.ctx.scale(this.devicePixelRatio, this.devicePixelRatio), this.ctx.textBaseline = "alphabetic", this.ctx.textAlign = "left", this.ctx.fillStyle = this.theme.background, this.ctx.fillRect(0, 0, s, r);
  }
  // ==========================================================================
  // Main Rendering
  // ==========================================================================
  /**
   * Render the terminal buffer to canvas
   */
  render(t, e = !1, s = 0, r, o = 1) {
    var v;
    this.currentBuffer = t;
    const n = t.getCursor(), a = t.getDimensions(), l = r ? r.getScrollbackLength() : 0;
    (v = t.needsFullRedraw) != null && v.call(t) && (e = !0), (this.canvas.width !== a.cols * this.metrics.width * this.devicePixelRatio || this.canvas.height !== a.rows * this.metrics.height * this.devicePixelRatio) && (this.resize(a.cols, a.rows), e = !0), s !== this.lastViewportY && (e = !0, this.lastViewportY = s);
    const u = n.x !== this.lastCursorPosition.x || n.y !== this.lastCursorPosition.y;
    if (u || this.cursorBlink) {
      if (!e && !t.isRowDirty(n.y)) {
        const f = t.getLine(n.y);
        f && this.renderLine(f, n.y, a.cols);
      }
      if (u && this.lastCursorPosition.y !== n.y && !e && !t.isRowDirty(this.lastCursorPosition.y)) {
        const f = t.getLine(this.lastCursorPosition.y);
        f && this.renderLine(f, this.lastCursorPosition.y, a.cols);
      }
    }
    const m = this.selectionManager && this.selectionManager.hasSelection(), g = /* @__PURE__ */ new Set();
    if (this.currentSelectionCoords = m ? this.selectionManager.getSelectionCoords() : null, this.currentSelectionCoords) {
      const f = this.currentSelectionCoords;
      for (let b = f.startRow; b <= f.endRow; b++)
        g.add(b);
    }
    if (this.selectionManager) {
      const f = this.selectionManager.getDirtySelectionRows();
      if (f.size > 0) {
        for (const b of f)
          g.add(b);
        this.selectionManager.clearDirtySelectionRows();
      }
    }
    const w = /* @__PURE__ */ new Set(), d = this.hoveredHyperlinkId !== this.previousHoveredHyperlinkId, p = JSON.stringify(this.hoveredLinkRange) !== JSON.stringify(this.previousHoveredLinkRange);
    if (d) {
      for (let f = 0; f < a.rows; f++) {
        let b = null;
        if (s > 0)
          if (f < s && r) {
            const S = l - Math.floor(s) + f;
            b = r.getScrollbackLine(S);
          } else {
            const S = f - Math.floor(s);
            b = t.getLine(S);
          }
        else
          b = t.getLine(f);
        if (b) {
          for (const S of b)
            if (S.hyperlink_id === this.hoveredHyperlinkId || S.hyperlink_id === this.previousHoveredHyperlinkId) {
              w.add(f);
              break;
            }
        }
      }
      this.previousHoveredHyperlinkId = this.hoveredHyperlinkId;
    }
    if (p) {
      if (this.previousHoveredLinkRange)
        for (let f = this.previousHoveredLinkRange.startY; f <= this.previousHoveredLinkRange.endY; f++)
          w.add(f);
      if (this.hoveredLinkRange)
        for (let f = this.hoveredLinkRange.startY; f <= this.hoveredLinkRange.endY; f++)
          w.add(f);
      this.previousHoveredLinkRange = this.hoveredLinkRange;
    }
    const _ = /* @__PURE__ */ new Set();
    for (let f = 0; f < a.rows; f++)
      (s > 0 ? !0 : e || t.isRowDirty(f) || g.has(f) || w.has(f)) && (_.add(f), f > 0 && _.add(f - 1), f < a.rows - 1 && _.add(f + 1));
    for (let f = 0; f < a.rows; f++) {
      if (!_.has(f))
        continue;
      let b = null;
      if (s > 0)
        if (f < s && r) {
          const S = l - Math.floor(s) + f;
          b = r.getScrollbackLine(S);
        } else {
          const S = s > 0 ? f - Math.floor(s) : f;
          b = t.getLine(S);
        }
      else
        b = t.getLine(f);
      b && this.renderLine(b, f, a.cols);
    }
    s === 0 && n.visible && this.cursorVisible && this.renderCursor(n.x, n.y), r && o > 0 && this.renderScrollbar(s, l, a.rows, o), this.lastCursorPosition = { x: n.x, y: n.y }, t.clearDirty();
  }
  /**
   * Render a single line using two-pass approach:
   * 1. First pass: Draw all cell backgrounds
   * 2. Second pass: Draw all cell text and decorations
   *
   * This two-pass approach is necessary for proper rendering of complex scripts
   * like Devanagari where diacritics (like vowel sign ि) can extend LEFT of the
   * base character into the previous cell's visual area. If we draw backgrounds
   * and text in a single pass (cell by cell), the background of cell N would
   * cover any left-extending portions of graphemes from cell N-1.
   */
  renderLine(t, e, s) {
    const r = e * this.metrics.height, o = s * this.metrics.width;
    this.ctx.clearRect(0, r, o, this.metrics.height), this.ctx.fillStyle = this.theme.background, this.ctx.fillRect(0, r, o, this.metrics.height);
    for (let n = 0; n < t.length; n++) {
      const a = t[n];
      a.width !== 0 && this.renderCellBackground(a, n, e);
    }
    for (let n = 0; n < t.length; n++) {
      const a = t[n];
      a.width !== 0 && this.renderCellText(a, n, e);
    }
  }
  /**
   * Render a cell's background only (Pass 1 of two-pass rendering)
   * Selection highlighting is integrated here to avoid z-order issues with
   * complex glyphs (like Devanagari) that extend outside their cell bounds.
   */
  renderCellBackground(t, e, s) {
    const r = e * this.metrics.width, o = s * this.metrics.height, n = this.metrics.width * t.width;
    if (this.isInSelection(e, s)) {
      this.ctx.fillStyle = this.theme.selectionBackground, this.ctx.fillRect(r, o, n, this.metrics.height);
      return;
    }
    let l = t.bg_r, c = t.bg_g, u = t.bg_b;
    t.flags & E.INVERSE && (l = t.fg_r, c = t.fg_g, u = t.fg_b), l === 0 && c === 0 && u === 0 || (this.ctx.fillStyle = this.rgbToCSS(l, c, u), this.ctx.fillRect(r, o, n, this.metrics.height));
  }
  /**
   * Render a cell's text and decorations (Pass 2 of two-pass rendering)
   * Selection foreground color is applied here to match the selection background.
   */
  renderCellText(t, e, s, r) {
    var w;
    const o = e * this.metrics.width, n = s * this.metrics.height, a = this.metrics.width * t.width;
    if (t.flags & E.INVISIBLE)
      return;
    const l = this.isInSelection(e, s);
    let c = "";
    if (t.flags & E.ITALIC && (c += "italic "), t.flags & E.BOLD && (c += "bold "), this.ctx.font = `${c}${this.fontSize}px ${this.fontFamily}`, r)
      this.ctx.fillStyle = r;
    else if (l)
      this.ctx.fillStyle = this.theme.selectionForeground;
    else {
      let d = t.fg_r, p = t.fg_g, _ = t.fg_b;
      t.flags & E.INVERSE && (d = t.bg_r, p = t.bg_g, _ = t.bg_b), this.ctx.fillStyle = this.rgbToCSS(d, p, _);
    }
    t.flags & E.FAINT && (this.ctx.globalAlpha = 0.5);
    const u = o, m = n + this.metrics.baseline;
    let g;
    if (t.grapheme_len > 0 && ((w = this.currentBuffer) != null && w.getGraphemeString) ? g = this.currentBuffer.getGraphemeString(s, e) : g = String.fromCodePoint(t.codepoint || 32), this.ctx.fillText(g, u, m), t.flags & E.FAINT && (this.ctx.globalAlpha = 1), t.flags & E.UNDERLINE) {
      const d = n + this.metrics.baseline + 2;
      this.ctx.strokeStyle = this.ctx.fillStyle, this.ctx.lineWidth = 1, this.ctx.beginPath(), this.ctx.moveTo(o, d), this.ctx.lineTo(o + a, d), this.ctx.stroke();
    }
    if (t.flags & E.STRIKETHROUGH) {
      const d = n + this.metrics.height / 2;
      this.ctx.strokeStyle = this.ctx.fillStyle, this.ctx.lineWidth = 1, this.ctx.beginPath(), this.ctx.moveTo(o, d), this.ctx.lineTo(o + a, d), this.ctx.stroke();
    }
    if (t.hyperlink_id > 0 && t.hyperlink_id === this.hoveredHyperlinkId) {
      const p = n + this.metrics.baseline + 2;
      this.ctx.strokeStyle = "#4A90E2", this.ctx.lineWidth = 1, this.ctx.beginPath(), this.ctx.moveTo(o, p), this.ctx.lineTo(o + a, p), this.ctx.stroke();
    }
    if (this.hoveredLinkRange) {
      const d = this.hoveredLinkRange;
      if (s === d.startY && e >= d.startX && (s < d.endY || e <= d.endX) || s > d.startY && s < d.endY || s === d.endY && e <= d.endX && (s > d.startY || e >= d.startX)) {
        const _ = n + this.metrics.baseline + 2;
        this.ctx.strokeStyle = "#4A90E2", this.ctx.lineWidth = 1, this.ctx.beginPath(), this.ctx.moveTo(o, _), this.ctx.lineTo(o + a, _), this.ctx.stroke();
      }
    }
  }
  /**
   * Render cursor
   */
  renderCursor(t, e) {
    var o;
    const s = t * this.metrics.width, r = e * this.metrics.height;
    switch (this.ctx.fillStyle = this.theme.cursor, this.cursorStyle) {
      case "block":
        this.ctx.fillRect(s, r, this.metrics.width, this.metrics.height);
        {
          const l = (o = this.currentBuffer) == null ? void 0 : o.getLine(e);
          l != null && l[t] && (this.ctx.save(), this.ctx.beginPath(), this.ctx.rect(s, r, this.metrics.width, this.metrics.height), this.ctx.clip(), this.renderCellText(l[t], t, e, this.theme.cursorAccent), this.ctx.restore());
        }
        break;
      case "underline":
        const n = Math.max(2, Math.floor(this.metrics.height * 0.15));
        this.ctx.fillRect(
          s,
          r + this.metrics.height - n,
          this.metrics.width,
          n
        );
        break;
      case "bar":
        const a = Math.max(2, Math.floor(this.metrics.width * 0.15));
        this.ctx.fillRect(s, r, a, this.metrics.height);
        break;
    }
  }
  // ==========================================================================
  // Cursor Blinking
  // ==========================================================================
  startCursorBlink() {
    this.cursorBlinkInterval = window.setInterval(() => {
      this.cursorVisible = !this.cursorVisible;
    }, 530);
  }
  stopCursorBlink() {
    this.cursorBlinkInterval !== void 0 && (clearInterval(this.cursorBlinkInterval), this.cursorBlinkInterval = void 0), this.cursorVisible = !0;
  }
  // ==========================================================================
  // Public API
  // ==========================================================================
  /**
   * Update theme colors
   */
  setTheme(t) {
    this.theme = { ...O, ...t }, this.palette = [
      this.theme.black,
      this.theme.red,
      this.theme.green,
      this.theme.yellow,
      this.theme.blue,
      this.theme.magenta,
      this.theme.cyan,
      this.theme.white,
      this.theme.brightBlack,
      this.theme.brightRed,
      this.theme.brightGreen,
      this.theme.brightYellow,
      this.theme.brightBlue,
      this.theme.brightMagenta,
      this.theme.brightCyan,
      this.theme.brightWhite
    ];
  }
  /**
   * Update font size
   */
  setFontSize(t) {
    this.fontSize = t, this.metrics = this.measureFont();
  }
  /**
   * Update font family
   */
  setFontFamily(t) {
    this.fontFamily = t, this.metrics = this.measureFont();
  }
  /**
   * Update cursor style
   */
  setCursorStyle(t) {
    this.cursorStyle = t;
  }
  /**
   * Enable/disable cursor blinking
   */
  setCursorBlink(t) {
    t && !this.cursorBlink ? (this.cursorBlink = !0, this.startCursorBlink()) : !t && this.cursorBlink && (this.cursorBlink = !1, this.stopCursorBlink());
  }
  /**
   * Get current font metrics
   */
  /**
   * Render scrollbar (Phase 2)
   * Shows scroll position and allows click/drag interaction
   * @param opacity Opacity level (0-1) for fade in/out effect
   */
  renderScrollbar(t, e, s, r = 1) {
    const o = this.ctx, n = this.canvas.height / this.devicePixelRatio, a = this.canvas.width / this.devicePixelRatio, l = 8, c = a - l - 4, u = 4, m = n - u * 2;
    if (o.clearRect(c - 2, 0, l + 6, n), o.fillStyle = this.theme.background, o.fillRect(c - 2, 0, l + 6, n), r <= 0 || e === 0)
      return;
    const g = e + s, w = Math.max(20, s / g * m), d = t / e, p = u + (m - w) * (1 - d);
    o.fillStyle = `rgba(128, 128, 128, ${0.1 * r})`, o.fillRect(c, u, l, m);
    const v = t > 0 ? 0.5 : 0.3;
    o.fillStyle = `rgba(128, 128, 128, ${v * r})`, o.fillRect(c, p, l, w);
  }
  getMetrics() {
    return { ...this.metrics };
  }
  /**
   * Get canvas element (needed by SelectionManager)
   */
  getCanvas() {
    return this.canvas;
  }
  /**
   * Set selection manager (for rendering selection)
   */
  setSelectionManager(t) {
    this.selectionManager = t;
  }
  /**
   * Check if a cell at (x, y) is within the current selection.
   * Uses cached selection coordinates for performance.
   */
  isInSelection(t, e) {
    const s = this.currentSelectionCoords;
    if (!s)
      return !1;
    const { startCol: r, startRow: o, endCol: n, endRow: a } = s;
    return o === a ? e === o && t >= r && t <= n : e === o ? t >= r : e === a ? t <= n : e > o && e < a;
  }
  /**
   * Set the currently hovered hyperlink ID for rendering underlines
   */
  setHoveredHyperlinkId(t) {
    this.hoveredHyperlinkId = t;
  }
  /**
   * Set the currently hovered link range for rendering underlines (for regex-detected URLs)
   * Pass null to clear the hover state
   */
  setHoveredLinkRange(t) {
    this.hoveredLinkRange = t;
  }
  /**
   * Get character cell width (for coordinate conversion)
   */
  get charWidth() {
    return this.metrics.width;
  }
  /**
   * Get character cell height (for coordinate conversion)
   */
  get charHeight() {
    return this.metrics.height;
  }
  /**
   * Clear entire canvas
   */
  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height), this.ctx.fillStyle = this.theme.background, this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }
  /**
   * Cleanup resources
   */
  dispose() {
    this.stopCursorBlink();
  }
}
const A = class M {
  // ms between scroll steps
  constructor(t, e, s, r) {
    this.selectionStart = null, this.selectionEnd = null, this.isSelecting = !1, this.mouseDownX = 0, this.mouseDownY = 0, this.dragThresholdMet = !1, this.mouseDownTarget = null, this.dirtySelectionRows = /* @__PURE__ */ new Set(), this.selectionChangedEmitter = new T(), this.boundMouseUpHandler = null, this.boundContextMenuHandler = null, this.boundClickHandler = null, this.boundDocumentMouseMoveHandler = null, this.autoScrollInterval = null, this.autoScrollDirection = 0, this.terminal = t, this.renderer = e, this.wasmTerm = s, this.textarea = r, this.attachEventListeners();
  }
  // pixels from edge to trigger scroll
  /**
   * Get current viewport Y position (how many lines scrolled into history)
   */
  getViewportY() {
    const t = typeof this.terminal.getViewportY == "function" ? this.terminal.getViewportY() : this.terminal.viewportY || 0;
    return Math.max(0, Math.floor(t));
  }
  /**
   * Convert viewport row to absolute buffer row
   * Absolute row is an index into combined buffer: scrollback (0 to len-1) + screen (len to len+rows-1)
   */
  viewportRowToAbsolute(t) {
    const e = this.wasmTerm.getScrollbackLength(), s = this.getViewportY();
    return e + t - s;
  }
  /**
   * Convert absolute buffer row to viewport row (may be outside visible range)
   */
  absoluteRowToViewport(t) {
    const e = this.wasmTerm.getScrollbackLength(), s = this.getViewportY();
    return t - e + s;
  }
  // ==========================================================================
  // Public API
  // ==========================================================================
  /**
   * Get the selected text as a string
   */
  getSelection() {
    if (!this.selectionStart || !this.selectionEnd)
      return "";
    let { col: t, absoluteRow: e } = this.selectionStart, { col: s, absoluteRow: r } = this.selectionEnd;
    (e > r || e === r && t > s) && ([t, s] = [s, t], [e, r] = [r, e]);
    const o = this.wasmTerm.getScrollbackLength();
    let n = "";
    for (let a = e; a <= r; a++) {
      let l = null;
      if (a < o)
        l = this.wasmTerm.getScrollbackLine(a);
      else {
        const w = a - o;
        l = this.wasmTerm.getLine(w);
      }
      if (!l)
        continue;
      let c = -1;
      const u = a === e ? t : 0, m = a === r ? s : l.length - 1;
      let g = "";
      for (let w = u; w <= m; w++) {
        const d = l[w];
        if (d && d.codepoint !== 0) {
          let p;
          if (d.grapheme_len > 0)
            if (a < o)
              p = this.wasmTerm.getScrollbackGraphemeString(a, w);
            else {
              const _ = a - o;
              p = this.wasmTerm.getGraphemeString(_, w);
            }
          else
            p = String.fromCodePoint(d.codepoint);
          g += p, p.trim() && (c = g.length);
        } else
          g += " ";
      }
      c >= 0 ? g = g.substring(0, c) : g = "", n += g, a < r && (n += `
`);
    }
    return n;
  }
  /**
   * Check if there's an active selection
   */
  hasSelection() {
    return !(!this.selectionStart || !this.selectionEnd || this.isSelecting && !this.dragThresholdMet);
  }
  /**
   * Copy the current selection to clipboard
   * @returns true if there was text to copy, false otherwise
   */
  copySelection() {
    if (!this.hasSelection())
      return !1;
    const t = this.getSelection();
    return t ? (this.copyToClipboard(t), !0) : !1;
  }
  /**
   * Clear the selection
   */
  clearSelection() {
    if (!this.hasSelection())
      return;
    const t = this.normalizeSelection();
    if (t)
      for (let e = t.startRow; e <= t.endRow; e++)
        this.dirtySelectionRows.add(e);
    this.selectionStart = null, this.selectionEnd = null, this.isSelecting = !1, this.requestRender();
  }
  /**
   * Select all text in the terminal
   */
  selectAll() {
    const t = this.wasmTerm.getDimensions(), e = this.getViewportY();
    this.selectionStart = { col: 0, absoluteRow: e }, this.selectionEnd = { col: t.cols - 1, absoluteRow: e + t.rows - 1 }, this.requestRender(), this.selectionChangedEmitter.fire();
  }
  /**
   * Select text at specific column and row with length
   * xterm.js compatible API
   */
  select(t, e, s) {
    const r = this.wasmTerm.getDimensions();
    e = Math.max(0, Math.min(e, r.rows - 1)), t = Math.max(0, Math.min(t, r.cols - 1));
    let o = e, n = t + s - 1;
    for (; n >= r.cols; )
      n -= r.cols, o++;
    o = Math.min(o, r.rows - 1);
    const a = this.getViewportY();
    this.selectionStart = { col: t, absoluteRow: a + e }, this.selectionEnd = { col: n, absoluteRow: a + o }, this.requestRender(), this.selectionChangedEmitter.fire();
  }
  /**
   * Select entire lines from start to end
   * xterm.js compatible API
   */
  selectLines(t, e) {
    const s = this.wasmTerm.getDimensions();
    t = Math.max(0, Math.min(t, s.rows - 1)), e = Math.max(0, Math.min(e, s.rows - 1)), t > e && ([t, e] = [e, t]), this.selectionStart = { col: 0, absoluteRow: this.viewportRowToAbsolute(t) }, this.selectionEnd = { col: s.cols - 1, absoluteRow: this.viewportRowToAbsolute(e) }, this.requestRender(), this.selectionChangedEmitter.fire();
  }
  /**
   * Get selection position as buffer range
   * xterm.js compatible API
   */
  getSelectionPosition() {
    const t = this.normalizeSelection();
    if (t)
      return {
        start: { x: t.startCol, y: t.startRow },
        end: { x: t.endCol, y: t.endRow }
      };
  }
  /**
   * Deselect all text
   * xterm.js compatible API
   */
  deselect() {
    this.clearSelection(), this.selectionChangedEmitter.fire();
  }
  /**
   * Focus the terminal (make it receive keyboard input)
   */
  focus() {
    const t = this.renderer.getCanvas();
    t.parentElement && t.parentElement.focus();
  }
  /**
   * Get current selection coordinates (for rendering)
   */
  getSelectionCoords() {
    return this.normalizeSelection();
  }
  /**
   * Get dirty selection rows that need redraw (for clearing old highlight)
   */
  getDirtySelectionRows() {
    return this.dirtySelectionRows;
  }
  /**
   * Clear the dirty selection rows tracking (after redraw)
   */
  clearDirtySelectionRows() {
    this.dirtySelectionRows.clear();
  }
  /**
   * Get selection change event accessor
   */
  get onSelectionChange() {
    return this.selectionChangedEmitter.event;
  }
  /**
   * Cleanup resources
   */
  dispose() {
    this.selectionChangedEmitter.dispose(), this.stopAutoScroll(), this.boundMouseUpHandler && (document.removeEventListener("mouseup", this.boundMouseUpHandler), this.boundMouseUpHandler = null), this.boundDocumentMouseMoveHandler && (document.removeEventListener("mousemove", this.boundDocumentMouseMoveHandler), this.boundDocumentMouseMoveHandler = null), this.boundContextMenuHandler && (this.renderer.getCanvas().removeEventListener("contextmenu", this.boundContextMenuHandler), this.boundContextMenuHandler = null), this.boundClickHandler && (document.removeEventListener("click", this.boundClickHandler), this.boundClickHandler = null);
  }
  // ==========================================================================
  // Private Methods
  // ==========================================================================
  /**
   * Attach mouse event listeners to canvas
   */
  attachEventListeners() {
    const t = this.renderer.getCanvas();
    t.addEventListener("mousedown", (e) => {
      if (e.button === 0) {
        t.parentElement && t.parentElement.focus();
        const s = this.pixelToCell(e.offsetX, e.offsetY);
        this.hasSelection() && this.clearSelection();
        const o = this.viewportRowToAbsolute(s.row);
        this.selectionStart = { col: s.col, absoluteRow: o }, this.selectionEnd = { col: s.col, absoluteRow: o }, this.isSelecting = !0, this.mouseDownX = e.offsetX, this.mouseDownY = e.offsetY, this.dragThresholdMet = !1;
      }
    }), t.addEventListener("mousemove", (e) => {
      if (this.isSelecting) {
        if (!this.dragThresholdMet) {
          const o = e.offsetX - this.mouseDownX, n = e.offsetY - this.mouseDownY, a = this.renderer.getMetrics().width * 0.5;
          if (o * o + n * n < a * a)
            return;
          this.dragThresholdMet = !0;
        }
        this.markCurrentSelectionDirty();
        const s = this.pixelToCell(e.offsetX, e.offsetY), r = this.viewportRowToAbsolute(s.row);
        this.selectionEnd = { col: s.col, absoluteRow: r }, this.requestRender(), this.updateAutoScroll(e.offsetY, t.clientHeight);
      }
    }), t.addEventListener("mouseleave", (e) => {
      if (this.isSelecting) {
        const s = t.getBoundingClientRect();
        e.clientY < s.top ? this.startAutoScroll(-1) : e.clientY > s.bottom && this.startAutoScroll(1);
      }
    }), t.addEventListener("mouseenter", () => {
      this.isSelecting && this.stopAutoScroll();
    }), this.boundDocumentMouseMoveHandler = (e) => {
      if (this.isSelecting) {
        if (!this.dragThresholdMet) {
          const l = e.clientX - (t.getBoundingClientRect().left + this.mouseDownX), c = e.clientY - (t.getBoundingClientRect().top + this.mouseDownY), u = this.renderer.getMetrics().width * 0.5;
          if (l * l + c * c < u * u)
            return;
          this.dragThresholdMet = !0;
        }
        const s = t.getBoundingClientRect(), r = Math.max(s.left, Math.min(e.clientX, s.right)), o = Math.max(s.top, Math.min(e.clientY, s.bottom)), n = r - s.left, a = o - s.top;
        if ((e.clientX < s.left || e.clientX > s.right || e.clientY < s.top || e.clientY > s.bottom) && (e.clientY < s.top ? this.startAutoScroll(-1) : e.clientY > s.bottom ? this.startAutoScroll(1) : this.stopAutoScroll(), this.autoScrollDirection === 0)) {
          this.markCurrentSelectionDirty();
          const l = this.pixelToCell(n, a), c = this.viewportRowToAbsolute(l.row);
          this.selectionEnd = { col: l.col, absoluteRow: c }, this.requestRender();
        }
      }
    }, document.addEventListener("mousemove", this.boundDocumentMouseMoveHandler), document.addEventListener("mousedown", (e) => {
      this.mouseDownTarget = e.target;
    }), this.boundMouseUpHandler = (e) => {
      if (this.isSelecting) {
        if (this.isSelecting = !1, this.stopAutoScroll(), !this.dragThresholdMet) {
          this.clearSelection();
          return;
        }
        if (this.hasSelection()) {
          const s = this.getSelection();
          s && (this.copyToClipboard(s), this.selectionChangedEmitter.fire());
        }
      }
    }, document.addEventListener("mouseup", this.boundMouseUpHandler), t.addEventListener("click", (e) => {
      if (e.detail === 2) {
        const s = this.pixelToCell(e.offsetX, e.offsetY), r = this.getWordAtCell(s.col, s.row);
        if (r) {
          const o = this.viewportRowToAbsolute(s.row);
          this.selectionStart = { col: r.startCol, absoluteRow: o }, this.selectionEnd = { col: r.endCol, absoluteRow: o }, this.requestRender();
          const n = this.getSelection();
          n && (this.copyToClipboard(n), this.selectionChangedEmitter.fire());
        }
      } else if (e.detail >= 3) {
        const s = this.pixelToCell(e.offsetX, e.offsetY), r = this.viewportRowToAbsolute(s.row), o = this.wasmTerm.getScrollbackLength();
        let n = null;
        if (r < o)
          n = this.wasmTerm.getScrollbackLine(r);
        else {
          const l = r - o;
          n = this.wasmTerm.getLine(l);
        }
        let a = -1;
        if (n) {
          for (let l = n.length - 1; l >= 0; l--)
            if (n[l] && n[l].codepoint !== 0 && n[l].codepoint !== 32) {
              a = l;
              break;
            }
        }
        if (a >= 0) {
          this.selectionStart = { col: 0, absoluteRow: r }, this.selectionEnd = { col: a, absoluteRow: r }, this.requestRender();
          const l = this.getSelection();
          l && (this.copyToClipboard(l), this.selectionChangedEmitter.fire());
        }
      }
    }), this.boundContextMenuHandler = (e) => {
      if (this.renderer.getCanvas().getBoundingClientRect(), this.textarea.style.position = "fixed", this.textarea.style.left = `${e.clientX}px`, this.textarea.style.top = `${e.clientY}px`, this.textarea.style.width = "1px", this.textarea.style.height = "1px", this.textarea.style.zIndex = "1000", this.textarea.style.opacity = "0", this.textarea.style.pointerEvents = "auto", this.hasSelection()) {
        const r = this.getSelection();
        this.textarea.value = r, this.textarea.select(), this.textarea.setSelectionRange(0, r.length);
      } else
        this.textarea.value = "";
      this.textarea.focus(), setTimeout(() => {
        const r = () => {
          this.textarea.style.pointerEvents = "none", this.textarea.style.zIndex = "-10", this.textarea.style.width = "0", this.textarea.style.height = "0", this.textarea.style.left = "0", this.textarea.style.top = "0", this.textarea.value = "", document.removeEventListener("click", r), document.removeEventListener("contextmenu", r), this.textarea.removeEventListener("blur", r);
        };
        document.addEventListener("click", r, { once: !0 }), document.addEventListener("contextmenu", r, { once: !0 }), this.textarea.addEventListener("blur", r, { once: !0 });
      }, 10);
    }, t.addEventListener("contextmenu", this.boundContextMenuHandler), this.boundClickHandler = (e) => {
      if (this.isSelecting || this.mouseDownTarget && t.contains(this.mouseDownTarget))
        return;
      const r = e.target;
      t.contains(r) || this.hasSelection() && this.clearSelection();
    }, document.addEventListener("click", this.boundClickHandler);
  }
  /**
   * Mark current selection rows as dirty for redraw
   */
  markCurrentSelectionDirty() {
    const t = this.normalizeSelection();
    if (t)
      for (let e = t.startRow; e <= t.endRow; e++)
        this.dirtySelectionRows.add(e);
  }
  /**
   * Update auto-scroll based on mouse Y position within canvas
   */
  updateAutoScroll(t, e) {
    const s = M.AUTO_SCROLL_EDGE_SIZE;
    t < s ? this.startAutoScroll(-1) : t > e - s ? this.startAutoScroll(1) : this.stopAutoScroll();
  }
  /**
   * Start auto-scrolling in the given direction
   */
  startAutoScroll(t) {
    this.autoScrollInterval !== null && this.autoScrollDirection === t || (this.stopAutoScroll(), this.autoScrollDirection = t, this.autoScrollInterval = setInterval(() => {
      if (!this.isSelecting) {
        this.stopAutoScroll();
        return;
      }
      const e = M.AUTO_SCROLL_SPEED * this.autoScrollDirection;
      if (this.terminal.scrollLines(e), this.selectionEnd) {
        const s = this.wasmTerm.getDimensions();
        if (this.autoScrollDirection < 0) {
          const r = this.viewportRowToAbsolute(0);
          r < this.selectionEnd.absoluteRow && (this.selectionEnd = { col: 0, absoluteRow: r });
        } else {
          const r = this.viewportRowToAbsolute(s.rows - 1);
          r > this.selectionEnd.absoluteRow && (this.selectionEnd = { col: s.cols - 1, absoluteRow: r });
        }
      }
      this.requestRender();
    }, M.AUTO_SCROLL_INTERVAL));
  }
  /**
   * Stop auto-scrolling
   */
  stopAutoScroll() {
    this.autoScrollInterval !== null && (clearInterval(this.autoScrollInterval), this.autoScrollInterval = null), this.autoScrollDirection = 0;
  }
  /**
   * Convert pixel coordinates to terminal cell coordinates
   */
  pixelToCell(t, e) {
    const s = this.renderer.getMetrics(), r = Math.floor(t / s.width), o = Math.floor(e / s.height);
    return {
      col: Math.max(0, Math.min(r, this.terminal.cols - 1)),
      row: Math.max(0, Math.min(o, this.terminal.rows - 1))
    };
  }
  /**
   * Normalize selection coordinates (handle backward selection)
   * Returns coordinates in VIEWPORT space for rendering, clamped to visible area
   */
  normalizeSelection() {
    if (!this.selectionStart || !this.selectionEnd)
      return null;
    let { col: t, absoluteRow: e } = this.selectionStart, { col: s, absoluteRow: r } = this.selectionEnd;
    (e > r || e === r && t > s) && ([t, s] = [s, t], [e, r] = [r, e]);
    let o = this.absoluteRowToViewport(e), n = this.absoluteRowToViewport(r);
    const a = this.wasmTerm.getDimensions(), l = a.rows - 1;
    return n < 0 || o > l ? null : (o < 0 && (o = 0, t = 0), n > l && (n = l, s = a.cols - 1), { startCol: t, startRow: o, endCol: s, endRow: n });
  }
  /**
   * Get word boundaries at a cell position
   */
  getWordAtCell(t, e) {
    const s = this.viewportRowToAbsolute(e), r = this.wasmTerm.getScrollbackLength();
    let o;
    if (s < r)
      o = this.wasmTerm.getScrollbackLine(s);
    else {
      const c = s - r;
      o = this.wasmTerm.getLine(c);
    }
    if (!o)
      return null;
    const n = (c) => {
      if (!c || c.codepoint === 0)
        return !1;
      const u = String.fromCodePoint(c.codepoint);
      return /[\w\-./~@+]/.test(u);
    };
    if (!n(o[t]))
      return null;
    let a = t;
    for (; a > 0 && n(o[a - 1]); )
      a--;
    let l = t;
    for (; l < o.length - 1 && n(o[l + 1]); )
      l++;
    return { startCol: a, endCol: l };
  }
  /**
   * Copy text to clipboard
   *
   * Strategy (modern APIs first):
   * 1. Try ClipboardItem API (works in Safari and modern browsers)
   *    - Safari requires the ClipboardItem to be created synchronously within user gesture
   * 2. Try navigator.clipboard.writeText (modern async API, may fail in Safari)
   * 3. Fall back to execCommand (legacy, for older browsers)
   */
  copyToClipboard(t) {
    if (navigator.clipboard && typeof ClipboardItem < "u")
      try {
        const e = new Blob([t], { type: "text/plain" }), s = new ClipboardItem({
          "text/plain": e
        });
        navigator.clipboard.write([s]).catch((r) => {
          console.warn("ClipboardItem write failed, trying writeText:", r), this.copyWithWriteText(t);
        });
        return;
      } catch {
      }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).catch((e) => {
        console.warn("Clipboard writeText failed, trying execCommand:", e), this.copyWithExecCommand(t);
      });
      return;
    }
    this.copyWithExecCommand(t);
  }
  /**
   * Copy using navigator.clipboard.writeText
   */
  copyWithWriteText(t) {
    navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(t).catch((e) => {
      console.warn("Clipboard writeText failed, trying execCommand:", e), this.copyWithExecCommand(t);
    }) : this.copyWithExecCommand(t);
  }
  /**
   * Copy using legacy execCommand (fallback for older browsers)
   */
  copyWithExecCommand(t) {
    const e = document.activeElement;
    try {
      const s = this.textarea;
      s.value = t, s.style.position = "fixed", s.style.left = "-9999px", s.style.top = "0", s.style.width = "1px", s.style.height = "1px", s.style.opacity = "0", s.focus(), s.select(), s.setSelectionRange(0, t.length);
      const r = document.execCommand("copy");
      e && e.focus(), r || console.warn("execCommand copy failed");
    } catch (s) {
      console.warn("execCommand copy threw:", s), e && e.focus();
    }
  }
  /**
   * Request a render update (triggers selection overlay redraw)
   */
  requestRender() {
  }
};
A.AUTO_SCROLL_EDGE_SIZE = 30;
A.AUTO_SCROLL_SPEED = 3;
A.AUTO_SCROLL_INTERVAL = 50;
let rt = A;
function V(i, t) {
  const e = String(i || "").trim();
  if (!e)
    return t;
  if (e.startsWith("#")) {
    const r = e.slice(1), o = r.length === 3 ? r.split("").map((n) => n + n).join("") : r;
    if (/^[0-9a-fA-F]{6}$/.test(o)) {
      const n = Number.parseInt(o, 16);
      return {
        r: n >> 16 & 255,
        g: n >> 8 & 255,
        b: n & 255
      };
    }
  }
  const s = e.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  return s ? {
    r: Number.parseInt(s[1], 10),
    g: Number.parseInt(s[2], 10),
    b: Number.parseInt(s[3], 10)
  } : t;
}
function ot(i, t, e) {
  const s = V(e.foreground, { r: 212, g: 212, b: 212 }), r = V(e.background, { r: 30, g: 30, b: 30 }), o = {
    codepoint: 32,
    fg_r: s.r,
    fg_g: s.g,
    fg_b: s.b,
    bg_r: r.r,
    bg_g: r.g,
    bg_b: r.b,
    flags: 0,
    width: 1,
    hyperlink_id: 0,
    grapheme_len: 0
  };
  return Array.from({ length: t }, () => Array.from({ length: i }, () => ({ ...o })));
}
class ut {
  constructor(t = {}) {
    this.unicode = {
      get activeVersion() {
        return "15.1";
      }
    }, this.dataEmitter = new T(), this.resizeEmitter = new T(), this.bellEmitter = new T(), this.selectionChangeEmitter = new T(), this.keyEmitter = new T(), this.titleChangeEmitter = new T(), this.scrollEmitter = new T(), this.renderEmitter = new T(), this.cursorMoveEmitter = new T(), this.onData = this.dataEmitter.event, this.onResize = this.resizeEmitter.event, this.onBell = this.bellEmitter.event, this.onSelectionChange = this.selectionChangeEmitter.event, this.onKey = this.keyEmitter.event, this.onTitleChange = this.titleChangeEmitter.event, this.onScroll = this.scrollEmitter.event, this.onRender = this.renderEmitter.event, this.onCursorMove = this.cursorMoveEmitter.event, this.isOpen = !1, this.isDisposed = !1, this.writeQueue = [], this.addons = [], this.currentTitle = "", this.viewportY = 0, this.targetViewportY = 0, this.lastCursorY = 0, this.isDraggingScrollbar = !1, this.scrollbarDragStart = null, this.scrollbarDragStartViewportY = 0, this.scrollbarVisible = !1, this.scrollbarOpacity = 0, this.SCROLLBAR_HIDE_DELAY_MS = 1500, this.SCROLLBAR_FADE_DURATION_MS = 200, this.bootstrapCells = null, this.bootstrapDirty = !1, this.animateScroll = () => {
      if (!this.wasmTerm || this.scrollAnimationStartTime === void 0)
        return;
      const s = this.options.smoothScrollDuration ?? 100, r = this.targetViewportY - this.viewportY;
      if (Math.abs(r) < 0.01) {
        this.viewportY = this.targetViewportY, this.scrollEmitter.fire(Math.floor(this.viewportY)), this.getScrollbackLength() > 0 && this.showScrollbar(), this.scrollAnimationFrame = void 0, this.scrollAnimationStartTime = void 0, this.scrollAnimationStartY = void 0;
        return;
      }
      const a = 1 - (1 / (s / 1e3 * 60)) ** 2;
      this.viewportY += r * a;
      const l = Math.floor(this.viewportY);
      this.scrollEmitter.fire(l), this.getScrollbackLength() > 0 && this.showScrollbar(), this.scrollAnimationFrame = requestAnimationFrame(this.animateScroll);
    }, this.handleMouseMove = (s) => {
      if (!(!this.canvas || !this.renderer || !this.wasmTerm)) {
        if (this.isDraggingScrollbar) {
          this.processScrollbarDrag(s);
          return;
        }
        if (this.linkDetector) {
          if (this.mouseMoveThrottleTimeout) {
            this.pendingMouseMove = s;
            return;
          }
          this.processMouseMove(s), this.mouseMoveThrottleTimeout = window.setTimeout(() => {
            if (this.mouseMoveThrottleTimeout = void 0, this.pendingMouseMove) {
              const r = this.pendingMouseMove;
              this.pendingMouseMove = void 0, this.processMouseMove(r);
            }
          }, 16);
        }
      }
    }, this.handleMouseLeave = () => {
      var s, r;
      this.renderer && this.wasmTerm && ((this.renderer.hoveredHyperlinkId || 0) > 0 && this.renderer.setHoveredHyperlinkId(0), this.renderer.setHoveredLinkRange(null)), this.currentHoveredLink && ((r = (s = this.currentHoveredLink).hover) == null || r.call(s, !1), this.currentHoveredLink = void 0, this.element && (this.element.style.cursor = "text", this.canvas && (this.canvas.style.cursor = "text")));
    }, this.handleClick = async (s) => {
      if (!this.canvas || !this.renderer || !this.linkDetector || !this.wasmTerm)
        return;
      const r = this.canvas.getBoundingClientRect(), o = Math.floor((s.clientX - r.left) / this.renderer.charWidth), a = Math.floor((s.clientY - r.top) / this.renderer.charHeight), l = this.wasmTerm.getScrollbackLength();
      let c;
      const u = this.getViewportY(), m = Math.max(0, Math.floor(u));
      if (m > 0)
        if (a < m)
          c = l - m + a;
        else {
          const w = a - m;
          c = l + w;
        }
      else
        c = l + a;
      const g = await this.linkDetector.getLinkAt(o, c);
      g && (g.activate(s), (s.ctrlKey || s.metaKey) && s.preventDefault());
    }, this.handleWheel = (s) => {
      var o, n, a;
      if (s.preventDefault(), s.stopPropagation(), this.customWheelEventHandler && this.customWheelEventHandler(s))
        return;
      if (((o = this.wasmTerm) == null ? void 0 : o.isAlternateScreen()) ?? !1) {
        const l = s.deltaY > 0 ? "down" : "up", c = Math.min(Math.abs(Math.round(s.deltaY / 33)), 5);
        for (let u = 0; u < c; u++)
          l === "up" ? this.dataEmitter.fire("\x1B[A") : this.dataEmitter.fire("\x1B[B");
      } else {
        let l;
        if (s.deltaMode === WheelEvent.DOM_DELTA_PIXEL) {
          const c = ((a = (n = this.renderer) == null ? void 0 : n.getMetrics()) == null ? void 0 : a.height) ?? 20;
          l = s.deltaY / c;
        } else
          s.deltaMode === WheelEvent.DOM_DELTA_LINE ? l = s.deltaY : s.deltaMode === WheelEvent.DOM_DELTA_PAGE ? l = s.deltaY * this.rows : l = s.deltaY / 33;
        if (l !== 0) {
          const c = this.viewportY - l;
          this.smoothScrollTo(c);
        }
      }
    }, this.handleMouseDown = (s) => {
      if (!this.canvas || !this.renderer || !this.wasmTerm)
        return;
      const r = this.wasmTerm.getScrollbackLength();
      if (r === 0)
        return;
      const o = this.canvas.getBoundingClientRect(), n = s.clientX - o.left, a = s.clientY - o.top, l = o.width, c = o.height, u = 8, m = l - u - 4, g = 4;
      if (n >= m && n <= m + u) {
        s.preventDefault(), s.stopPropagation(), s.stopImmediatePropagation();
        const w = c - g * 2, d = this.rows, p = r + d, _ = Math.max(20, d / p * w), v = this.viewportY / r, f = g + (w - _) * (1 - v);
        if (a >= f && a <= f + _)
          this.isDraggingScrollbar = !0, this.scrollbarDragStart = a, this.scrollbarDragStartViewportY = this.viewportY, this.canvas && (this.canvas.style.userSelect = "none", this.canvas.style.webkitUserSelect = "none");
        else {
          const S = 1 - (a - g) / w, P = Math.round(S * r);
          this.scrollToLine(Math.max(0, Math.min(r, P)));
        }
      }
    }, this.handleMouseUp = () => {
      this.isDraggingScrollbar && (this.isDraggingScrollbar = !1, this.scrollbarDragStart = null, this.canvas && (this.canvas.style.userSelect = "", this.canvas.style.webkitUserSelect = ""), this.scrollbarVisible && this.getScrollbackLength() > 0 && this.showScrollbar());
    }, this.ghostty = t.ghostty ?? ct();
    const e = {
      cols: t.cols ?? 80,
      rows: t.rows ?? 24,
      cursorBlink: t.cursorBlink ?? !1,
      cursorStyle: t.cursorStyle ?? "block",
      theme: t.theme ?? {},
      scrollback: t.scrollback ?? 1e4,
      fontSize: t.fontSize ?? 15,
      fontFamily: t.fontFamily ?? "monospace",
      allowTransparency: t.allowTransparency ?? !1,
      convertEol: t.convertEol ?? !1,
      disableStdin: t.disableStdin ?? !1,
      smoothScrollDuration: t.smoothScrollDuration ?? 100
      // Default: 100ms smooth scroll
    };
    this.options = new Proxy(e, {
      set: (s, r, o) => {
        const n = s[r];
        return s[r] = o, this.isOpen && this.handleOptionChange(r, o, n), !0;
      }
    }), this.cols = this.options.cols, this.rows = this.options.rows, this.buffer = new Q(this), this.bootstrapBuffer = {
      getLine: (s) => {
        var r;
        return this.bootstrapCells && s >= 0 && s < this.bootstrapCells.length ? this.bootstrapCells[s] : ((r = this.wasmTerm) == null ? void 0 : r.getLine(s)) ?? null;
      },
      getCursor: () => {
        var s;
        return this.bootstrapCells ? { x: 0, y: 0, visible: !0 } : ((s = this.wasmTerm) == null ? void 0 : s.getCursor()) ?? { x: 0, y: 0, visible: !0 };
      },
      getDimensions: () => ({ cols: this.cols, rows: this.rows }),
      isRowDirty: (s) => {
        var r;
        return this.bootstrapDirty ? !0 : this.bootstrapCells ? !1 : ((r = this.wasmTerm) == null ? void 0 : r.isRowDirty(s)) ?? !1;
      },
      needsFullRedraw: () => {
        var r;
        if (this.bootstrapDirty)
          return !0;
        if (this.bootstrapCells)
          return !1;
        const s = this.wasmTerm;
        return ((r = s == null ? void 0 : s.needsFullRedraw) == null ? void 0 : r.call(s)) ?? !1;
      },
      clearDirty: () => {
        var s;
        this.bootstrapDirty = !1, (s = this.wasmTerm) == null || s.clearDirty();
      },
      getGraphemeString: (s, r) => {
        var n, a;
        if (this.bootstrapCells && s >= 0 && s < this.bootstrapCells.length) {
          const l = (n = this.bootstrapCells[s]) == null ? void 0 : n[r];
          return l ? String.fromCodePoint(l.codepoint || 32) : " ";
        }
        const o = this.wasmTerm;
        return ((a = o == null ? void 0 : o.getGraphemeString) == null ? void 0 : a.call(o, s, r)) ?? " ";
      }
    };
  }
  // ==========================================================================
  // Option Change Handling (for mutable options)
  // ==========================================================================
  /**
   * Handle runtime option changes (called when options are modified after terminal is open)
   * This enables xterm.js compatibility where options can be changed at runtime
   */
  handleOptionChange(t, e, s) {
    if (e !== s)
      switch (t) {
        case "disableStdin":
          break;
        case "cursorBlink":
        case "cursorStyle":
          this.renderer && (this.renderer.setCursorStyle(this.options.cursorStyle), this.renderer.setCursorBlink(this.options.cursorBlink));
          break;
        case "theme":
          this.renderer && console.warn("ghostty-web: theme changes after open() are not yet fully supported");
          break;
        case "fontSize":
          this.renderer && (this.renderer.setFontSize(this.options.fontSize), this.handleFontChange());
          break;
        case "fontFamily":
          this.renderer && (this.renderer.setFontFamily(this.options.fontFamily), this.handleFontChange());
          break;
        case "cols":
        case "rows":
          this.resize(this.options.cols, this.options.rows);
          break;
      }
  }
  /**
   * Handle font changes (fontSize or fontFamily)
   * Updates canvas size to match new font metrics and forces a full re-render
   */
  handleFontChange() {
    if (!this.renderer || !this.wasmTerm || !this.canvas)
      return;
    this.selectionManager && this.selectionManager.clearSelection(), this.renderer.resize(this.cols, this.rows);
    const t = this.renderer.getMetrics();
    this.canvas.width = t.width * this.cols, this.canvas.height = t.height * this.rows, this.canvas.style.width = `${t.width * this.cols}px`, this.canvas.style.height = `${t.height * this.rows}px`, this.renderer.render(this.wasmTerm, !0, this.viewportY, this);
  }
  /**
   * Parse a CSS color string to 0xRRGGBB format.
   * Returns 0 if the color is undefined or invalid.
   */
  parseColorToHex(t) {
    if (!t)
      return 0;
    if (t.startsWith("#")) {
      let s = t.slice(1);
      s.length === 3 && (s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2]);
      const r = Number.parseInt(s, 16);
      return Number.isNaN(r) ? 0 : r;
    }
    const e = t.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (e) {
      const s = Number.parseInt(e[1], 10), r = Number.parseInt(e[2], 10), o = Number.parseInt(e[3], 10);
      return s << 16 | r << 8 | o;
    }
    return 0;
  }
  /**
   * Convert terminal options to WASM terminal config.
   */
  buildWasmConfig() {
    const t = this.options.theme, e = this.options.scrollback;
    if (!t && e === 1e4)
      return;
    const s = [
      this.parseColorToHex(t == null ? void 0 : t.black),
      this.parseColorToHex(t == null ? void 0 : t.red),
      this.parseColorToHex(t == null ? void 0 : t.green),
      this.parseColorToHex(t == null ? void 0 : t.yellow),
      this.parseColorToHex(t == null ? void 0 : t.blue),
      this.parseColorToHex(t == null ? void 0 : t.magenta),
      this.parseColorToHex(t == null ? void 0 : t.cyan),
      this.parseColorToHex(t == null ? void 0 : t.white),
      this.parseColorToHex(t == null ? void 0 : t.brightBlack),
      this.parseColorToHex(t == null ? void 0 : t.brightRed),
      this.parseColorToHex(t == null ? void 0 : t.brightGreen),
      this.parseColorToHex(t == null ? void 0 : t.brightYellow),
      this.parseColorToHex(t == null ? void 0 : t.brightBlue),
      this.parseColorToHex(t == null ? void 0 : t.brightMagenta),
      this.parseColorToHex(t == null ? void 0 : t.brightCyan),
      this.parseColorToHex(t == null ? void 0 : t.brightWhite)
    ];
    return {
      scrollbackLimit: e,
      fgColor: this.parseColorToHex(t == null ? void 0 : t.foreground),
      bgColor: this.parseColorToHex(t == null ? void 0 : t.background),
      cursorColor: this.parseColorToHex(t == null ? void 0 : t.cursor),
      palette: s
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
  open(t) {
    if (this.isOpen)
      throw new Error("Terminal is already open");
    if (this.isDisposed)
      throw new Error("Terminal has been disposed");
    this.element = t, this.isOpen = !0;
    try {
      t.hasAttribute("tabindex") || t.setAttribute("tabindex", "0"), t.setAttribute("contenteditable", "true"), t.addEventListener("beforeinput", (l) => {
        l.target === t && l.preventDefault();
      }), t.setAttribute("role", "textbox"), t.setAttribute("aria-label", "Terminal input"), t.setAttribute("aria-multiline", "true");
      const e = this.buildWasmConfig();
      this.wasmTerm = this.ghostty.createTerminal(this.cols, this.rows, e), this.canvas = document.createElement("canvas"), this.canvas.style.display = "block", this.canvas.style.cursor = "text", t.appendChild(this.canvas), this.textarea = document.createElement("textarea"), this.textarea.setAttribute("autocorrect", "off"), this.textarea.setAttribute("autocapitalize", "off"), this.textarea.setAttribute("spellcheck", "false"), this.textarea.setAttribute("tabindex", "0"), this.textarea.setAttribute("aria-label", "Terminal input"), this.textarea.style.position = "absolute", this.textarea.style.left = "0", this.textarea.style.top = "0", this.textarea.style.width = "1px", this.textarea.style.height = "1px", this.textarea.style.padding = "0", this.textarea.style.border = "none", this.textarea.style.margin = "0", this.textarea.style.opacity = "0", this.textarea.style.clipPath = "inset(50%)", this.textarea.style.overflow = "hidden", this.textarea.style.whiteSpace = "nowrap", this.textarea.style.resize = "none", t.appendChild(this.textarea);
      const s = this.textarea;
      this.canvas.addEventListener("mousedown", (l) => {
        l.preventDefault(), s.focus();
      }), this.canvas.addEventListener("touchend", (l) => {
        l.preventDefault(), s.focus();
      }), this.renderer = new it(this.canvas, {
        fontSize: this.options.fontSize,
        fontFamily: this.options.fontFamily,
        cursorStyle: this.options.cursorStyle,
        cursorBlink: this.options.cursorBlink,
        theme: this.options.theme
      }), this.renderer.resize(this.cols, this.rows);
      const r = this.canvas, o = this.renderer, n = this.wasmTerm, a = {
        hasMouseTracking: () => (n == null ? void 0 : n.hasMouseTracking()) ?? !1,
        hasSgrMouseMode: () => (n == null ? void 0 : n.getMode(1006, !1)) ?? !0,
        // SGR extended mode
        getCellDimensions: () => ({
          width: o.charWidth,
          height: o.charHeight
        }),
        getCanvasOffset: () => {
          const l = r.getBoundingClientRect();
          return { left: l.left, top: l.top };
        }
      };
      this.inputHandler = new K(
        this.ghostty,
        t,
        (l) => {
          var c;
          this.options.disableStdin || ((c = this.selectionManager) == null || c.clearSelection(), this.dataEmitter.fire(l));
        },
        () => {
          this.bellEmitter.fire();
        },
        (l) => {
          this.keyEmitter.fire(l);
        },
        this.customKeyEventHandler,
        (l) => {
          var c;
          return ((c = this.wasmTerm) == null ? void 0 : c.getMode(l, !1)) ?? !1;
        },
        () => this.copySelection(),
        this.textarea,
        a
      ), this.selectionManager = new rt(
        this,
        this.renderer,
        this.wasmTerm,
        this.textarea
      ), this.renderer.setSelectionManager(this.selectionManager), this.selectionManager.onSelectionChange(() => {
        this.selectionChangeEmitter.fire();
      }), this.linkDetector = new tt(this), this.linkDetector.registerProvider(new et(this)), this.linkDetector.registerProvider(new st(this)), t.addEventListener("mousedown", this.handleMouseDown, { capture: !0 }), t.addEventListener("mousemove", this.handleMouseMove), t.addEventListener("mouseleave", this.handleMouseLeave), t.addEventListener("click", this.handleClick), document.addEventListener("mouseup", this.handleMouseUp), t.addEventListener("wheel", this.handleWheel, { passive: !1, capture: !0 }), this.armBootstrapBlank(), this.renderer.render(this.bootstrapBuffer, !0, this.viewportY, this, this.scrollbarOpacity), this.startRenderLoop(), this.focus();
    } catch (e) {
      throw this.isOpen = !1, this.cleanupComponents(), new Error(`Failed to open terminal: ${e}`);
    }
  }
  /**
   * Write data to terminal
   */
  write(t, e) {
    this.assertOpen(), this.options.convertEol && typeof t == "string" && (t = t.replace(/\n/g, `\r
`)), this.writeInternal(t, e);
  }
  /**
   * Internal write implementation (extracted from write())
   */
  writeInternal(t, e) {
    var s;
    this.disarmBootstrapBlank(), this.wasmTerm.write(t), this.processTerminalResponses(), typeof t == "string" && t.includes("\x07") ? this.bellEmitter.fire() : t instanceof Uint8Array && t.includes(7) && this.bellEmitter.fire(), (s = this.linkDetector) == null || s.invalidateCache(), this.viewportY !== 0 && this.scrollToBottom(), typeof t == "string" && t.includes("\x1B]") && this.checkForTitleChange(t), e && requestAnimationFrame(e);
  }
  /**
   * Write data with newline
   */
  writeln(t, e) {
    if (typeof t == "string")
      this.write(t + `\r
`, e);
    else {
      const s = new Uint8Array(t.length + 2);
      s.set(t), s[t.length] = 13, s[t.length + 1] = 10, this.write(s, e);
    }
  }
  /**
   * Paste text into terminal (triggers bracketed paste if supported)
   */
  paste(t) {
    this.assertOpen(), !this.options.disableStdin && (this.wasmTerm.hasBracketedPaste() ? this.dataEmitter.fire("\x1B[200~" + t + "\x1B[201~") : this.dataEmitter.fire(t));
  }
  /**
   * Input data into terminal (as if typed by user)
   *
   * @param data - Data to input
   * @param wasUserInput - If true, triggers onData event (default: false for compat with some apps)
   */
  input(t, e = !1) {
    this.assertOpen(), !this.options.disableStdin && (e ? this.dataEmitter.fire(t) : this.write(t));
  }
  /**
   * Resize terminal
   */
  resize(t, e) {
    if (this.assertOpen(), !(t === this.cols && e === this.rows)) {
      this.cancelRenderLoop();
      try {
        this.cols = t, this.rows = e, this.wasmTerm.resize(t, e), this.renderer.resize(t, e);
        const s = this.renderer.getMetrics();
        this.canvas.width = s.width * t, this.canvas.height = s.height * e, this.canvas.style.width = `${s.width * t}px`, this.canvas.style.height = `${s.height * e}px`, this.resizeEmitter.fire({ cols: t, rows: e }), this.renderer.render(this.wasmTerm, !0, this.viewportY, this);
      } catch (s) {
        console.error("Terminal resize failed:", s);
      }
      this.flushWriteQueue(), this.startRenderLoop();
    }
  }
  /**
   * Clear terminal screen
   */
  clear() {
    this.assertOpen(), this.wasmTerm.write("\x1B[2J\x1B[H");
  }
  /**
   * Reset terminal state
   */
  reset() {
    this.assertOpen(), this.wasmTerm && this.wasmTerm.free();
    const t = this.buildWasmConfig();
    this.wasmTerm = this.ghostty.createTerminal(this.cols, this.rows, t), this.armBootstrapBlank(), this.renderer.clear(), this.renderer.render(this.bootstrapBuffer, !0, this.viewportY, this, this.scrollbarOpacity), this.currentTitle = "";
  }
  /**
   * Focus terminal input
   */
  focus() {
    this.isOpen && this.element && (this.element.focus(), setTimeout(() => {
      var t;
      (t = this.element) == null || t.focus();
    }, 0));
  }
  /**
   * Blur terminal (remove focus)
   */
  blur() {
    this.isOpen && this.element && this.element.blur();
  }
  /**
   * Load an addon
   */
  loadAddon(t) {
    t.activate(this), this.addons.push(t);
  }
  // ==========================================================================
  // Selection API (xterm.js compatible)
  // ==========================================================================
  /**
   * Get the selected text as a string
   */
  getSelection() {
    var t;
    return ((t = this.selectionManager) == null ? void 0 : t.getSelection()) || "";
  }
  /**
   * Check if there's an active selection
   */
  hasSelection() {
    var t;
    return ((t = this.selectionManager) == null ? void 0 : t.hasSelection()) || !1;
  }
  /**
   * Clear the current selection
   */
  clearSelection() {
    var t;
    (t = this.selectionManager) == null || t.clearSelection();
  }
  /**
   * Copy the current selection to clipboard
   * @returns true if there was text to copy, false otherwise
   */
  copySelection() {
    var t;
    return ((t = this.selectionManager) == null ? void 0 : t.copySelection()) || !1;
  }
  /**
   * Select all text in the terminal
   */
  selectAll() {
    var t;
    (t = this.selectionManager) == null || t.selectAll();
  }
  /**
   * Select text at specific column and row with length
   */
  select(t, e, s) {
    var r;
    (r = this.selectionManager) == null || r.select(t, e, s);
  }
  /**
   * Select entire lines from start to end
   */
  selectLines(t, e) {
    var s;
    (s = this.selectionManager) == null || s.selectLines(t, e);
  }
  /**
   * Get selection position as buffer range
   */
  /**
   * Get the current viewport Y position.
   *
   * This is the number of lines scrolled back from the bottom of the
   * scrollback buffer. It may be fractional during smooth scrolling.
   */
  getViewportY() {
    return this.viewportY;
  }
  getSelectionPosition() {
    var t;
    return (t = this.selectionManager) == null ? void 0 : t.getSelectionPosition();
  }
  // ==========================================================================
  // Phase 1: Custom Event Handlers
  // ==========================================================================
  /**
   * Attach a custom keyboard event handler
   * Returns true to prevent default handling
   */
  attachCustomKeyEventHandler(t) {
    this.customKeyEventHandler = t, this.inputHandler && this.inputHandler.setCustomKeyEventHandler(t);
  }
  /**
   * Attach a custom wheel event handler (Phase 2)
   * Returns true to prevent default handling
   */
  attachCustomWheelEventHandler(t) {
    this.customWheelEventHandler = t;
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
  registerLinkProvider(t) {
    if (!this.linkDetector)
      throw new Error("Terminal must be opened before registering link providers");
    this.linkDetector.registerProvider(t);
  }
  // ==========================================================================
  // Phase 2: Scrolling Methods
  // ==========================================================================
  /**
   * Scroll viewport by a number of lines
   * @param amount Number of lines to scroll (positive = down, negative = up)
   */
  scrollLines(t) {
    if (!this.wasmTerm)
      throw new Error("Terminal not open");
    const e = this.getScrollbackLength(), r = Math.max(0, Math.min(e, this.viewportY - t));
    r !== this.viewportY && (this.viewportY = r, this.scrollEmitter.fire(this.viewportY), e > 0 && this.showScrollbar());
  }
  /**
   * Scroll viewport by a number of pages
   * @param amount Number of pages to scroll (positive = down, negative = up)
   */
  scrollPages(t) {
    this.scrollLines(t * this.rows);
  }
  /**
   * Scroll viewport to the top of the scrollback buffer
   */
  scrollToTop() {
    const t = this.getScrollbackLength();
    t > 0 && this.viewportY !== t && (this.viewportY = t, this.scrollEmitter.fire(this.viewportY), this.showScrollbar());
  }
  /**
   * Scroll viewport to the bottom (current output)
   */
  scrollToBottom() {
    this.viewportY !== 0 && (this.viewportY = 0, this.scrollEmitter.fire(this.viewportY), this.getScrollbackLength() > 0 && this.showScrollbar());
  }
  /**
   * Scroll viewport to a specific line in the buffer
   * @param line Line number (0 = top of scrollback, scrollbackLength = bottom)
   */
  scrollToLine(t) {
    const e = this.getScrollbackLength(), s = Math.max(0, Math.min(e, t));
    s !== this.viewportY && (this.viewportY = s, this.scrollEmitter.fire(this.viewportY), e > 0 && this.showScrollbar());
  }
  /**
   * Smoothly scroll to a target viewport position
   * @param targetY Target viewport Y position (in lines, can be fractional)
   */
  smoothScrollTo(t) {
    if (!this.wasmTerm)
      return;
    const e = this.getScrollbackLength(), r = Math.max(0, Math.min(e, t));
    if ((this.options.smoothScrollDuration ?? 100) === 0) {
      this.viewportY = r, this.targetViewportY = r, this.scrollEmitter.fire(Math.floor(this.viewportY)), e > 0 && this.showScrollbar();
      return;
    }
    this.targetViewportY = r, !this.scrollAnimationFrame && (this.scrollAnimationStartTime = Date.now(), this.scrollAnimationStartY = this.viewportY, this.animateScroll());
  }
  // ==========================================================================
  // Lifecycle
  // ==========================================================================
  /**
   * Dispose terminal and clean up resources
   */
  dispose() {
    if (!this.isDisposed) {
      this.isDisposed = !0, this.isOpen = !1, this.cancelRenderLoop(), this.writeQueue.length = 0, this.scrollAnimationFrame && (cancelAnimationFrame(this.scrollAnimationFrame), this.scrollAnimationFrame = void 0), this.mouseMoveThrottleTimeout && (clearTimeout(this.mouseMoveThrottleTimeout), this.mouseMoveThrottleTimeout = void 0), this.pendingMouseMove = void 0;
      for (const t of this.addons)
        t.dispose();
      this.addons = [], this.cleanupComponents(), this.dataEmitter.dispose(), this.resizeEmitter.dispose(), this.bellEmitter.dispose(), this.selectionChangeEmitter.dispose(), this.keyEmitter.dispose(), this.titleChangeEmitter.dispose(), this.scrollEmitter.dispose(), this.renderEmitter.dispose(), this.cursorMoveEmitter.dispose();
    }
  }
  // ==========================================================================
  // Private Methods
  // ==========================================================================
  /**
   * Cancel the render loop
   */
  cancelRenderLoop() {
    this.animationFrameId && (cancelAnimationFrame(this.animationFrameId), this.animationFrameId = void 0);
  }
  /**
   * Flush any writes that were queued during resize
   */
  flushWriteQueue() {
    for (; this.writeQueue.length > 0; ) {
      const t = this.writeQueue.shift();
      this.wasmTerm.write(t);
    }
  }
  /**
   * Start the render loop
   */
  startRenderLoop() {
    if (this.animationFrameId)
      return;
    const t = () => {
      if (!this.isDisposed && this.isOpen) {
        this.renderer.render(this.bootstrapBuffer, !1, this.viewportY, this, this.scrollbarOpacity);
        const e = this.wasmTerm.getCursor();
        e.y !== this.lastCursorY && (this.lastCursorY = e.y, this.cursorMoveEmitter.fire()), this.animationFrameId = requestAnimationFrame(t);
      }
    };
    t();
  }
  /**
   * Get a line from native WASM scrollback buffer
   * Implements IScrollbackProvider
   */
  getScrollbackLine(t) {
    return this.wasmTerm ? this.wasmTerm.getScrollbackLine(t) : null;
  }
  /**
   * Get scrollback length from native WASM
   * Implements IScrollbackProvider
   */
  getScrollbackLength() {
    return this.wasmTerm ? this.wasmTerm.getScrollbackLength() : 0;
  }
  armBootstrapBlank() {
    const t = { ...O, ...this.options.theme };
    this.bootstrapCells = ot(this.cols, this.rows, {
      foreground: t.foreground,
      background: t.background
    }), this.bootstrapDirty = !0;
  }
  disarmBootstrapBlank() {
    this.bootstrapCells && (this.bootstrapCells = null, this.bootstrapDirty = !0);
  }
  /**
   * Clean up components (called on dispose or error)
   */
  cleanupComponents() {
    this.selectionManager && (this.selectionManager.dispose(), this.selectionManager = void 0), this.inputHandler && (this.inputHandler.dispose(), this.inputHandler = void 0), this.renderer && (this.renderer.dispose(), this.renderer = void 0), this.canvas && this.canvas.parentNode && (this.canvas.parentNode.removeChild(this.canvas), this.canvas = void 0), this.textarea && this.textarea.parentNode && (this.textarea.parentNode.removeChild(this.textarea), this.textarea = void 0), this.element && (this.element.removeEventListener("wheel", this.handleWheel), this.element.removeEventListener("mousedown", this.handleMouseDown, { capture: !0 }), this.element.removeEventListener("mousemove", this.handleMouseMove), this.element.removeEventListener("mouseleave", this.handleMouseLeave), this.element.removeEventListener("click", this.handleClick), this.element.removeAttribute("contenteditable"), this.element.removeAttribute("role"), this.element.removeAttribute("aria-label"), this.element.removeAttribute("aria-multiline")), this.isOpen && typeof document < "u" && document.removeEventListener("mouseup", this.handleMouseUp), this.scrollbarHideTimeout && (window.clearTimeout(this.scrollbarHideTimeout), this.scrollbarHideTimeout = void 0), this.linkDetector && (this.linkDetector.dispose(), this.linkDetector = void 0), this.wasmTerm && (this.wasmTerm.free(), this.wasmTerm = void 0), this.ghostty = void 0, this.element = void 0, this.textarea = void 0;
  }
  /**
   * Assert terminal is open (throw if not)
   */
  assertOpen() {
    if (this.isDisposed)
      throw new Error("Terminal has been disposed");
    if (!this.isOpen)
      throw new Error("Terminal must be opened before use. Call terminal.open(parent) first.");
  }
  /**
   * Process mouse move for link detection (internal, called by throttled handler)
   */
  processMouseMove(t) {
    if (!this.canvas || !this.renderer || !this.linkDetector || !this.wasmTerm)
      return;
    const e = this.canvas.getBoundingClientRect(), s = Math.floor((t.clientX - e.left) / this.renderer.charWidth), o = Math.floor((t.clientY - e.top) / this.renderer.charHeight);
    let n = 0, a = null;
    const l = this.getViewportY(), c = Math.max(0, Math.floor(l));
    if (c > 0) {
      const p = this.wasmTerm.getScrollbackLength();
      if (o < c) {
        const _ = p - c + o;
        a = this.wasmTerm.getScrollbackLine(_);
      } else {
        const _ = o - c;
        a = this.wasmTerm.getLine(_);
      }
    } else
      a = this.wasmTerm.getLine(o);
    a && s >= 0 && s < a.length && (n = a[s].hyperlink_id);
    const u = this.renderer.hoveredHyperlinkId || 0;
    n !== u && this.renderer.setHoveredHyperlinkId(n);
    const m = this.wasmTerm.getScrollbackLength();
    let g;
    const w = this.getViewportY(), d = Math.max(0, Math.floor(w));
    if (d > 0)
      if (o < d)
        g = m - d + o;
      else {
        const p = o - d;
        g = m + p;
      }
    else
      g = m + o;
    this.linkDetector.getLinkAt(s, g).then((p) => {
      var _, v, f, b;
      if (p !== this.currentHoveredLink) {
        (v = (_ = this.currentHoveredLink) == null ? void 0 : _.hover) == null || v.call(_, !1), this.currentHoveredLink = p, (f = p == null ? void 0 : p.hover) == null || f.call(p, !0);
        const S = p ? "pointer" : "text";
        if (this.element && (this.element.style.cursor = S), this.canvas && (this.canvas.style.cursor = S), this.renderer)
          if (p) {
            const P = ((b = this.wasmTerm) == null ? void 0 : b.getScrollbackLength()) || 0, $ = this.getViewportY(), F = Math.max(0, Math.floor($)), H = p.range.start.y - P + F, U = p.range.end.y - P + F;
            H < this.rows && U >= 0 ? this.renderer.setHoveredLinkRange({
              startX: p.range.start.x,
              startY: Math.max(0, H),
              endX: p.range.end.x,
              endY: Math.min(this.rows - 1, U)
            }) : this.renderer.setHoveredLinkRange(null);
          } else
            this.renderer.setHoveredLinkRange(null);
      }
    }).catch((p) => {
      console.warn("Link detection error:", p);
    });
  }
  /**
   * Process scrollbar drag movement
   */
  processScrollbarDrag(t) {
    if (!this.canvas || !this.renderer || !this.wasmTerm || this.scrollbarDragStart === null)
      return;
    const e = this.wasmTerm.getScrollbackLength();
    if (e === 0)
      return;
    const s = this.canvas.getBoundingClientRect(), o = t.clientY - s.top - this.scrollbarDragStart, l = s.height - 4 * 2, c = this.rows, u = e + c, m = Math.max(20, c / u * l), g = -o / (l - m), w = Math.round(g * e), d = this.scrollbarDragStartViewportY + w;
    this.scrollToLine(Math.max(0, Math.min(e, d)));
  }
  /**
   * Show scrollbar with fade-in and schedule auto-hide
   */
  showScrollbar() {
    this.scrollbarHideTimeout && (window.clearTimeout(this.scrollbarHideTimeout), this.scrollbarHideTimeout = void 0), this.scrollbarVisible ? this.scrollbarOpacity = 1 : (this.scrollbarVisible = !0, this.scrollbarOpacity = 0, this.fadeInScrollbar()), this.isDraggingScrollbar || (this.scrollbarHideTimeout = window.setTimeout(() => {
      this.hideScrollbar();
    }, this.SCROLLBAR_HIDE_DELAY_MS));
  }
  /**
   * Hide scrollbar with fade-out
   */
  hideScrollbar() {
    this.scrollbarHideTimeout && (window.clearTimeout(this.scrollbarHideTimeout), this.scrollbarHideTimeout = void 0), this.scrollbarVisible && this.fadeOutScrollbar();
  }
  /**
   * Fade in scrollbar
   */
  fadeInScrollbar() {
    const t = Date.now(), e = () => {
      const s = Date.now() - t, r = Math.min(s / this.SCROLLBAR_FADE_DURATION_MS, 1);
      this.scrollbarOpacity = r, this.renderer && this.wasmTerm && this.renderer.render(this.wasmTerm, !1, this.viewportY, this, this.scrollbarOpacity), r < 1 && requestAnimationFrame(e);
    };
    e();
  }
  /**
   * Fade out scrollbar
   */
  fadeOutScrollbar() {
    const t = Date.now(), e = this.scrollbarOpacity, s = () => {
      const r = Date.now() - t, o = Math.min(r / this.SCROLLBAR_FADE_DURATION_MS, 1);
      this.scrollbarOpacity = e * (1 - o), this.renderer && this.wasmTerm && this.renderer.render(this.wasmTerm, !1, this.viewportY, this, this.scrollbarOpacity), o < 1 ? requestAnimationFrame(s) : (this.scrollbarVisible = !1, this.scrollbarOpacity = 0, this.renderer && this.wasmTerm && this.renderer.render(this.wasmTerm, !1, this.viewportY, this, 0));
    };
    s();
  }
  /**
   * Process any pending terminal responses and emit them via onData.
   *
   * This handles escape sequences that require the terminal to send a response
   * back to the PTY, such as:
   * - DSR 6 (cursor position): Shell sends \x1b[6n, terminal responds with \x1b[row;colR
   * - DSR 5 (operating status): Shell sends \x1b[5n, terminal responds with \x1b[0n
   *
   * Without this, shells like nushell that rely on cursor position queries
   * will hang waiting for a response that never comes.
   *
   * Note: We loop to read all pending responses, not just one. This is important
   * when multiple queries are processed in a single write() call (e.g., when
   * buffered data is written all at once during terminal initialization).
   */
  processTerminalResponses() {
    if (this.wasmTerm)
      for (; ; ) {
        const t = this.wasmTerm.readResponse();
        if (t === null)
          break;
        this.dataEmitter.fire(t);
      }
  }
  /**
   * Check for title changes in written data (OSC sequences)
   * Simplified implementation - looks for OSC 0, 1, 2
   */
  checkForTitleChange(t) {
    const e = /\x1b\]([012]);([^\x07\x1b]*?)(?:\x07|\x1b\\)/g;
    let s = null;
    for (; (s = e.exec(t)) !== null; ) {
      const r = s[1], o = s[2];
      (r === "0" || r === "2") && o !== this.currentTitle && (this.currentTitle = o, this.titleChangeEmitter.fire(o));
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
  getMode(t, e = !1) {
    return this.assertOpen(), this.wasmTerm.getMode(t, e);
  }
  /**
   * Check if bracketed paste mode is enabled
   */
  hasBracketedPaste() {
    return this.assertOpen(), this.wasmTerm.hasBracketedPaste();
  }
  /**
   * Check if focus event reporting is enabled
   */
  hasFocusEvents() {
    return this.assertOpen(), this.wasmTerm.hasFocusEvents();
  }
  /**
   * Check if mouse tracking is enabled
   */
  hasMouseTracking() {
    return this.assertOpen(), this.wasmTerm.hasMouseTracking();
  }
}
const nt = 2, at = 1, lt = 15, ht = 100;
class dt {
  constructor() {
    this._isResizing = !1;
  }
  /**
   * Activate the addon (called by Terminal.loadAddon)
   */
  activate(t) {
    this._terminal = t;
  }
  /**
   * Dispose the addon and clean up resources
   */
  dispose() {
    this._resizeObserver && (this._resizeObserver.disconnect(), this._resizeObserver = void 0), this._resizeDebounceTimer && (clearTimeout(this._resizeDebounceTimer), this._resizeDebounceTimer = void 0), this._lastCols = void 0, this._lastRows = void 0, this._terminal = void 0;
  }
  /**
   * Fit the terminal to its container
   *
   * Calculates optimal dimensions and resizes the terminal.
   * Does nothing if dimensions cannot be calculated or haven't changed.
   */
  fit() {
    if (this._isResizing)
      return;
    const t = this.proposeDimensions();
    if (!t || !this._terminal)
      return;
    const e = this._terminal, s = e.cols, r = e.rows;
    if (!(t.cols === this._lastCols && t.rows === this._lastRows || t.cols === s && t.rows === r)) {
      this._lastCols = t.cols, this._lastRows = t.rows, this._isResizing = !0;
      try {
        e.resize && typeof e.resize == "function" && e.resize(t.cols, t.rows);
      } finally {
        setTimeout(() => {
          this._isResizing = !1;
        }, 50);
      }
    }
  }
  /**
   * Propose dimensions to fit the terminal to its container
   *
   * Calculates cols and rows based on:
   * - Terminal container element dimensions (clientWidth/Height)
   * - Terminal element padding
   * - Font metrics (character cell size)
   * - Scrollbar width reservation
   *
   * @returns Proposed dimensions or undefined if cannot calculate
   */
  proposeDimensions() {
    var _;
    if (!((_ = this._terminal) != null && _.element))
      return;
    const e = this._terminal.renderer;
    if (!e || typeof e.getMetrics != "function")
      return;
    const s = e.getMetrics();
    if (!s || s.width === 0 || s.height === 0)
      return;
    const r = this._terminal.element;
    if (typeof r.clientWidth > "u")
      return;
    const o = window.getComputedStyle(r), n = Number.parseInt(o.getPropertyValue("padding-top")) || 0, a = Number.parseInt(o.getPropertyValue("padding-bottom")) || 0, l = Number.parseInt(o.getPropertyValue("padding-left")) || 0, c = Number.parseInt(o.getPropertyValue("padding-right")) || 0, u = r.clientWidth, m = r.clientHeight;
    if (u === 0 || m === 0)
      return;
    const g = u - l - c - lt, w = m - n - a, d = Math.max(nt, Math.floor(g / s.width)), p = Math.max(at, Math.floor(w / s.height));
    return { cols: d, rows: p };
  }
  /**
   * Observe the terminal's container for resize events
   *
   * Sets up a ResizeObserver to automatically call fit() when the
   * container size changes. Resize events are debounced to avoid
   * excessive calls during window drag operations.
   *
   * Call dispose() to stop observing.
   */
  observeResize() {
    var t;
    (t = this._terminal) != null && t.element && (this._resizeObserver || (this._resizeObserver = new ResizeObserver((e) => {
      this._isResizing || !e[0] || (this._resizeDebounceTimer && clearTimeout(this._resizeDebounceTimer), this._resizeDebounceTimer = setTimeout(() => {
        this.fit();
      }, ht));
    }), this._resizeObserver.observe(this._terminal.element)));
  }
}
let D = null;
async function ft() {
  D || (D = await k.load());
}
function ct() {
  if (!D)
    throw new Error(
      `ghostty-web not initialized. Call init() before creating Terminal instances.
Example:
  import { init, Terminal } from "ghostty-web";
  await init();
  const term = new Terminal();

For tests, pass a Ghostty instance directly:
  import { Ghostty, Terminal } from "ghostty-web";
  const ghostty = await Ghostty.load();
  const term = new Terminal({ ghostty });`
    );
  return D;
}
export {
  it as CanvasRenderer,
  E as CellFlags,
  I as DirtyState,
  T as EventEmitter,
  dt as FitAddon,
  k as Ghostty,
  Z as GhosttyTerminal,
  K as InputHandler,
  h as Key,
  G as KeyAction,
  q as KeyEncoder,
  N as KeyEncoderOption,
  tt as LinkDetector,
  C as Mods,
  et as OSC8LinkProvider,
  rt as SelectionManager,
  ut as Terminal,
  st as UrlRegexProvider,
  ct as getGhostty,
  ft as init
};
