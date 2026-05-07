;; Tiny trampolines so we can install JS callbacks into the main wasm
;; module's __indirect_function_table without WebAssembly.Function support
;; (Bun and Node lack it; only modern browsers ship the Type Reflection
;; proposal).
;;
;; Each trampoline imports a JS function from `env` and re-exports a
;; wrapper with the matching libghostty-vt callback signature. The
;; wrapper's exported funcref can be added to the main module's table,
;; where ghostty_terminal_set(OPT_*, idx) wires it up.
;;
;; Callbacks currently bridged:
;;   WRITE_PTY:   (terminal: i32, userdata: i32, data: i32, len: i32) -> nil
;;     Used for DSR replies, in-band size reports, etc.
;;   SIZE:        (terminal: i32, userdata: i32, out_size: i32) -> i32 (bool)
;;     Used for CSI 14/16/18 t responses; embedder fills out_size.
;;   DECODE_PNG:  (userdata: i32, allocator: i32, data: i32, data_len: i32,
;;                 out_image: i32) -> i32 (bool)
;;     Used for kitty graphics PNG payloads. Decoder allocates RGBA via
;;     ghostty_alloc(allocator, len) and fills out_image (16-byte struct
;;     of u32 width, u32 height, u32 data_ptr, u32 data_len).
;;
;; Rebuild after edits:
;;   wat2wasm lib/write_pty_trampoline.wat -o /tmp/trampoline.wasm
;; Then update the byte literal in lib/write_pty_trampoline.ts.
(module
  (type $write_pty_sig (func (param i32 i32 i32 i32)))
  (type $size_sig (func (param i32 i32 i32) (result i32)))
  (type $decode_png_sig (func (param i32 i32 i32 i32 i32) (result i32)))

  (import "env" "write_pty_cb" (func $write_pty_cb (type $write_pty_sig)))
  (import "env" "size_cb" (func $size_cb (type $size_sig)))
  (import "env" "decode_png_cb" (func $decode_png_cb (type $decode_png_sig)))

  (func $write_pty_fwd (export "write_pty_fwd") (type $write_pty_sig)
    local.get 0  local.get 1  local.get 2  local.get 3
    call $write_pty_cb)

  (func $size_fwd (export "size_fwd") (type $size_sig)
    local.get 0  local.get 1  local.get 2
    call $size_cb)

  (func $decode_png_fwd (export "decode_png_fwd") (type $decode_png_sig)
    local.get 0  local.get 1  local.get 2  local.get 3  local.get 4
    call $decode_png_cb))
