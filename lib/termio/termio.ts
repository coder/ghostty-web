/**
 * Browser counterpart of Ghostty termio.Termio / stream-handler mailboxes at
 * 246f7028. Parsing is native. Copied effects are dispatched only after parsing,
 * in FIFO order, never by reentering vt_write from a native callback.
 */
import type { GhosttyTerminal } from '../ghostty';
import type { NativeHostEvent } from '../vt/types';

const FOCUS_REPORT = Object.freeze({ type: 'focus-report' as const });
type Effect = NativeHostEvent | typeof FOCUS_REPORT;

export interface TermioHost {
  disposed(): boolean;
  inputEnabled(): boolean;
  data(data: string): void;
  bell(): void;
  title(title: string): void;
  focusReport(): void;
}

export class Termio {
  private queue: Effect[] = [];
  private head = 0;
  private dispatching = false;
  private suspended = 0;
  private closed = false;

  constructor(
    readonly terminal: GhosttyTerminal,
    private readonly host: TermioHost
  ) {}

  processOutput(data: string | Uint8Array): void {
    const focusWasEnabled = this.terminal.hasFocusEvents();
    this.terminal.write(data);
    this.collect();
    if (!focusWasEnabled && this.terminal.hasFocusEvents()) this.queue.push(FOCUS_REPORT);
    this.dispatch();
  }

  suspend(): void {
    this.suspended++;
  }
  resume(): void {
    this.suspended = Math.max(0, this.suspended - 1);
  }

  private collect(): void {
    for (const event of this.terminal.takeHostEvents()) this.queue.push(event);
  }

  flush(): void {
    if (this.closed || this.host.disposed()) return;
    this.collect();
    this.dispatch();
  }

  private dispatch(): void {
    if (this.dispatching || this.suspended || this.closed) return;
    this.dispatching = true;
    try {
      while (!this.closed && !this.host.disposed() && this.head < this.queue.length) {
        const event = this.queue[this.head++];
        switch (event.type) {
          case 'reply':
            if (this.host.inputEnabled()) this.host.data(event.data);
            break;
          case 'bell':
            this.host.bell();
            break;
          case 'title':
            this.host.title(event.title);
            break;
          case 'focus-report':
            this.host.focusReport();
            break;
        }
      }
    } finally {
      this.dispatching = false;
      if (this.head >= this.queue.length) this.clear();
    }
  }

  clear(): void {
    this.queue = [];
    this.head = 0;
  }
  dispose(): void {
    this.closed = true;
    this.clear();
  }
}
