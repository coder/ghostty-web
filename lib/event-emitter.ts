import type { IDisposable, IEvent } from './interfaces';

export class EventEmitter<T> {
  private listeners: Array<(arg: T) => void> = [];

  get hasListeners(): boolean {
    return this.listeners.length > 0;
  }

  fire(arg: T, shouldContinue?: () => boolean): void {
    // Guarded notifications (resize) use a stable listener snapshot and can
    // stop when a nested mutation supersedes them. Other events retain their
    // existing delivery semantics.
    const listeners = shouldContinue ? [...this.listeners] : this.listeners;
    for (const listener of listeners) {
      if (shouldContinue && !shouldContinue()) break;
      listener(arg);
    }
  }

  event: IEvent<T> = (listener) => {
    this.listeners.push(listener);
    return {
      dispose: () => {
        const index = this.listeners.indexOf(listener);
        if (index >= 0) {
          this.listeners.splice(index, 1);
        }
      },
    };
  };

  dispose(): void {
    this.listeners = [];
  }
}
