import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts', 'src/seed.ts'],
  format: 'esm',
  target: 'node22',
  platform: 'node',
  // Bundle the workspace package; keep real npm deps external.
  noExternal: ['@touraya/shared'],
  clean: true,
});
