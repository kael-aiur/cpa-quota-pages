import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export type BuildMode = 'user' | 'admin';

export function resolveBuildTarget(mode: string) {
  if (mode === 'user') return { input: 'templates/quota.html', fileName: 'quota.html' };
  if (mode === 'admin') return { input: 'templates/quota-admin.html', fileName: 'quota-admin.html' };
  throw new Error(`Unsupported build mode: ${mode}`);
}

export default defineConfig(({ mode }) => {
  const target = resolveBuildTarget(mode);
  const root = resolve(process.cwd(), 'templates');
  return {
    root,
    plugins: [viteSingleFile()],
    build: {
      outDir: resolve(process.cwd(), 'dist'),
      emptyOutDir: false,
      cssCodeSplit: false,
      rollupOptions: {
        input: { [target.fileName]: resolve(process.cwd(), target.input) },
        output: { inlineDynamicImports: true },
      },
    },
  };
});
