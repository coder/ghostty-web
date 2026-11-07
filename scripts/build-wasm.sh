#!/usr/bin/env bash
# Build ghostty-vt.wasm from the unpatched upstream Ghostty commit pinned in
# ghostty-build.json, check it, and publish it (by default into the repo root).
#
# Usage: scripts/build-wasm.sh [--work-dir DIR] [--out-dir DIR]
#                              [--require-verified] [--allow-unverified]
#
#   --work-dir DIR      Source checkout, Zig caches and logs. Default:
#                       $GHOSTTY_WASM_WORK_DIR or <repo>/.wasm-build/work. Must be
#                       empty or created by this script, and outside the checkout
#                       except under <repo>/.wasm-build/.
#   --out-dir DIR       Where ghostty-vt.wasm is written. Default: the repo root.
#   --require-verified  Fail unless the output matches the pinned wasmSha256
#                       (also GHOSTTY_WASM_REQUIRE_VERIFIED=1; CI and releases set it).
#   --allow-unverified  Pin discovery only, NOT FOR RELEASE: build a pin whose
#                       wasmSha256 is null into an --out-dir other than the repo root.
#
# Compiler: the manifest "zigEnv" variable (ZIG_0_16_BIN) or `zig` on PATH, at
# least the manifest "zigVersion". That version reproduces wasmSha256. A newer
# Zig whose output differs publishes an unverified build (local development
# only) unless --require-verified is in effect. The pinned Ghostty source itself
# requires the same major.minor Zig.
#
# Only the pinned commit is fetched (by SHA, depth 1); GHOSTTY_GIT_URL overrides
# the manifest gitUrl. Never touches the ghostty/ submodule or global Git/Zig state.
set -euo pipefail

die() {
  echo "build-wasm: error: $*" >&2
  exit 1
}

log() {
  echo "build-wasm: $*" >&2
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d' ' -f1
  else
    die "neither sha256sum nor shasum is available"
  fi
}

# Succeeds when Zig version $1 is at least $2 (X.Y.Z). $1 may carry a pre-release
# suffix (0.17.0-dev.12+abc); a pre-release sorts before its own X.Y.Z release.
zig_at_least() {
  local have=$1 want=$2 core rest i
  local -a h w
  core=${have%%[-+]*}
  rest=${have#"$core"}
  [[ "$core" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ && "$want" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || return 1
  IFS=. read -r -a h <<<"$core"
  IFS=. read -r -a w <<<"$want"
  for i in 0 1 2; do
    if ((10#${h[i]} > 10#${w[i]})); then return 0; fi
    if ((10#${h[i]} < 10#${w[i]})); then return 1; fi
  done
  [[ "$rest" != -* ]]
}

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
manifest="$repo_root/ghostty-build.json"
command -v git >/dev/null 2>&1 || die "git not found"
js_bin="$(command -v bun || command -v node)" || die "bun or node is required to read ghostty-build.json"

# --- Arguments ---------------------------------------------------------------
work_arg="${GHOSTTY_WASM_WORK_DIR:-}"
out_arg="$repo_root"
allow_unverified=0
require_verified=0
[[ "${GHOSTTY_WASM_REQUIRE_VERIFIED:-0}" != 1 ]] || require_verified=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --work-dir | --out-dir)
      [[ $# -ge 2 && -n "$2" ]] || die "$1 needs a value"
      if [[ "$1" == --work-dir ]]; then work_arg=$2; else out_arg=$2; fi
      shift 2
      ;;
    --allow-unverified) allow_unverified=1 && shift ;;
    --require-verified) require_verified=1 && shift ;;
    -h | --help)
      sed -n '2,/^set -euo pipefail/p' "${BASH_SOURCE[0]}" | sed -e '$d' -e 's/^# \{0,1\}//'
      exit 0
      ;;
    *) die "unknown argument '$1' (see --help)" ;;
  esac
done

# --- Manifest (validated; values are never eval'd) ---------------------------
# shellcheck disable=SC2016 # the JS below is intentionally single-quoted
manifest_lines="$(MANIFEST="$manifest" "$js_bin" -e '
  const m = JSON.parse(require("fs").readFileSync(process.env.MANIFEST, "utf8"));
  const t = m.targets && m.targets["libghostty-vt"];
  const fail = (msg) => { console.error(`ghostty-build.json: ${msg}`); process.exit(2); };
  if (m.schema !== 1 || !t) fail("schema 1 target libghostty-vt missing");
  const get = (k, re, nullable = false) => {
    const v = k in t ? t[k] : m[k];
    if (v === null && nullable) return "";
    if (!re.test(String(v))) fail(`${k} is missing or invalid: ${JSON.stringify(v)}`);
    return String(v);
  };
  const out = [
    ["commit", get("ghosttyCommit", /^[0-9a-f]{40}$/)],
    ["gitUrl", get("gitUrl", /^[A-Za-z0-9+.:\/@_~%-]+$/)],
    ["zigVersion", get("zigVersion", /^\d+\.\d+\.\d+$/)],
    ["zigEnv", get("zigEnv", /^[A-Z][A-Z0-9_]*$/)],
    ["artifact", get("artifact", /^[A-Za-z0-9._-]+\.wasm$/)],
    ["wasmSha256", get("wasmSha256", /^[0-9a-f]{64}$/, true)],
    ["maxWasmBytes", get("maxWasmBytes", /^[1-9]\d*$/)],
  ];
  if (!Array.isArray(t.buildArgs) || t.buildArgs.length === 0) fail("buildArgs missing");
  for (const a of t.buildArgs) {
    if (typeof a !== "string" || !/^[A-Za-z0-9=._+-]+$/.test(a)) fail(`bad build arg ${JSON.stringify(a)}`);
    out.push(["buildArg", a]);
  }
  for (const [k, v] of out) console.log(`${k}=${v}`);
')" || die "invalid $manifest"
build_args=()
while IFS= read -r line; do
  value=${line#*=}
  case "${line%%=*}" in
    commit) commit=$value ;;
    gitUrl) git_url=$value ;;
    zigVersion) zig_version=$value ;;
    zigEnv) zig_env=$value ;;
    artifact) artifact=$value ;;
    wasmSha256) pinned_sha=$value ;;
    maxWasmBytes) max_bytes=$value ;;
    buildArg) build_args+=("$value") ;;
  esac
done <<<"$manifest_lines"
git_url="${GHOSTTY_GIT_URL:-$git_url}"
[[ "$git_url" != *[[:cntrl:]]* ]] || die "GHOSTTY_GIT_URL contains control characters"

if [[ "$allow_unverified" -eq 1 ]]; then
  [[ "$require_verified" -eq 0 ]] ||
    die "--allow-unverified conflicts with --require-verified / GHOSTTY_WASM_REQUIRE_VERIFIED=1"
  [[ -z "$pinned_sha" ]] || die "--allow-unverified is only for pins whose wasmSha256 is null; this pin is verified"
elif [[ -z "$pinned_sha" ]]; then
  die "ghostty-build.json has no wasmSha256 for $commit. For pin discovery only (NOT FOR RELEASE), rerun with --allow-unverified and an --out-dir outside the repo root, review, then record the printed sha256"
fi

# --- Output and work directories ---------------------------------------------
[[ -d "$out_arg" && ! -L "$out_arg" ]] || die "out dir '$out_arg' is not an existing real directory"
out_dir="$(cd "$out_arg" && pwd -P)"
case "$out_dir/" in
  "$repo_root/") [[ "$allow_unverified" -eq 0 ]] || die "--allow-unverified never publishes into the repo root" ;;
  "$repo_root/.wasm-build/"*) ;;
  "$repo_root"/*) die "out dir '$out_dir' is inside the checkout; only the repo root or .wasm-build/ are allowed" ;;
esac

if [[ -z "$work_arg" ]]; then
  mkdir -p "$repo_root/.wasm-build"
  work_arg="$repo_root/.wasm-build/work"
fi
[[ ! -L "$work_arg" ]] || die "work dir '$work_arg' is a symlink; pass the real directory"
work_parent="$(cd "$(dirname "$work_arg")" 2>/dev/null && pwd -P)" ||
  die "parent directory of '$work_arg' does not exist"
work_dir="$work_parent/$(basename "$work_arg")"
case "$work_dir/" in
  / | "${HOME:-/nonexistent}/") die "refusing to use '$work_dir' as the work dir; pass a dedicated directory" ;;
  "$repo_root/.wasm-build/"?*) ;;
  "$repo_root"/*) die "work dir '$work_dir' is inside the checkout; use $repo_root/.wasm-build/<name> or a directory outside it" ;;
esac
# The marker keeps the script from writing into (or deleting from) a directory it doesn't own.
readonly OWNER_MARKER=".ghostty-reference-workdir"
readonly OWNER_TEXT="ghostty-web Ghostty WASM build work dir (scripts/build-wasm.sh)"
if [[ -e "$work_dir/$OWNER_MARKER" ]]; then
  [[ ! -L "$work_dir/$OWNER_MARKER" && "$(cat "$work_dir/$OWNER_MARKER")" == "$OWNER_TEXT" ]] ||
    die "'$work_dir/$OWNER_MARKER' is not a marker written by this script"
elif [[ -d "$work_dir" && -n "$(ls -A "$work_dir")" ]]; then
  die "'$work_dir' is not empty and was not created by this script; pass an empty or new directory"
else
  mkdir -p "$work_dir"
  printf '%s\n' "$OWNER_TEXT" >"$work_dir/$OWNER_MARKER"
fi
# mkdir is atomic, so this is a portable exclusive lock (no flock on macOS).
lock_dir="$work_dir/.lock"
mkdir "$lock_dir" 2>/dev/null ||
  die "another build holds '$lock_dir'; if no build is running, remove that directory"
trap 'rm -rf "$lock_dir"' EXIT

# Keep git deterministic and independent of the caller's global/system config.
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0

# --- Compiler ----------------------------------------------------------------
zig_bin="${!zig_env:-zig}"
if [[ "$zig_bin" == */* ]]; then
  [[ -x "$zig_bin" ]] || die "$zig_env='$zig_bin' is not an executable file"
else
  zig_bin="$(command -v "$zig_bin")" || die "Zig not found; set $zig_env to a Zig $zig_version (or newer) binary"
fi
zig_actual="$("$zig_bin" version)" || die "'$zig_bin version' failed"
[[ "$zig_actual" =~ ^[0-9A-Za-z.+-]+$ ]] || die "'$zig_bin version' printed an unexpected '$zig_actual'"
zig_at_least "$zig_actual" "$zig_version" ||
  die "needs Zig $zig_version or newer (set $zig_env), but '$zig_bin' is $zig_actual"
[[ "$zig_actual" == "$zig_version" ]] ||
  log "using Zig $zig_actual; the pinned wasmSha256 comes from Zig $zig_version, so different output is published as unverified"

# --- Source: the pinned commit, pristine -------------------------------------
src="$work_dir/sources/$commit"
mkdir -p "$work_dir/sources"
if [[ -e "$src" ]]; then
  [[ -d "$src/.git" && ! -L "$src" ]] || die "'$src' exists but is not a git checkout; remove it"
  log "reusing source $commit"
else
  log "fetching $commit from $git_url (depth 1, by SHA)"
  rm -rf "$src.partial"
  git init -q "$src.partial"
  git -C "$src.partial" remote add origin "$git_url"
  git -C "$src.partial" fetch -q --depth=1 --no-tags origin "$commit" || die "could not fetch $commit from $git_url"
  git -C "$src.partial" -c advice.detachedHead=false checkout -q --detach FETCH_HEAD
  mv "$src.partial" "$src"
fi
head="$(git -C "$src" rev-parse --verify 'HEAD^{commit}' 2>/dev/null || true)"
[[ "$head" == "$commit" ]] || die "'$src' is at '${head:-<none>}', not $commit"
[[ -z "$(git -C "$src" status --porcelain --untracked-files=all)" ]] ||
  die "source '$src' has local modifications or untracked files; refusing to touch them"
min_zig="$(sed -n 's/^[[:space:]]*\.minimum_zig_version[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "$src/build.zig.zon")"
[[ "$min_zig" == "$zig_version" ]] ||
  die "build.zig.zon minimum_zig_version is '$min_zig', but ghostty-build.json zigVersion is $zig_version"

# --- Build -------------------------------------------------------------------
stage="$work_dir/stage"
cache="$work_dir/zig-cache/$zig_actual"
logf="$work_dir/logs/build.log"
rm -rf "$stage"
mkdir -p "$work_dir/logs" "$cache/global" "$cache/local"
log "zig $zig_actual build ${build_args[*]} (log: $logf)"
if ! (
  cd "$src" &&
    ZIG_GLOBAL_CACHE_DIR="$cache/global" ZIG_LOCAL_CACHE_DIR="$cache/local" \
      "$zig_bin" build "${build_args[@]}" \
      --prefix "$stage" --cache-dir "$cache/local" --global-cache-dir "$cache/global"
) >"$logf" 2>&1; then
  tail -n 40 "$logf" >&2 || true
  hint=""
  [[ "${zig_actual%%[-+]*}" == "${zig_version%.*}".* ]] ||
    hint="; the pinned Ghostty source needs Zig ${zig_version%.*}.x, so use Zig $zig_version"
  die "zig build failed (full log: $logf)$hint"
fi
[[ -z "$(git -C "$src" status --porcelain --untracked-files=all)" ]] || die "source is not pristine after the build"

# --- Check -------------------------------------------------------------------
wasm="$stage/bin/ghostty-vt.wasm"
[[ -s "$wasm" && ! -L "$wasm" ]] || die "build succeeded but '$wasm' is missing"
[[ "$(head -c 4 "$wasm" | od -An -tx1 | tr -d ' \n')" == "0061736d" ]] || die "'$wasm' is not a WebAssembly binary"
bytes="$(wc -c <"$wasm" | tr -d ' ')"
[[ "$bytes" -le "$max_bytes" ]] || die "WASM is $bytes bytes, over the reviewed budget maxWasmBytes=$max_bytes"
sha="$(sha256_of "$wasm")"
verified=false
if [[ -z "$pinned_sha" ]]; then
  log "WARNING: UNVERIFIED pin build (--allow-unverified), NOT FOR RELEASE; built $sha"
elif [[ "$sha" == "$pinned_sha" ]]; then
  verified=true
elif [[ "$zig_actual" == "$zig_version" ]]; then
  die "WASM sha256 $sha != ghostty-build.json wasmSha256 $pinned_sha (non-reproducible build or unreviewed change)"
elif [[ "$require_verified" -eq 1 ]]; then
  die "Zig $zig_actual built sha256 $sha, not the pinned $pinned_sha from Zig $zig_version; a verified build (--require-verified / GHOSTTY_WASM_REQUIRE_VERIFIED=1) needs Zig $zig_version"
else
  log "WARNING: Zig $zig_actual built sha256 $sha, not the pinned $pinned_sha from Zig $zig_version; publishing an UNVERIFIED build (fine for local development, NOT FOR RELEASE; use Zig $zig_version to reproduce the pin)"
fi

# --- Publish (atomically) ----------------------------------------------------
dest="$out_dir/$artifact"
[[ ! -L "$dest" && ! -d "$dest" ]] || die "'$dest' is a symlink or directory; refusing to replace it"
cp "$wasm" "$dest.partial.$$"
mv -f "$dest.partial.$$" "$dest"
rm -rf "$stage"
log "published $dest ($bytes bytes, sha256 $sha, Zig $zig_actual, verified=$verified)"
