import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/cli.ts',
    'src/interface/server.ts'
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
