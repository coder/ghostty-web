#!/usr/bin/env bash
# Build Ghostty WASM engines from the pins in ghostty-build.json.
#
# Usage:
#   scripts/build-wasm.sh [TARGET...] [--work-dir DIR] [--out-dir DIR]
#                         [--bundle DIR] [--expect-sha256 HEX] [--allow-unverified]
#
# TARGET: libghostty-vt (default; the shipping engine), legacy, or all.
#
#   --work-dir DIR   Owned build directory (sources, Zig caches, staging, logs).
#                    Default: $GHOSTTY_WASM_WORK_DIR or <repo>/.regression-reference/wasm-build.
#                    Must be missing, empty, or previously created by this script
#                    (.ghostty-reference-workdir marker); outside the checkout except
#                    <repo>/.regression-reference/.
#   --out-dir DIR    Where each target's artifact (manifest "artifact") is published,
#                    atomically and only after every check passed. Default: the repo
#                    root (ghostty-vt.wasm / ghostty-vt-legacy.wasm), which is what
#                    `bun run build:wasm` and the test suites consume.
#   --bundle DIR     Instead of --out-dir, publish DIR (a direct child of the work dir)
#                    atomically with <artifact>, build-info.json and the target's env
#                    file. Single target only.
#   --expect-sha256  Additionally require this sha256 (single target only).
#   --allow-unverified
#                    Pin discovery only, NOT FOR RELEASE: build a target whose manifest
#                    wasmSha256 is null. Single target; needs --bundle or an explicit
#                    --out-dir that is not the repo root. Marked unverified in
#                    build-info.json ("verified": false) and <PREFIX>_WASM_VERIFIED=0.
#
# Compilers: each target's manifest "zigEnv" variable (ZIG_0_16_BIN, ZIG_0_15_BIN)
# or `zig` on PATH; the version must equal the manifest "zigVersion" exactly.
# GHOSTTY_GIT_URL overrides the manifest gitUrl (it must serve the pinned SHA).
#
# Never touches the ghostty/ submodule, global Git config or global Zig caches.
# Only the pinned commits are fetched (by SHA, depth 1); there is no "latest" mode.
# The manifest wasmSha256 must match the build exactly. A null wasmSha256 (an
# unverified pin) is refused unless --allow-unverified is given explicitly; the
# reference lane always refuses it.
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

json_string() {
  local s=$1
  [[ "$s" != *[[:cntrl:]]* ]] || die "cannot encode control characters in build-info.json"
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  printf '"%s"' "$s"
}

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd "$script_dir/.." && pwd -P)"
manifest="$repo_root/ghostty-build.json"
[[ -f "$manifest" ]] || die "missing $manifest"
command -v git >/dev/null 2>&1 || die "git not found"
if command -v bun >/dev/null 2>&1; then
  js_bin="$(command -v bun)"
elif command -v node >/dev/null 2>&1; then
  js_bin="$(command -v node)"
else
  die "bun or node is required to read ghostty-build.json"
fi

# --- Arguments ---------------------------------------------------------------
targets=()
work_arg="${GHOSTTY_WASM_WORK_DIR:-}"
out_arg=""
bundle_arg=""
expect_sha=""
allow_unverified=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --work-dir | --out-dir | --bundle | --expect-sha256)
      [[ $# -ge 2 && -n "$2" ]] || die "$1 needs a value"
      case "$1" in
        --work-dir) work_arg=$2 ;;
        --out-dir) out_arg=$2 ;;
        --bundle) bundle_arg=$2 ;;
        --expect-sha256) expect_sha=$2 ;;
      esac
      shift 2
      ;;
    --allow-unverified) allow_unverified=1 && shift ;;
    -h | --help)
      sed -n '2,37p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    all) targets+=(libghostty-vt legacy) && shift ;;
    libghostty-vt | legacy) targets+=("$1") && shift ;;
    *) die "unknown argument '$1' (see --help)" ;;
  esac
done
[[ ${#targets[@]} -gt 0 ]] || targets=(libghostty-vt)
unique=()
for t in libghostty-vt legacy; do
  for requested in "${targets[@]}"; do
    if [[ "$requested" == "$t" ]]; then
      unique+=("$t")
      break
    fi
  done
done
targets=("${unique[@]}")
[[ -z "$bundle_arg" || -z "$out_arg" ]] || die "--bundle and --out-dir are exclusive"
if [[ ${#targets[@]} -gt 1 ]]; then
  [[ -z "$bundle_arg" && -z "$expect_sha" ]] || die "--bundle/--expect-sha256 need a single target"
fi
[[ -z "$expect_sha" || "$expect_sha" =~ ^[0-9a-f]{64}$ ]] || die "--expect-sha256 must be 64 lowercase hex digits"
if [[ "$allow_unverified" -eq 1 ]]; then
  [[ ${#targets[@]} -eq 1 ]] || die "--allow-unverified needs a single target"
  [[ -n "$bundle_arg" || -n "$out_arg" ]] ||
    die "--allow-unverified needs --bundle or an explicit --out-dir (never the default repo root)"
fi

# --- Work dir: resolve, ownership, lock --------------------------------------
if [[ -z "$work_arg" ]]; then
  mkdir -p "$repo_root/.regression-reference"
  work_arg="$repo_root/.regression-reference/wasm-build"
fi
[[ ! -L "$work_arg" ]] || die "work dir '$work_arg' is a symlink; pass the real directory"
work_parent="$(cd "$(dirname "$work_arg")" 2>/dev/null && pwd -P)" ||
  die "parent directory of '$work_arg' does not exist"
work_dir="$work_parent/$(basename "$work_arg")"
[[ ! -e "$work_dir" || -d "$work_dir" ]] || die "work dir '$work_dir' exists but is not a directory"
case "$work_dir/" in
  / | "${HOME:-/nonexistent}/")
    die "refusing to use '$work_dir' as the work dir; pass a dedicated directory"
    ;;
  "$repo_root/.regression-reference/"?*) ;;
  "$repo_root"/*)
    die "work dir '$work_dir' is inside the ghostty-web checkout; use $repo_root/.regression-reference/<name> or a directory outside the checkout"
    ;;
esac

readonly OWNER_MARKER=".ghostty-reference-workdir"
readonly OWNER_TEXT="ghostty-web Ghostty WASM build work dir (scripts/build-wasm.sh)"
readonly OWNER_TEXT_V1="ghostty-web scripts/build-reference-wasm.sh work dir"
lock_dir="$work_dir/.lock"
if [[ -d "$work_dir" && ! -f "$work_dir/$OWNER_MARKER" ]]; then
  [[ -z "$(ls -A "$work_dir")" ]] ||
    die "'$work_dir' is not empty and has no $OWNER_MARKER marker; refusing to write into a directory this script does not own"
fi
mkdir -p "$work_dir"
if [[ -L "$work_dir/$OWNER_MARKER" ]]; then
  die "'$work_dir/$OWNER_MARKER' is not a marker written by this script"
elif [[ -e "$work_dir/$OWNER_MARKER" ]]; then
  marker="$(cat "$work_dir/$OWNER_MARKER")"
  [[ "$marker" == "$OWNER_TEXT" || "$marker" == "$OWNER_TEXT_V1" ]] ||
    die "'$work_dir/$OWNER_MARKER' is not a marker written by this script"
else
  printf '%s\n' "$OWNER_TEXT" >"$work_dir/$OWNER_MARKER"
fi
for component in sources zig-cache stage logs meta out out.partial build.log source source.partial \
  zig-global-cache zig-local-cache staging .lock; do
  [[ ! -L "$work_dir/$component" ]] || die "'$work_dir/$component' is a symlink; refusing to use it"
done
# mkdir is atomic, so this is a portable exclusive lock (no flock on macOS).
mkdir "$lock_dir" 2>/dev/null ||
  die "another build holds '$lock_dir'; if no build is running, remove that directory"
cleanup_actions=()
cleanup() {
  local action
  for action in "${cleanup_actions[@]+"${cleanup_actions[@]}"}"; do eval "$action" || true; done
  rm -rf "$lock_dir"
}
trap cleanup EXIT

# --- Output destination ------------------------------------------------------
if [[ -n "$bundle_arg" ]]; then
  [[ ! -L "$bundle_arg" ]] || die "bundle '$bundle_arg' is a symlink"
  bundle_parent="$(cd "$(dirname "$bundle_arg")" 2>/dev/null && pwd -P)" ||
    die "parent directory of bundle '$bundle_arg' does not exist"
  bundle_dir="$bundle_parent/$(basename "$bundle_arg")"
  [[ "$bundle_parent" == "$work_dir" ]] || die "bundle '$bundle_dir' must be a direct child of the work dir"
  case "$(basename "$bundle_dir")" in
    sources | zig-cache | stage | logs | meta | .lock | "$OWNER_MARKER" | *.partial)
      die "bundle name '$(basename "$bundle_dir")' is reserved"
      ;;
  esac
  [[ ! -L "$bundle_dir.partial" ]] || die "'$bundle_dir.partial' is a symlink"
else
  out_arg="${out_arg:-$repo_root}"
  [[ -d "$out_arg" && ! -L "$out_arg" ]] || die "out dir '$out_arg' is not an existing real directory"
  out_dir="$(cd "$out_arg" && pwd -P)"
  [[ "$allow_unverified" -eq 0 || "$out_dir" != "$repo_root" ]] ||
    die "--allow-unverified never publishes into the repo root; pass another --out-dir"
  case "$out_dir/" in
    "$repo_root/" | "$repo_root/.regression-reference/"*) ;;
    "$repo_root"/*) die "out dir '$out_dir' is inside the checkout; only the repo root or .regression-reference/ are allowed" ;;
  esac
fi

# Keep git deterministic and independent of the caller's global/system config.
export GIT_CONFIG_NOSYSTEM=1
export GIT_CONFIG_GLOBAL=/dev/null
export GIT_TERMINAL_PROMPT=0

# --- Manifest ----------------------------------------------------------------
# Emits validated `key=value` lines for one target (no eval of manifest data).
read_manifest() {
  # shellcheck disable=SC2016 # the JS below is intentionally single-quoted
  MANIFEST="$manifest" TARGET="$1" "$js_bin" -e '
    const fs = require("fs");
    const m = JSON.parse(fs.readFileSync(process.env.MANIFEST, "utf8"));
    const t = m.targets && m.targets[process.env.TARGET];
    const fail = (msg) => { console.error(`ghostty-build.json: ${msg}`); process.exit(2); };
    if (m.schema !== 1 || !t) fail(`schema 1 target ${process.env.TARGET} missing`);
    const want = (k, re, nullable = false) => {
      const v = t[k] === undefined ? m[k] : t[k];
      if (v === null && nullable) return "";
      if (typeof v !== "string" && typeof v !== "number") fail(`${k} missing`);
      if (!re.test(String(v))) fail(`${k} has an invalid value: ${JSON.stringify(v)}`);
      return String(v);
    };
    const out = [
      ["commit", want("ghosttyCommit", /^[0-9a-f]{40}$/)],
      ["gitUrl", want("gitUrl", /^[A-Za-z0-9+.:\/@_~%-]+$/)],
      ["zigVersion", want("zigVersion", /^\d+\.\d+\.\d+$/)],
      ["zigEnv", want("zigEnv", /^[A-Z][A-Z0-9_]*$/)],
      ["patch", want("patch", /^patches\/[A-Za-z0-9._\/-]+\.patch$/, true)],
      ["patchSha256", want("patchSha256", /^[0-9a-f]{64}$/, true)],
      ["artifact", want("artifact", /^[A-Za-z0-9._-]+\.wasm$/)],
      ["wasmSha256", want("wasmSha256", /^[0-9a-f]{64}$/, true)],
      ["maxWasmBytes", want("maxWasmBytes", /^[1-9]\d*$/)],
      ["envPrefix", want("envPrefix", /^[A-Z][A-Z0-9_]*$/)],
      ["envFile", want("envFile", /^[A-Za-z0-9._-]+\.env$/)],
    ];
    if (Boolean(out[4][1]) !== Boolean(out[5][1])) fail("patch and patchSha256 go together");
    if (!Array.isArray(t.buildArgs) || t.buildArgs.length === 0) fail("buildArgs missing");
    for (const a of t.buildArgs) {
      if (typeof a !== "string" || !/^[A-Za-z0-9=._+-]+$/.test(a)) fail(`bad build arg ${JSON.stringify(a)}`);
      out.push(["buildArg", a]);
    }
    for (const [k, v] of out) console.log(`${k}=${v}`);
  '
}

# Per-target state, set by load_target.
load_target() {
  t_name=$1
  t_commit="" t_git_url="" t_zig_version="" t_zig_env="" t_patch="" t_patch_sha=""
  t_artifact="" t_wasm_sha="" t_max_bytes="" t_env_prefix="" t_env_file=""
  t_build_args=()
  local lines key value
  lines="$(read_manifest "$t_name")" || die "invalid manifest entry for $t_name"
  while IFS= read -r line; do
    key=${line%%=*}
    value=${line#*=}
    case "$key" in
      commit) t_commit=$value ;;
      gitUrl) t_git_url=$value ;;
      zigVersion) t_zig_version=$value ;;
      zigEnv) t_zig_env=$value ;;
      patch) t_patch=$value ;;
      patchSha256) t_patch_sha=$value ;;
      artifact) t_artifact=$value ;;
      wasmSha256) t_wasm_sha=$value ;;
      maxWasmBytes) t_max_bytes=$value ;;
      envPrefix) t_env_prefix=$value ;;
      envFile) t_env_file=$value ;;
      buildArg) t_build_args+=("$value") ;;
    esac
  done <<<"$lines"
  t_git_url="${GHOSTTY_GIT_URL:-$t_git_url}"
  [[ "$t_git_url" != *[[:cntrl:]]* ]] || die "GHOSTTY_GIT_URL contains control characters"
}

resolve_zig() {
  local requested="${!t_zig_env:-zig}" version
  if [[ "$requested" == */* ]]; then
    [[ -x "$requested" ]] || die "$t_zig_env='$requested' is not an executable file"
    t_zig_bin=$requested
  else
    command -v "$requested" >/dev/null 2>&1 ||
      die "Zig not found for $t_name; set $t_zig_env to a Zig $t_zig_version binary"
    t_zig_bin="$(command -v "$requested")"
  fi
  version="$("$t_zig_bin" version)" || die "'$t_zig_bin version' failed"
  [[ "$version" == "$t_zig_version" ]] ||
    die "$t_name needs Zig $t_zig_version (set $t_zig_env), but '$t_zig_bin' is $version"
}

# Fetch (by SHA) or verify the pinned source; leaves it pristine.
prepare_source() {
  local src="$work_dir/sources/$t_commit" tmp head marker="$work_dir/sources/$t_commit.patch-applied"
  t_src=$src
  mkdir -p "$work_dir/sources"
  [[ ! -L "$src" && ! -L "$src.partial" && ! -L "$marker" ]] || die "symlink under '$work_dir/sources'"
  if [[ -e "$src" ]]; then
    [[ -d "$src/.git" ]] || die "'$src' exists but is not a git checkout; remove it"
    log "$t_name: reusing source $t_commit"
  else
    log "$t_name: fetching $t_commit from $t_git_url (depth 1, by SHA)"
    tmp="$src.partial"
    rm -rf "$tmp"
    git init -q "$tmp"
    git -C "$tmp" remote add origin "$t_git_url"
    git -C "$tmp" fetch -q --depth=1 --no-tags origin "$t_commit" ||
      die "could not fetch $t_commit from $t_git_url"
    git -C "$tmp" -c advice.detachedHead=false checkout -q --detach FETCH_HEAD
    mv "$tmp" "$src"
  fi
  head="$(git -C "$src" rev-parse --verify 'HEAD^{commit}' 2>/dev/null || true)"
  [[ "$head" == "$t_commit" ]] || die "'$src' is at '${head:-<none>}', not $t_commit"
  # Recover from an interrupted patched build: only our own recorded patch is undone.
  if [[ -n "$(git -C "$src" status --porcelain --untracked-files=all)" && -f "$marker" ]]; then
    local recorded
    recorded="$(cat "$marker")"
    [[ -n "$t_patch" && "$recorded" == "$t_patch_sha" ]] ||
      die "'$src' has changes from another patch ($recorded); remove the source dir"
    git -C "$src" apply -R --check --whitespace=nowarn "$repo_root/$t_patch" ||
      die "'$src' has local changes beyond the recorded patch; refusing to discard them"
    git -C "$src" apply -R --whitespace=nowarn "$repo_root/$t_patch"
    rm -f "$marker"
    log "$t_name: reverted the patch left by an interrupted build"
  fi
  [[ -z "$(git -C "$src" status --porcelain --untracked-files=all)" ]] ||
    die "source '$src' has local modifications or untracked files; refusing to touch them"
  rm -f "$marker"
  t_tree="$(git -C "$src" rev-parse 'HEAD^{tree}')"
  local min_zig
  min_zig="$(sed -n 's/^[[:space:]]*\.minimum_zig_version[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "$src/build.zig.zon")"
  [[ "$min_zig" == "$t_zig_version" ]] ||
    die "$t_name: build.zig.zon minimum_zig_version is '$min_zig', expected $t_zig_version"
}

apply_patch() {
  [[ -n "$t_patch" ]] || return 0
  local file="$repo_root/$t_patch" marker="$work_dir/sources/$t_commit.patch-applied" actual
  [[ -f "$file" && ! -L "$file" ]] || die "patch '$t_patch' is missing"
  actual="$(sha256_of "$file")"
  [[ "$actual" == "$t_patch_sha" ]] ||
    die "patch '$t_patch' sha256 is $actual; ghostty-build.json expects $t_patch_sha"
  git -C "$t_src" apply --check --whitespace=nowarn "$file" || die "patch '$t_patch' does not apply to $t_commit"
  printf '%s\n' "$t_patch_sha" >"$marker"
  git -C "$t_src" apply --whitespace=nowarn "$file"
  t_patched_status="$(git -C "$t_src" status --porcelain --untracked-files=all)"
  cleanup_actions+=("revert_patch $(printf '%q ' "$t_src" "$file" "$marker")")
}

revert_patch() {
  local src=$1 file=$2 marker=$3
  [[ -f "$marker" ]] || return 0
  git -C "$src" apply -R --whitespace=nowarn "$file" && rm -f "$marker"
}

build_target() {
  load_target "$1"
  if [[ -z "$t_wasm_sha" && "$allow_unverified" -eq 0 ]]; then
    die "$t_name: ghostty-build.json has no verified wasmSha256 (null) for $t_commit; refusing to build an unverified pin. For pin discovery only (NOT FOR RELEASE) rerun with --allow-unverified and an --out-dir or --bundle outside the repo root, review, then record the hash"
  fi
  if [[ -n "$t_wasm_sha" && "$allow_unverified" -eq 1 ]]; then
    die "$t_name: --allow-unverified is only for pins whose wasmSha256 is null; this pin is verified"
  fi
  resolve_zig
  prepare_source
  if [[ -n "$bundle_arg" ]]; then
    # Toolchain and source are verified; never leave an older bundle that could
    # be mistaken for this run.
    rm -rf "$bundle_dir" "$bundle_dir.partial"
  fi

  t_stage="$work_dir/stage/$t_name"
  local cache="$work_dir/zig-cache/$t_zig_version" logf="$work_dir/logs/$t_name.log" start_s
  mkdir -p "$work_dir/stage" "$work_dir/logs" "$cache/global" "$cache/local" "$work_dir/meta"
  rm -rf "$t_stage"
  apply_patch
  log "$t_name: zig $t_zig_version build ${t_build_args[*]} (log: $logf)"
  start_s="$(date +%s)"
  if ! (
    cd "$t_src" &&
      ZIG_GLOBAL_CACHE_DIR="$cache/global" ZIG_LOCAL_CACHE_DIR="$cache/local" \
        "$t_zig_bin" build "${t_build_args[@]}" \
        --prefix "$t_stage" --cache-dir "$cache/local" --global-cache-dir "$cache/global"
  ) >"$logf" 2>&1; then
    tail -n 40 "$logf" >&2 || true
    die "$t_name: zig build failed (full log: $logf)"
  fi
  t_seconds="$(($(date +%s) - start_s))"

  if [[ -n "$t_patch" ]]; then
    [[ "$(git -C "$t_src" status --porcelain --untracked-files=all)" == "$t_patched_status" ]] ||
      die "$t_name: the build changed source files beyond the patch"
    revert_patch "$t_src" "$repo_root/$t_patch" "$work_dir/sources/$t_commit.patch-applied"
  fi
  [[ -z "$(git -C "$t_src" status --porcelain --untracked-files=all)" ]] ||
    die "$t_name: source is not pristine after the build"

  t_wasm="$t_stage/bin/ghostty-vt.wasm"
  [[ -s "$t_wasm" && ! -L "$t_wasm" ]] || die "$t_name: build succeeded but '$t_wasm' is missing"
  local magic
  magic="$(head -c 4 "$t_wasm" | od -An -tx1 | tr -d ' \n')"
  [[ "$magic" == "0061736d" ]] || die "$t_name: '$t_wasm' is not a WebAssembly binary"
  t_bytes="$(wc -c <"$t_wasm" | tr -d ' ')"
  [[ "$t_bytes" -le "$t_max_bytes" ]] ||
    die "$t_name: WASM is $t_bytes bytes, over the reviewed budget maxWasmBytes=$t_max_bytes"
  t_sha="$(sha256_of "$t_wasm")"
  if [[ -n "$t_wasm_sha" && "$t_sha" != "$t_wasm_sha" ]]; then
    die "$t_name: WASM sha256 $t_sha != ghostty-build.json wasmSha256 $t_wasm_sha (non-reproducible build or unreviewed change)"
  fi
  if [[ -n "$expect_sha" && "$t_sha" != "$expect_sha" ]]; then
    die "$t_name: WASM sha256 $t_sha != expected $expect_sha"
  fi
  t_verified=true
  if [[ -z "$t_wasm_sha" ]]; then
    t_verified=false
    log "$t_name: WARNING: UNVERIFIED pin build (--allow-unverified), NOT FOR RELEASE; built $t_sha"
  fi

  t_info="$work_dir/meta/$t_name.build-info.json"
  local patch_json="null" patch_sha_json="null" build_args_json="" arg
  if [[ -n "$t_patch" ]]; then
    patch_json="$(json_string "$t_patch")"
    patch_sha_json="$(json_string "$t_patch_sha")"
  fi
  for arg in "${t_build_args[@]}"; do build_args_json+="${build_args_json:+, }$(json_string "$arg")"; done
  cat >"$t_info.partial" <<EOF
{
  "target": $(json_string "$t_name"),
  "ghosttyCommit": "$t_commit",
  "ghosttyTree": "$t_tree",
  "gitUrl": $(json_string "$t_git_url"),
  "zigVersion": "$t_zig_version",
  "buildArgs": [$build_args_json],
  "patch": $patch_json,
  "patchSha256": $patch_sha_json,
  "artifact": $(json_string "$t_artifact"),
  "wasmSha256": "$t_sha",
  "wasmBytes": $t_bytes,
  "manifestWasmSha256": $([[ -n "$t_wasm_sha" ]] && json_string "$t_wasm_sha" || echo null),
  "verified": $t_verified,
  "buildSeconds": $t_seconds
}
EOF
  mv -f "$t_info.partial" "$t_info"
}

# --- Build every target, then publish ----------------------------------------
built=()
for target in "${targets[@]}"; do
  build_target "$target"
  built+=("$t_name|$t_wasm|$t_artifact|$t_sha|$t_bytes|$t_commit|$t_env_prefix|$t_env_file|$t_info|$t_zig_version|$t_verified")
done

for entry in "${built[@]}"; do
  IFS='|' read -r name wasm artifact sha bytes commit prefix envfile info zigv verified <<<"$entry"
  verified_flag=1
  [[ "$verified" == true ]] || verified_flag=0
  if [[ -n "$bundle_arg" ]]; then
    tmp="$bundle_dir.partial"
    rm -rf "$tmp"
    mkdir -p "$tmp"
    cp "$wasm" "$tmp/$artifact"
    cp "$info" "$tmp/build-info.json"
    # Shell-quoted (bash `printf %q`) so paths with spaces source safely.
    {
      printf '%s_COMMIT=%q\n' "$prefix" "$commit"
      printf '%s_WASM=%q\n' "$prefix" "$bundle_dir/$artifact"
      printf '%s_WASM_SHA256=%q\n' "$prefix" "$sha"
      printf '%s_WASM_VERIFIED=%s\n' "$prefix" "$verified_flag"
    } >"$tmp/$envfile"
    mv "$tmp" "$bundle_dir"
    published="$bundle_dir/$artifact"
    cat "$bundle_dir/$envfile"
  else
    dest="$out_dir/$artifact"
    [[ ! -L "$dest" && ! -d "$dest" ]] || die "'$dest' is a symlink or directory; refusing to replace it"
    cp "$wasm" "$dest.partial.$$"
    mv -f "$dest.partial.$$" "$dest"
    published=$dest
    printf '%s_COMMIT=%q\n%s_WASM=%q\n%s_WASM_SHA256=%q\n%s_WASM_VERIFIED=%s\n' \
      "$prefix" "$commit" "$prefix" "$published" "$prefix" "$sha" "$prefix" "$verified_flag"
  fi
  echo "${prefix}_WASM_BYTES=$bytes"
  echo "${prefix}_BUILD_INFO=$info"
  log "$name: published $published ($bytes bytes, sha256 $sha, Zig $zigv)"
done
rm -rf "$work_dir/stage"
