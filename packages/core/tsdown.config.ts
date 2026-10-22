import { defineConfig } from 'tsdown';

export default defineConfig([
  // Library build used by the CLI.
  { entry: ['src/index.ts'], format: 'esm', platform: 'node', dts: false },
  // Single-file engine the desktop app starts with `node aide-core.mjs`.
  // @aide/shared is inlined so the installed app needs no node_modules.
  {
    entry: { 'aide-core': 'src/main.ts' },
    format: 'esm',
    platform: 'node',
    outDir: 'dist-sidecar',
    outExtensions: () => ({ js: '.mjs' }),
    noExternal: ['@aide/shared'],
    dts: false,
  },
]);
