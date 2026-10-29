/**
 * Browser client bundle for the docwright plugin, mirroring the dsh-market
 * recipe for an external package: a closure-factory artifact that calls
 * window.__ModuleLoader__.load({ id, factory }) and resolves externals
 * through the injected require (loader module table). No CSS modules — the
 * section styles itself with host theme tokens inline.
 */
import { defineConfig } from 'tsdown'

// The loader id MUST equal the package name: the host composes the boot
// graph per package (dsh-market contract — its normalize script reads
// package.json name for exactly this reason).
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const id = (JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'package.json'), 'utf8')) as { name: string }).name

/** Only the loader module table entries this bundle requires. */
const CLIENT_EXTERNALS = ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives']

export default defineConfig({
  entry: { client: 'src/client/index.tsx' },
  outDir: 'client',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  sourcemap: false,
  clean: false,
  external: [...CLIENT_EXTERNALS],
  // tsdown auto-externalizes package dependencies; anything NOT in the loader
  // module table must inline instead — a require() the table cannot answer is
  // a guaranteed runtime throw.
  noExternal: (source: string) => (CLIENT_EXTERNALS.includes(source) ? undefined : true),
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'import.meta.env.MODE': JSON.stringify('production'),
    'import.meta.env': JSON.stringify({ MODE: 'production' }),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
