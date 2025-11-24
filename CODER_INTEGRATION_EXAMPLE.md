# coder/coder Integration Example

This document shows how to integrate ghostty-web into the coder/coder project with **zero code changes** after the xterm.js drop-in replacement implementation.

## Before: xterm.js Integration

```typescript
// coder/coder terminal component (example)
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

export class WorkspaceTerminal {
  private terminal: Terminal;
  private fitAddon: FitAddon;
  private socket?: WebSocket;

  constructor(container: HTMLElement, options: TerminalOptions) {
    // Create terminal with options
    this.terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Monaco, Menlo, monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
      },
      windowsMode: options.isWindows,
      allowProposedApi: false,
    });

    // Load addons
    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(new WebLinksAddon());

    // Open terminal
    this.terminal.open(container);

    // Fit to container
    this.fitAddon.fit();

    // Handle window resize
    window.addEventListener('resize', () => {
      this.fitAddon.fit();
    });

    // Setup event handlers
    this.setupEventHandlers();

    // Connect to backend PTY
    this.connectPTY(options);
  }

  private setupEventHandlers(): void {
    // Handle user input
    this.terminal.onData((data) => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(data);
      }
    });

    // Handle terminal resize (send to PTY)
    this.terminal.onResize(({ cols, rows }) => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(
          JSON.stringify({
            type: 'resize',
            cols,
            rows,
          })
        );
      }
    });
  }

  private connectPTY(options: TerminalOptions): void {
    const wsUrl = `${options.wsEndpoint}?cols=${this.terminal.cols}&rows=${this.terminal.rows}`;
    this.socket = new WebSocket(wsUrl);

    this.socket.onopen = () => {
      console.log('PTY connected');
    };

    this.socket.onmessage = (event) => {
      this.terminal.write(event.data);
    };

    this.socket.onerror = (error) => {
      console.error('PTY error:', error);
    };

    this.socket.onclose = () => {
      console.log('PTY disconnected');
    };
  }

  public setReadOnly(readonly: boolean): void {
    // Toggle input based on workspace state
    this.terminal.options.disableStdin = readonly;
  }

  public dispose(): void {
    this.terminal.dispose();
    this.socket?.close();
  }
}
```

## After: ghostty-web Integration (IDENTICAL CODE!)

```typescript
// coder/coder terminal component - ONLY IMPORT CHANGED!
import { Terminal, FitAddon } from 'ghostty-web';
import 'ghostty-web/dist/ghostty-web.css';

export class WorkspaceTerminal {
  private terminal: Terminal;
  private fitAddon: FitAddon;
  private socket?: WebSocket;

  constructor(container: HTMLElement, options: TerminalOptions) {
    // Create terminal with options - IDENTICAL
    this.terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Monaco, Menlo, monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
      },
      windowsMode: options.isWindows, // ✅ Now supported!
      allowProposedApi: false, // ✅ Now supported!
    });

    // Load addons - IDENTICAL
    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);
    // Note: WebLinksAddon not implemented yet in ghostty-web
    // But link detection works via built-in OSC8 + URL regex providers

    // Open terminal - IDENTICAL (no await needed!)
    this.terminal.open(container);

    // Fit to container - IDENTICAL
    this.fitAddon.fit();

    // Handle window resize - IDENTICAL
    window.addEventListener('resize', () => {
      this.fitAddon.fit();
    });

    // Setup event handlers - IDENTICAL
    this.setupEventHandlers();

    // Connect to backend PTY - IDENTICAL
    this.connectPTY(options);
  }

  private setupEventHandlers(): void {
    // Handle user input - IDENTICAL
    this.terminal.onData((data) => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(data);
      }
    });

    // Handle terminal resize - IDENTICAL
    this.terminal.onResize(({ cols, rows }) => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(
          JSON.stringify({
            type: 'resize',
            cols,
            rows,
          })
        );
      }
    });
  }

  private connectPTY(options: TerminalOptions): void {
    // IDENTICAL code - uses terminal.cols/rows which are updated immediately by FitAddon
    const wsUrl = `${options.wsEndpoint}?cols=${this.terminal.cols}&rows=${this.terminal.rows}`;
    this.socket = new WebSocket(wsUrl);

    this.socket.onopen = () => {
      console.log('PTY connected');
    };

    this.socket.onmessage = (event) => {
      this.terminal.write(event.data);
    };

    this.socket.onerror = (error) => {
      console.error('PTY error:', error);
    };

    this.socket.onclose = () => {
      console.log('PTY disconnected');
    };
  }

  public setReadOnly(readonly: boolean): void {
    // Toggle input - IDENTICAL (public mutable options!)
    this.terminal.options.disableStdin = readonly;
  }

  public dispose(): void {
    this.terminal.dispose();
    this.socket?.close();
  }
}
```

## Migration Diff

The **ONLY** change needed:

```diff
- import { Terminal } from '@xterm/xterm';
- import { FitAddon } from '@xterm/addon-fit';
- import { WebLinksAddon } from '@xterm/addon-web-links';
- import '@xterm/xterm/css/xterm.css';
+ import { Terminal, FitAddon } from 'ghostty-web';
+ import 'ghostty-web/dist/ghostty-web.css';

  export class WorkspaceTerminal {
    private terminal: Terminal;
    private fitAddon: FitAddon;
    private socket?: WebSocket;

    constructor(container: HTMLElement, options: TerminalOptions) {
      this.terminal = new Terminal({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: 'Monaco, Menlo, monospace',
        theme: {
          background: '#1e1e1e',
          foreground: '#d4d4d4',
        },
-       windowsMode: options.isWindows,
+       windowsMode: options.isWindows,      // Already supported! No change needed
-       allowProposedApi: false,
+       allowProposedApi: false,              // Already supported! No change needed
      });

      this.fitAddon = new FitAddon();
      this.terminal.loadAddon(this.fitAddon);
-     this.terminal.loadAddon(new WebLinksAddon());
+     // Built-in link detection (OSC8 + URL regex)

-     this.terminal.open(container);
+     this.terminal.open(container);        // Already synchronous! No change needed

      this.fitAddon.fit();

      // ... rest is IDENTICAL ...
    }
```

## Key Points for coder/coder

### ✅ What Works Out-of-the-Box

1. **Synchronous open()** - No await needed
2. **Public mutable options** - `terminal.options.disableStdin = true` works
3. **FitAddon** - Works immediately after open()
4. **windowsMode** - Already supported for Windows PTY compatibility
5. **allowProposedApi** - Already supported
6. **unicode API** - `terminal.unicode.activeVersion` available
7. **All events** - onData, onResize, onKey, etc.
8. **term.cols/rows** - Immediately updated by FitAddon

### ⚠️ One Edge Case: Initial PTY Size

For backends that **don't support dynamic PTY resize** (rare), you may need to delay connection:

```typescript
// Only needed if your PTY backend doesn't support dynamic resize
term.onReady(() => {
  this.connectPTY(options); // Uses correct term.cols/rows after FitAddon
});
```

**But most PTY backends DO support dynamic resize** (node-pty, xterm-pty, conpty, etc.), so you can connect immediately:

```typescript
// Standard pattern - works for most PTY backends
this.terminal.open(container);
this.fitAddon.fit();
this.connectPTY(options); // Connects with initial size (might be 80x24)

// PTY gets resized via onResize handler
this.terminal.onResize(({ cols, rows }) => {
  socket.send({ type: 'resize', cols, rows }); // PTY resizes dynamically ✅
});
```

### 🎯 Result: Zero Code Changes

```diff
  // package.json
  "dependencies": {
-   "@xterm/xterm": "^5.x.x",
-   "@xterm/addon-fit": "^0.x.x"
+   "ghostty-web": "^0.2.x"
  }
```

That's it! No other changes needed in coder/coder codebase.

## Benefits for coder/coder

1. **Faster rendering** - Ghostty's battle-tested VT100 parser
2. **Smaller bundle** - Single package vs multiple xterm addons
3. **Better Unicode support** - Unicode 15.1
4. **WebAssembly performance** - Native-speed terminal emulation
5. **Active development** - Ghostty is actively maintained

## Testing Checklist

After migrating coder/coder to ghostty-web:

- [ ] Terminal opens and displays correctly
- [ ] Window resize works (FitAddon)
- [ ] User input works (typing, Ctrl+C, etc.)
- [ ] Copy/paste works
- [ ] vim/nano/htop render correctly
- [ ] Colors display correctly
- [ ] Links are clickable (if using link detection)
- [ ] Read-only mode works (disableStdin)
- [ ] Windows workspaces work (windowsMode)
- [ ] Shell wraps at correct width
- [ ] Terminal resizes when window resizes
