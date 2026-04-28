/**
 * Tiny WASM trampoline that lets us install a JS callback into the main
 * libghostty-vt module's __indirect_function_table.
 *
 * Why this exists: ghostty_terminal_set(WRITE_PTY, fnPtr) takes a function
 * pointer (a table index in WASM-land). To put a JS function at a given
 * table index we'd normally use `new WebAssembly.Function(...)`, but that's
 * part of the Type Reflection proposal which only Chrome ships — Bun and
 * Node both report `typeof WebAssembly.Function === 'undefined'`.
 *
 * Workaround: instantiate a tiny separate WASM module that imports the
 * JS callback as `env.cb` and exports a wrapper `fwd` with the same
 * GhosttyTerminalWritePtyFn signature (i32, i32, i32, i32) -> nil. The
 * wrapper's exported funcref is portable across modules with compatible
 * funcref tables, so we can add it to the main module's
 * __indirect_function_table and pass that index to terminal_set.
 *
 * The bytes below are the output of:
 *   wat2wasm lib/write_pty_trampoline.wat -o /tmp/trampoline.wasm
 *
 * Source is in write_pty_trampoline.wat — keep both in sync if you edit.
 */
const TRAMPOLINE_BYTES = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x01, 0x60,
  0x04, 0x7f, 0x7f, 0x7f, 0x7f, 0x00, 0x02, 0x0a, 0x01, 0x03, 0x65, 0x6e,
  0x76, 0x02, 0x63, 0x62, 0x00, 0x00, 0x03, 0x02, 0x01, 0x00, 0x07, 0x07,
  0x01, 0x03, 0x66, 0x77, 0x64, 0x00, 0x01, 0x0a, 0x0e, 0x01, 0x0c, 0x00,
  0x20, 0x00, 0x20, 0x01, 0x20, 0x02, 0x20, 0x03, 0x10, 0x00, 0x0b,
]);

export type WritePtyCallback = (
  terminal: number,
  userdata: number,
  dataPtr: number,
  dataLen: number,
) => void;

/**
 * Compile the trampoline once, then instantiate per-Ghostty with the JS
 * callback as the `env.cb` import. Returns the exported `fwd` function
 * which is a `funcref` callable from any WASM module via call_indirect.
 */
let compiled: WebAssembly.Module | null = null;

export function makeWritePtyTrampoline(cb: WritePtyCallback): Function {
  if (!compiled) compiled = new WebAssembly.Module(TRAMPOLINE_BYTES);
  const inst = new WebAssembly.Instance(compiled, { env: { cb } });
  return inst.exports.fwd as Function;
}
