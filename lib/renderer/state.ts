/**
 * Browser counterpart of renderer.State and generic.Renderer.updateFrame at
 * Ghostty 246f7028. JS run-to-completion replaces the native mutex: no await or
 * user callback is allowed between obtaining the visible view and its metadata.
 * This is a frame snapshot, not an independently mutable viewport.
 *
 * A source with `getRenderView()` (a GhosttyTerminal) is drawn from its native
 * visible view and scroll state. Any other `IRenderable` is drawn as given;
 * the renderer stitches its history from the caller's scrollback provider.
 */
import type { IRenderable } from '../renderer';
import type { NativeScrollState } from '../vt/types';

export interface State {
  readonly source: IRenderable;
  readonly live: IRenderable;
  readonly scroll?: NativeScrollState;
}

export function readState(source: IRenderable): State {
  if (source.getRenderView) {
    const live = source.getRenderView();
    return { source, live, scroll: live.getScrollState?.() };
  }
  return { source, live: source };
}
