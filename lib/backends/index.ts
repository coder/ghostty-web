/**
 * Engine detection. A module exporting `ghostty_type_json` is a libghostty-vt
 * build and must pass strict validation (malformed builds throw); anything
 * else must provide the legacy patched API. Never falls back between engines.
 */
import { LegacyBackend } from './legacy';
import { NativeBackend } from './native';
import { NativeAbi, hasNativeManifest } from './native-abi';
import { BACKEND_KINDS, type BackendKind, type RawExports, type VtBackend } from './types';

export type { BackendKind, GhosttyLoadOptions } from './types';

/** One backend per exports object, so facades built from the same instance share it. */
const backends = new WeakMap<object, VtBackend>();

export function backendFor(exports: RawExports, required?: BackendKind): VtBackend {
  if (required !== undefined && !BACKEND_KINDS.includes(required)) {
    throw new Error(
      `Unknown Ghostty backend '${String(required)}'; expected ${BACKEND_KINDS.join(' or ')}`
    );
  }
  if (!exports || typeof exports !== 'object') {
    throw new Error('Ghostty WASM exports are missing');
  }
  let backend = backends.get(exports);
  if (!backend) {
    backend = hasNativeManifest(exports)
      ? new NativeBackend(new NativeAbi(exports))
      : new LegacyBackend(exports);
    backends.set(exports, backend);
  }
  if (required !== undefined && backend.kind !== required) {
    throw new Error(`Ghostty WASM is a '${backend.kind}' build, but '${required}' was required`);
  }
  return backend;
}
