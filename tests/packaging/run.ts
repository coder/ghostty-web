import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const artifactRoot = process.env.TEST_ARTIFACT_DIR ?? tmpdir();
await mkdir(artifactRoot, { recursive: true });
const work = await mkdtemp(join(artifactRoot, 'ghostty-package-'));

async function command(args: string[], cwd = work): Promise<string> {
  const child = Bun.spawn(args, {
    cwd,
    env: { ...process.env, npm_config_cache: join(work, 'npm-cache') },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  assert.equal(status, 0, `${args.join(' ')} failed:\n${stderr}\n${stdout}`);
  return stdout;
}

const expectedExports = [
  'CanvasRenderer',
  'CellFlags',
  'DirtyState',
  'EventEmitter',
  'FitAddon',
  'Ghostty',
  'GhosttyTerminal',
  'InputHandler',
  'Key',
  'KeyAction',
  'KeyEncoder',
  'KeyEncoderOption',
  'LinkDetector',
  'Mods',
  'OSC8LinkProvider',
  'SelectionManager',
  'Terminal',
  'UrlRegexProvider',
  'getGhostty',
  'init',
].sort();

let server: ReturnType<typeof createServer> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let passed = false;
try {
  // Test the real tarball and exports map. No network dependency install or npm lifecycle scripts.
  const packed = JSON.parse(
    await command(['npm', 'pack', '--ignore-scripts', '--json', '--pack-destination', work], root)
  ) as { filename: string; files: { path: string }[] }[];
  assert.equal(packed.length, 1);
  const files = packed[0].files.map((file) => file.path);
  for (const required of [
    'ghostty-vt.wasm',
    'dist/ghostty-web.js',
    'dist/ghostty-web.umd.cjs',
    'dist/index.d.ts',
  ]) {
    assert.ok(files.includes(required), `Tarball missing ${required}`);
  }
  assert.ok(
    !files.some((file) => /^(tests|docs|ghostty)\//.test(file)),
    'Development sources leaked into tarball'
  );
  const modules = join(work, 'node_modules');
  await mkdir(modules, { recursive: true });
  await command(['tar', '-xzf', join(work, packed[0].filename), '-C', modules]);
  await command(['mv', join(modules, 'package'), join(modules, 'ghostty-web')]);
  const packageDir = join(modules, 'ghostty-web');
  const shippedWasm = await readFile(join(packageDir, 'ghostty-vt.wasm'));
  assert.deepEqual(shippedWasm, await readFile(join(root, 'ghostty-vt.wasm')));
  console.log(
    `PASS tarball contents; wasm sha256=${createHash('sha256').update(shippedWasm).digest('hex')}`
  );

  for (const [mode, source] of [
    ['esm', 'const api = await import("ghostty-web");'],
    ['cjs', 'const api = require("ghostty-web");'],
  ]) {
    const code = `${source} console.log(JSON.stringify(Object.keys(api).sort()));`;
    const args =
      mode === 'esm' ? ['node', '--input-type=module', '-e', code] : ['node', '-e', code];
    assert.deepEqual(
      JSON.parse(await command(args)),
      expectedExports,
      `${mode} export surface changed`
    );
    console.log(`PASS packed ${mode} exports`);
  }

  await copyFile(join(root, 'tests/packaging/consumer.mts'), join(work, 'consumer.mts'));
  await command([
    'node',
    join(root, 'node_modules/typescript/bin/tsc'),
    '--noEmit',
    '--strict',
    '--skipLibCheck',
    '--target',
    'ES2022',
    '--module',
    'NodeNext',
    '--moduleResolution',
    'NodeNext',
    '--lib',
    'ES2022,DOM',
    '--types',
    'node',
    '--typeRoots',
    join(root, 'node_modules/@types'),
    join(work, 'consumer.mts'),
  ]);
  console.log('PASS packed declaration consumer');

  const pages = {
    '/esm':
      '<div id="terminal"></div><script type="module">import * as api from "/dist/ghostty-web.js"; window.api = api;</script>',
    '/umd':
      '<div id="terminal"></div><script src="/dist/ghostty-web.umd.cjs"></script><script>window.api = window.GhosttyWeb;</script>',
  };
  server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (pathname in pages) {
      response.setHeader('content-type', 'text/html');
      response.end(pages[pathname as keyof typeof pages]);
      return;
    }
    const path = resolve(packageDir, `.${pathname}`);
    if (!path.startsWith(packageDir + sep)) {
      response.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(path);
      response.setHeader(
        'content-type',
        path.endsWith('.wasm') ? 'application/wasm' : 'text/javascript'
      );
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  });
  for (const mode of ['esm', 'umd']) {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${address.port}/${mode}`);
    await page.waitForFunction(() => !!(window as any).api, undefined, { timeout: 5000 });
    const result = await page.evaluate(async () => {
      const api = (window as any).api;
      await api.init(); // Exercises default WASM resolution from the packed JS, not a source-tree URL.
      const terminal = new api.Terminal({ cols: 10, rows: 2, cursorBlink: false });
      terminal.open(document.getElementById('terminal'));
      terminal.write('PACKED');
      const line = terminal.buffer.active.getLine(0).translateToString(true);
      const canvas = document.querySelector('canvas');
      const pixels = canvas?.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height);
      terminal.dispose();
      return { line, canvas: !!canvas, pixelBytes: pixels?.data.length ?? 0 };
    });
    assert.equal(result.line, 'PACKED');
    assert.equal(result.canvas, true);
    assert.ok(result.pixelBytes > 0);
    assert.deepEqual(errors, [], `${mode} browser errors`);
    await page.close();
    console.log(`PASS packed ${mode} browser initialization, WASM loading and public buffer API`);
  }
  passed = true;
  console.log('Package regression: 6 checks passed');
} finally {
  await browser?.close();
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  if (passed) await rm(work, { recursive: true, force: true });
  else console.error(`Package regression artifacts retained at ${work}`);
}
