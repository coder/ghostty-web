#!/usr/bin/env bash
# Run the Chromium browser tests (or, with --candidates, generate review-only scene images)
# in the pinned Playwright image.
# The checkout is mounted read-only and copied inside the disposable container.
set -euo pipefail

readonly IMAGE='mcr.microsoft.com/playwright:v1.64.0-noble@sha256:06a9939e57531807f8d5fd76ce44b53165ffb7d7501d87ab10e285c20b1e971f'
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || {
  echo 'Canonical scene generation requires Linux x86_64 (the CI target)' >&2; exit 1;
}
for tool in docker bun node; do
  command -v "$tool" >/dev/null || { echo "$tool is required" >&2; exit 1; }
done
[[ "$(bun --version)" == '1.2.15' ]] || { echo 'Bun 1.2.15 is required' >&2; exit 1; }
[[ "$(node --version)" == 'v22.19.0' ]] || { echo 'Node 22.19.0 is required' >&2; exit 1; }
[[ -f "$root/ghostty-vt.wasm" && -d "$root/node_modules" ]] || {
  echo 'Install dependencies and build ghostty-vt.wasm first' >&2; exit 1;
}

candidate=''
if [[ "${1:-}" == '--candidates' ]]; then
  candidate='/evidence/candidates'
  shift
  # Generate only the reviewed scene images.
  set -- tests/browser/scenes.pw.ts "$@"
fi
artifact_root="${TEST_ARTIFACT_DIR:-${TMPDIR:-/tmp}}"
mkdir -p "$artifact_root"
artifact_root="$(cd "$artifact_root" && pwd -P)"
case "$artifact_root/" in
  "$root/test-results/"*) ;;
  "$root/"*) echo 'Artifacts must be outside the checkout or under test-results/' >&2; exit 1 ;;
esac
evidence="$(mktemp -d "$artifact_root/ghostty-browser.XXXXXX")"
name="ghostty-browser-$(date +%s)-$$"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Linux is the baseline target. Bind the exact installed Bun/Node binaries;
# Docker supplies the pinned browser and OS/font-rasterization libraries.
bun_bin="$(readlink -f "$(command -v bun)")"
node_bin="$(readlink -f "$(command -v node)")"
printf 'Browser evidence: %s\n' "$evidence"
set +e
docker run --rm --name "$name" --network none --ipc=host \
  --env PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
  --env "HOST_UID=$(id -u)" --env "HOST_GID=$(id -g)" \
  --env "GHOSTTY_SCENE_CANDIDATES=$candidate" \
  --env "GHOSTTY_SCENE_ENVIRONMENT=$IMAGE" \
  --mount "type=bind,source=$root,target=/source,readonly" \
  --mount "type=bind,source=$bun_bin,target=/usr/local/bin/bun,readonly" \
  --mount "type=bind,source=$node_bin,target=/usr/local/bin/node,readonly" \
  --mount "type=bind,source=$evidence,target=/evidence" \
  "$IMAGE" bash -lc '
    set -e
    ln -s /usr/local/bin/bun /usr/local/bin/bunx
    mkdir /work
    cp -a /source/lib /source/tests /source/node_modules /source/package.json \
      /source/vite.config.js /source/tsconfig.json /source/playwright.config.ts \
      /source/ghostty-build.json /source/ghostty-vt.wasm /work/
    cd /work
    set +e
    bun run test:browser "$@" --reporter=json > /evidence/results.json 2> /evidence/stderr.log
    result=$?
    cp -a test-results /evidence/ 2>/dev/null || true
    chmod -R a+rX /evidence
    chown -R "$HOST_UID:$HOST_GID" /evidence
    exit "$result"
  ' bash "$@"
result=$?
set -e
node -e '
  const fs = require("node:fs");
  const file = process.argv[1];
  if (!fs.existsSync(file)) process.exit(0);
  const result = JSON.parse(fs.readFileSync(file, "utf8"));
  console.log(JSON.stringify(result.stats, null, 2));
  for (const error of result.errors ?? []) console.error(error.message);
' "$evidence/results.json"
echo "Results and images retained at: $evidence"
exit "$result"
