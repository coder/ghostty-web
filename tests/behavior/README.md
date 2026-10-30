# ghostty-web behavior regressions

Run `bun test tests/behavior` (or `bun run test:regression`). These tests instantiate
our `Terminal`, use its real WASM backend and DOM input listeners, and assert
observable results. They do not run a separate upstream implementation.

- `terminal-output.test.ts`: 50 concrete screen/cursor scenarios, each delivered
  whole and fragmented. Fragmented input includes single bytes and mixed packet
  sizes so UTF-8 and escape sequences can cross write boundaries.
- `terminal-interactions.test.ts`: keyboard/PTY bytes, application cursor mode,
  disabled stdin, bracketed paste, three/four-byte UTF-8 and combining text,
  query replies, resize, history navigation,
  selection text, alternate-screen restoration, and listener cleanup on disposal.
- `session.ts`: only session creation, cleanup, and screen-text observation.

Expected output is explicit fixture data, not a snapshot generated from the current
implementation. No test counts, manifests, harness validators, or report-format
checks are treated as behavior coverage.

These tests pass on both the original implementation and the refactor. Additional
cases that need the refactor's APIs or fixes live with that implementation commit.
Canvas pixels and trusted browser interactions are covered by the separate browser
suite in that commit, not by happy-dom.
