// Compiled against the extracted npm tarball, not the source tree.
import { FitAddon, type IDisposable, type ITerminalOptions, Terminal, init } from 'ghostty-web';

const options: ITerminalOptions = { cols: 80, rows: 24, cursorBlink: false };
await init();
const terminal = new Terminal(options);
terminal.loadAddon(new FitAddon());
terminal.open(document.createElement('div'));
const subscription: IDisposable = terminal.onData((data: string) => {
  console.log(data);
});
const binarySubscription: IDisposable = terminal.onBinary((data: string) => {
  const bytes = Uint8Array.from(data, (char) => char.charCodeAt(0));
  console.log(bytes);
});
binarySubscription.dispose();
terminal.write(new Uint8Array([65]), () => {});
terminal.resize(100, 30);
terminal.select(0, 0, 1);
const text: string = terminal.getSelection();
console.log(text, terminal.buffer.active.getLine(0)?.translateToString());
subscription.dispose();
terminal.dispose();
