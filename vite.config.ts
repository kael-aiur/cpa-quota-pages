import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { readBuildInfo } from './build/buildInfo';
import { cspHashPlugin } from './build/cspHashPlugin';

export type BuildMode = 'user' | 'admin';

export function resolveBuildTarget(mode: string) {
  if (mode === 'user') return { input: 'templates/quota.html', fileName: 'quota.html' };
  if (mode === 'admin') return { input: 'templates/quota-admin.html', fileName: 'quota-admin.html' };
  throw new Error(`Unsupported build mode: ${mode}`);
}

export default defineConfig(({ mode }) => {
  const target = resolveBuildTarget(mode);
  const buildInfo = readBuildInfo();
  const root = resolve(process.cwd(), 'templates');
  return {
    root,
    // cspHashPlugin MUST run after viteSingleFile so it hashes the fully
    // inlined final script; for post plugins, this array order is the
    // generateBundle execution order.
    plugins: [
      viteSingleFile(),
      cspHashPlugin({ target: target.fileName === 'quota-admin.html' ? 'admin' : 'user', buildInfo }),
    ],
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
