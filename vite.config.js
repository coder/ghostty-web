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
      rollupTypes: true,
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
      fileName: (format, entryName) => {
        return format === 'es' ? `${entryName}.es.js` : `${entryName}.cjs.js`;
      },
      formats: ['es', 'cjs'],
    },
    rollupOptions: {
      external: [],
      output: {
        assetFileNames: 'assets/[name][extname]',
        globals: {},
      },
    },
  },
});
