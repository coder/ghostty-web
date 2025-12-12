import { resolve } from 'path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  server: {
    port: 8000,
    allowedHosts: ['.coder'],
  },
  plugins: [
    dts({
      include: ['lib/**/*.ts'],
      exclude: ['lib/**/*.test.ts'],
      rollupTypes: true, // Don't bundle - we need separate .d.ts for each entry
      copyDtsFiles: true,
    }),
  ],
  build: {
    lib: {
      entry: {
        'ghostty-web': resolve(__dirname, 'lib/index.ts'),
        headless: resolve(__dirname, 'lib/headless.ts'),
      },
      name: 'GhosttyWeb',
      fileName: (format) => {
        return format === 'es' ? 'ghostty-web.js' : 'ghostty-web.cjs';
      },
      formats: ['es', 'cjs'],
    },
    rollupOptions: {
      external: [], // No external dependencies
      output: {
        assetFileNames: 'assets/[name][extname]',
        globals: {},
      },
    },
  },
});
