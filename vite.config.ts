import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig(({ mode }) => ({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  assetsInclude: ['**/*.wgsl'],
  server: {
    port: 3000,
    open: mode !== 'vscode-debug',
  },
  build: {
    target: 'esnext',
  },
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/artifacts/**',
    ],
  },
}));
