;; Tiny trampoline so we can install a JS callback into the main wasm
;; module's __indirect_function_table without WebAssembly.Function support
;; (Bun and Node lack it; only modern browsers ship the Type Reflection
;; proposal).
;;
;; This module imports a JS function `env.cb` and re-exports a wrapper
;; with the GhosttyTerminalWritePtyFn signature
;; (terminal: i32, userdata: i32, data: i32, len: i32). The wrapper's
;; exported funcref can be added to the main module's table, where
;; ghostty_terminal_set(WRITE_PTY, idx) wires it up.
;;
;; Rebuild after edits:
;;   wat2wasm lib/write_pty_trampoline.wat -o lib/write_pty_trampoline.wasm
;; Then update the byte literal in lib/write_pty_trampoline.ts with the
;; new content.
(module
  (type $sig (func (param i32 i32 i32 i32)))
  (import "env" "cb" (func $cb (type $sig)))
  (func $fwd (export "fwd") (type $sig)
    local.get 0
    local.get 1
    local.get 2
    local.get 3
    call $cb))
