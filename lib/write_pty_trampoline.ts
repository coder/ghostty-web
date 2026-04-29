/**
 * Tiny WASM trampolines that let us install JS callbacks into the main
 * libghostty-vt module's __indirect_function_table.
 *
 * Why this exists: ghostty_terminal_set / ghostty_sys_set take function
 * pointers (table indices in WASM-land). To put a JS function at a given
 * table index we'd normally use `new WebAssembly.Function(...)`, but
 * that's part of the Type Reflection proposal which only Chrome ships —
 * Bun and Node both report `typeof WebAssembly.Function === 'undefined'`.
 *
 * Workaround: instantiate a tiny separate WASM module that imports JS
 * callbacks (one per signature) and exports matching wrappers. Each
 * exported funcref is portable across modules with compatible funcref
 * tables, so we can add it to the main module's table and pass the
 * index to terminal_set / sys_set.
 *
 * Currently bridged:
 *   WRITE_PTY:  (terminal, userdata, data, len) -> void
 *     For DSR replies, in-band size reports, XTVERSION, etc.
 *   SIZE:       (terminal, userdata, out_size) -> bool
 *     For CSI 14/16/18 t (XTWINOPS) — embedder fills the out_size struct.
 *   DECODE_PNG: (userdata, allocator, data, data_len, out_image) -> bool
 *     For kitty graphics PNG payloads — decoder allocates RGBA via
 *     ghostty_alloc(allocator, len) and fills the 16-byte
 *     GhosttySysImage at out_image.
 *
 * The bytes below are the output of:
 *   wat2wasm lib/write_pty_trampoline.wat -o /tmp/trampoline.wasm
 *
 * Source is in write_pty_trampoline.wat — keep both in sync if you edit.
 */
const TRAMPOLINE_BYTES = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x18, 0x03, 0x60,
  0x04, 0x7f, 0x7f, 0x7f, 0x7f, 0x00, 0x60, 0x03, 0x7f, 0x7f, 0x7f, 0x01,
  0x7f, 0x60, 0x05, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x01, 0x7f, 0x02, 0x36,
  0x03, 0x03, 0x65, 0x6e, 0x76, 0x0c, 0x77, 0x72, 0x69, 0x74, 0x65, 0x5f,
  0x70, 0x74, 0x79, 0x5f, 0x63, 0x62, 0x00, 0x00, 0x03, 0x65, 0x6e, 0x76,
  0x07, 0x73, 0x69, 0x7a, 0x65, 0x5f, 0x63, 0x62, 0x00, 0x01, 0x03, 0x65,
  0x6e, 0x76, 0x0d, 0x64, 0x65, 0x63, 0x6f, 0x64, 0x65, 0x5f, 0x70, 0x6e,
  0x67, 0x5f, 0x63, 0x62, 0x00, 0x02, 0x03, 0x04, 0x03, 0x00, 0x01, 0x02,
  0x07, 0x2d, 0x03, 0x0d, 0x77, 0x72, 0x69, 0x74, 0x65, 0x5f, 0x70, 0x74,
  0x79, 0x5f, 0x66, 0x77, 0x64, 0x00, 0x03, 0x08, 0x73, 0x69, 0x7a, 0x65,
  0x5f, 0x66, 0x77, 0x64, 0x00, 0x04, 0x0e, 0x64, 0x65, 0x63, 0x6f, 0x64,
  0x65, 0x5f, 0x70, 0x6e, 0x67, 0x5f, 0x66, 0x77, 0x64, 0x00, 0x05, 0x0a,
  0x28, 0x03, 0x0c, 0x00, 0x20, 0x00, 0x20, 0x01, 0x20, 0x02, 0x20, 0x03,
  0x10, 0x00, 0x0b, 0x0a, 0x00, 0x20, 0x00, 0x20, 0x01, 0x20, 0x02, 0x10,
  0x01, 0x0b, 0x0e, 0x00, 0x20, 0x00, 0x20, 0x01, 0x20, 0x02, 0x20, 0x03,
  0x20, 0x04, 0x10, 0x02, 0x0b,
]);

export type WritePtyCallback = (
  terminal: number,
  userdata: number,
  dataPtr: number,
  dataLen: number,
) => void;

/**
 * SIZE callback: writes its result into out_size (a 12-byte
 * GhosttySizeReportSize struct: rows@0:u16, cols@2:u16, cell_w@4:u32,
 * cell_h@8:u32) and returns 1 to indicate "responded" or 0 to drop the
 * query.
 */
export type SizeCallback = (
  terminal: number,
  userdata: number,
  outSizePtr: number,
) => number;

/**
 * DECODE_PNG callback: receives PNG bytes at dataPtr / dataLen, decodes
 * to RGBA, allocates a buffer via ghostty_alloc(allocator, rgbaLen),
 * fills the 16-byte GhosttySysImage at outImagePtr (u32 width @ 0,
 * u32 height @ 4, u32 data_ptr @ 8, u32 data_len @ 12), and returns 1
 * on success or 0 to indicate decode failure.
 */
export type DecodePngCallback = (
  userdata: number,
  allocator: number,
  dataPtr: number,
  dataLen: number,
  outImagePtr: number,
) => number;

/**
 * Compile the trampoline once, then instantiate per-Ghostty with the JS
 * callbacks as the `env.*_cb` imports. Returns all three exported
 * wrappers — funcrefs callable from any WASM module via call_indirect.
 */
let compiled: WebAssembly.Module | null = null;

export interface TrampolineExports {
  writePtyFwd: Function;
  sizeFwd: Function;
  decodePngFwd: Function;
}

export function makeCallbackTrampolines(
  writePtyCb: WritePtyCallback,
  sizeCb: SizeCallback,
  decodePngCb: DecodePngCallback,
): TrampolineExports {
  if (!compiled) compiled = new WebAssembly.Module(TRAMPOLINE_BYTES);
  const inst = new WebAssembly.Instance(compiled, {
    env: {
      write_pty_cb: writePtyCb,
      size_cb: sizeCb,
      decode_png_cb: decodePngCb,
    },
  });
  return {
    writePtyFwd: inst.exports.write_pty_fwd as Function,
    sizeFwd: inst.exports.size_fwd as Function,
    decodePngFwd: inst.exports.decode_png_fwd as Function,
  };
}
