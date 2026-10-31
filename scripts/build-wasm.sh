#!/usr/bin/env bash
# Build the unpatched upstream libghostty-vt WASM from the pin in ghostty-build.json.
#
# Usage:
#   scripts/build-wasm.sh [libghostty-vt] [--work-dir DIR] [--out-dir DIR]
#                         [--bundle DIR] [--expect-sha256 HEX] [--allow-unverified]
#                         [--require-verified]
#
# libghostty-vt is the only target (the manifest's single entry); naming it is optional.
#
#   --work-dir DIR   Owned build directory (sources, Zig caches, staging, logs).
#                    Default: $GHOSTTY_WASM_WORK_DIR or <repo>/.wasm-build/work.
#                    Must be missing, empty, or previously created by this script
#                    (.ghostty-reference-workdir marker); outside the checkout except
#                    <repo>/.wasm-build/.
#   --out-dir DIR    Where the artifact (manifest "artifact") is published, atomically
#                    and only after every check passed. Default: the repo root
#                    (ghostty-vt.wasm), which is what `bun run build:wasm` and the
#                    test suites consume.
#   --bundle DIR     Instead of --out-dir, publish DIR (a direct child of the work dir)
#                    atomically with <artifact>, build-info.json and the env file.
#   --expect-sha256  Additionally require this sha256.
#   --allow-unverified
#                    Pin discovery only, NOT FOR RELEASE: build a pin whose manifest
#                    wasmSha256 is null. Needs --bundle or an explicit --out-dir that
#                    is not the repo root. Marked unverified in build-info.json
#                    ("verified": false) and <PREFIX>_WASM_VERIFIED=0.
#   --require-verified
#                    Fail unless the artifact matches the manifest wasmSha256 (also
#                    enabled by GHOSTTY_WASM_REQUIRE_VERIFIED=1; CI and releases set it).
#
# Compiler: the manifest "zigEnv" variable (ZIG_0_16_BIN) or `zig` on PATH, at
# least the manifest "zigVersion" (the reference compiler that produced
# wasmSha256). The pinned Ghostty source itself only builds with the same
# major.minor Zig and checks that on its own.
# GHOSTTY_GIT_URL overrides the manifest gitUrl (it must serve the pinned SHA).
#
# Never touches the ghostty/ submodule, global Git config or global Zig caches.
# Only the pinned commit is fetched (by SHA, depth 1); there is no "latest" mode.
# A build is verified when its sha256 equals the manifest wasmSha256, whatever the
# compiler. With the reference Zig a mismatch is an error. With a newer Zig a
# mismatching artifact is still published, marked unverified (fine for local
# development, NOT FOR RELEASE), unless --require-verified is in effect. A null
# wasmSha256 (an unverified pin) is refused unless --allow-unverified is given.
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
work_arg="${GHOSTTY_WASM_WORK_DIR:-}"
out_arg=""
bundle_arg=""
expect_sha=""
allow_unverified=0
require_verified=0
[[ "${GHOSTTY_WASM_REQUIRE_VERIFIED:-0}" != 1 ]] || require_verified=1
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
    --require-verified) require_verified=1 && shift ;;
    -h | --help)
      sed -n '2,/^set -euo pipefail/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    libghostty-vt) shift ;;
    *) die "unknown argument '$1' (see --help)" ;;
  esac
done
[[ -z "$bundle_arg" || -z "$out_arg" ]] || die "--bundle and --out-dir are exclusive"
[[ -z "$expect_sha" || "$expect_sha" =~ ^[0-9a-f]{64}$ ]] || die "--expect-sha256 must be 64 lowercase hex digits"
if [[ "$allow_unverified" -eq 1 ]]; then
  [[ "$require_verified" -eq 0 ]] ||
    die "--allow-unverified conflicts with --require-verified / GHOSTTY_WASM_REQUIRE_VERIFIED=1"
  [[ -n "$bundle_arg" || -n "$out_arg" ]] ||
    die "--allow-unverified needs --bundle or an explicit --out-dir (never the default repo root)"
fi

# --- Work dir: resolve, ownership, lock --------------------------------------
if [[ -z "$work_arg" ]]; then
  mkdir -p "$repo_root/.wasm-build"
  work_arg="$repo_root/.wasm-build/work"
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
  "$repo_root/.wasm-build/"?*) ;;
  "$repo_root"/*)
    die "work dir '$work_dir' is inside the ghostty-web checkout; use $repo_root/.wasm-build/<name> or a directory outside the checkout"
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
cleanup() {
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
    "$repo_root/" | "$repo_root/.wasm-build/"*) ;;
    "$repo_root"/*) die "out dir '$out_dir' is inside the checkout; only the repo root or .wasm-build/ are allowed" ;;
  esac
fi

# Keep git deterministic and independent of the caller's global/system config.
export GIT_CONFIG_NOSYSTEM=1
export GIT_CONFIG_GLOBAL=/dev/null
export GIT_TERMINAL_PROMPT=0

# --- Manifest ----------------------------------------------------------------
# Emits validated `key=value` lines for the target (no eval of manifest data).
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
      ["artifact", want("artifact", /^[A-Za-z0-9._-]+\.wasm$/)],
      ["wasmSha256", want("wasmSha256", /^[0-9a-f]{64}$/, true)],
      ["maxWasmBytes", want("maxWasmBytes", /^[1-9]\d*$/)],
      ["envPrefix", want("envPrefix", /^[A-Z][A-Z0-9_]*$/)],
      ["envFile", want("envFile", /^[A-Za-z0-9._-]+\.env$/)],
    ];
    if (!Array.isArray(t.buildArgs) || t.buildArgs.length === 0) fail("buildArgs missing");
    for (const a of t.buildArgs) {
      if (typeof a !== "string" || !/^[A-Za-z0-9=._+-]+$/.test(a)) fail(`bad build arg ${JSON.stringify(a)}`);
      out.push(["buildArg", a]);
    }
    for (const [k, v] of out) console.log(`${k}=${v}`);
  '
}

# Target state, set by load_target.
load_target() {
  t_name=$1
  t_commit="" t_git_url="" t_zig_version="" t_zig_env=""
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
      die "Zig not found for $t_name; set $t_zig_env to a Zig $t_zig_version (or newer) binary"
    t_zig_bin="$(command -v "$requested")"
  fi
  version="$("$t_zig_bin" version)" || die "'$t_zig_bin version' failed"
  [[ "$version" =~ ^[0-9A-Za-z.+-]+$ ]] || die "'$t_zig_bin version' printed an unexpected '$version'"
  zig_at_least "$version" "$t_zig_version" ||
    die "$t_name needs Zig $t_zig_version or newer (set $t_zig_env), but '$t_zig_bin' is $version"
  t_zig_actual=$version
  if [[ "$version" != "$t_zig_version" ]]; then
    log "$t_name: using Zig $version; the pinned wasmSha256 comes from Zig $t_zig_version, so different output is published as unverified"
  fi
}

# Fetch (by SHA) or verify the pinned source; it must be pristine.
prepare_source() {
  local src="$work_dir/sources/$t_commit" tmp head
  t_src=$src
  mkdir -p "$work_dir/sources"
  [[ ! -L "$src" && ! -L "$src.partial" ]] || die "symlink under '$work_dir/sources'"
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
  [[ -z "$(git -C "$src" status --porcelain --untracked-files=all)" ]] ||
    die "source '$src' has local modifications or untracked files; refusing to touch them"
  t_tree="$(git -C "$src" rev-parse 'HEAD^{tree}')"
  local min_zig
  min_zig="$(sed -n 's/^[[:space:]]*\.minimum_zig_version[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "$src/build.zig.zon")"
  [[ "$min_zig" == "$t_zig_version" ]] ||
    die "$t_name: build.zig.zon minimum_zig_version is '$min_zig', expected $t_zig_version"
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
  local cache="$work_dir/zig-cache/$t_zig_actual" logf="$work_dir/logs/$t_name.log" start_s
  mkdir -p "$work_dir/stage" "$work_dir/logs" "$cache/global" "$cache/local" "$work_dir/meta"
  rm -rf "$t_stage"
  log "$t_name: zig $t_zig_actual build ${t_build_args[*]} (log: $logf)"
  start_s="$(date +%s)"
  if ! (
    cd "$t_src" &&
      ZIG_GLOBAL_CACHE_DIR="$cache/global" ZIG_LOCAL_CACHE_DIR="$cache/local" \
        "$t_zig_bin" build "${t_build_args[@]}" \
        --prefix "$t_stage" --cache-dir "$cache/local" --global-cache-dir "$cache/global"
  ) >"$logf" 2>&1; then
    tail -n 40 "$logf" >&2 || true
    local hint=""
    [[ "${t_zig_actual%%[-+]*}" == "${t_zig_version%.*}".* ]] ||
      hint="; the pinned Ghostty source needs Zig ${t_zig_version%.*}.x, so use Zig $t_zig_version"
    die "$t_name: zig build failed (full log: $logf)$hint"
  fi
  t_seconds="$(($(date +%s) - start_s))"

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
  if [[ -n "$expect_sha" && "$t_sha" != "$expect_sha" ]]; then
    die "$t_name: WASM sha256 $t_sha != expected $expect_sha"
  fi
  t_verified=false
  if [[ -z "$t_wasm_sha" ]]; then
    log "$t_name: WARNING: UNVERIFIED pin build (--allow-unverified), NOT FOR RELEASE; built $t_sha"
  elif [[ "$t_sha" == "$t_wasm_sha" ]]; then
    t_verified=true
  elif [[ "$t_zig_actual" == "$t_zig_version" ]]; then
    die "$t_name: WASM sha256 $t_sha != ghostty-build.json wasmSha256 $t_wasm_sha (non-reproducible build or unreviewed change)"
  elif [[ "$require_verified" -eq 1 ]]; then
    die "$t_name: Zig $t_zig_actual built sha256 $t_sha, not the pinned $t_wasm_sha from Zig $t_zig_version; a verified build (--require-verified / GHOSTTY_WASM_REQUIRE_VERIFIED=1) needs Zig $t_zig_version"
  else
    log "$t_name: WARNING: Zig $t_zig_actual built sha256 $t_sha, not the pinned $t_wasm_sha from Zig $t_zig_version; publishing an UNVERIFIED build (fine for local development, NOT FOR RELEASE; use Zig $t_zig_version to reproduce the pin)"
  fi

  t_info="$work_dir/meta/$t_name.build-info.json"
  local build_args_json="" arg
  for arg in "${t_build_args[@]}"; do build_args_json+="${build_args_json:+, }$(json_string "$arg")"; done
  cat >"$t_info.partial" <<EOF
{
  "target": $(json_string "$t_name"),
  "ghosttyCommit": "$t_commit",
  "ghosttyTree": "$t_tree",
  "gitUrl": $(json_string "$t_git_url"),
  "zigVersion": $(json_string "$t_zig_actual"),
  "referenceZigVersion": "$t_zig_version",
  "buildArgs": [$build_args_json],
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

# --- Build, then publish -----------------------------------------------------
build_target libghostty-vt
verified_flag=1
[[ "$t_verified" == true ]] || verified_flag=0
prefix=$t_env_prefix
if [[ -n "$bundle_arg" ]]; then
  tmp="$bundle_dir.partial"
  rm -rf "$tmp"
  mkdir -p "$tmp"
  cp "$t_wasm" "$tmp/$t_artifact"
  cp "$t_info" "$tmp/build-info.json"
  # Shell-quoted (bash `printf %q`) so paths with spaces source safely.
  {
    printf '%s_COMMIT=%q\n' "$prefix" "$t_commit"
    printf '%s_WASM=%q\n' "$prefix" "$bundle_dir/$t_artifact"
    printf '%s_WASM_SHA256=%q\n' "$prefix" "$t_sha"
    printf '%s_WASM_VERIFIED=%s\n' "$prefix" "$verified_flag"
  } >"$tmp/$t_env_file"
  mv "$tmp" "$bundle_dir"
  published="$bundle_dir/$t_artifact"
  cat "$bundle_dir/$t_env_file"
else
  dest="$out_dir/$t_artifact"
  [[ ! -L "$dest" && ! -d "$dest" ]] || die "'$dest' is a symlink or directory; refusing to replace it"
  cp "$t_wasm" "$dest.partial.$$"
  mv -f "$dest.partial.$$" "$dest"
  published=$dest
  printf '%s_COMMIT=%q\n%s_WASM=%q\n%s_WASM_SHA256=%q\n%s_WASM_VERIFIED=%s\n' \
    "$prefix" "$t_commit" "$prefix" "$published" "$prefix" "$t_sha" "$prefix" "$verified_flag"
fi
echo "${prefix}_WASM_BYTES=$t_bytes"
echo "${prefix}_BUILD_INFO=$t_info"
log "$t_name: published $published ($t_bytes bytes, sha256 $t_sha, Zig $t_zig_actual, verified=$t_verified)"
rm -rf "$work_dir/stage"
