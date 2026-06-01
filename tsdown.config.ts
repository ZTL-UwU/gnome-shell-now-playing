import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    extension: 'src/extension.ts',
    prefs: 'src/prefs.ts',
    mediaIndicator: 'src/mediaIndicator.ts',
  },
  format: 'esm',
  outDir: 'dist',
  outExtensions: () => ({ js: '.js' }),
  target: 'es2023',
  platform: 'neutral',
  unbundle: true,
  dts: false,
  sourcemap: false,
  clean: false,
  tsconfig: 'tsconfig.json',
  deps: {
    neverBundle: [/^gi:/, /^resource:/],
  },
});
