import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/todo-index.ts',
    'src/cli.ts',
    'src/oauth-engine.ts',
    'src/token-manager.ts',
    'src/paths.ts',
    'src/graph-client.ts',
  ],
  outDir: 'dist',
  format: ['esm'],
  target: 'node16',
  shims: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  dts: true,
  esbuildOptions(options) {
    options.platform = 'node'
  }
})
