# ghostty-web

`ghostty-web` is a fully featured web terminal that aims to bring all the benefits of the excellent [ghostty](https://github.com/ghostty-org/ghostty)
project to the web by leveraging its exported WASM module. Like ghostty, `ghostty-web` intends to be fast, feature-rich,
and native. For many use cases it is a drop-in replacement for xterm.js.

## Getting Started

Install the module via npm

```bash
npm install ghostty-web
```
After install, using `ghostty-web` is as simple as

```html
<!doctype html>
<html>
  <body>
    <div id="terminal"></div>
    <script type="module">
      import { Terminal } from 'ghostty-web';
      const term = new Terminal();
      await term.open(document.getElementById('terminal'));
      term.write('Hello from \x1B[1;3;31mghostty-web\x1B[0m $ ');
    </script>
  </body>
</html>
```

## Features

Because `ghostty-web` hooks into Ghotty's WASM module it benefits from the meticulous care put into the project.
Among others, ghostty-web has:

- An xterm.js-compatible API
- Zero runtime dependencies: just ghostty-web and its bundled Ghostty WASM engine.
- Canvas-based rendering (60 FPS)
- Responsive resizing
- Full VT100/ANSI emulation
- Screen + scrollback buffer
- Cursor state + modes
- Robust parser/state machine

## Development 

In order to begin development you'll need:

- [bun](https://bun.com/docs/installation) 
- [zig](https://ziglang.org/download/)

### Building WASM

The library relies on a patch applied on top of Ghostty in order to expose additional functionality not yet implemented in the upstream repo. Building it is as simple as running `bun run build`. 