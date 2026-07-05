import { defineConfig } from 'vite';

// Tauri expects a fixed dev port and serves the built frontend from `dist/`.
// See https://v2.tauri.app/start/frontend/vite/
export default defineConfig({
	clearScreen: false,
	server: {
		port: 1420,
		strictPort: true,
	},
	build: {
		outDir: 'dist',
		target: 'es2022',
		commonjsOptions: {
			// `@verba/core` compiles to CommonJS but resolves to
			// `packages/core/dist/*` — a workspace symlink whose real path is
			// OUTSIDE `node_modules`. Vite's default `commonjsOptions.include`
			// is `[/node_modules/]`, so the CJS→ESM transform skips the core
			// dist and Rollup mis-reads `dist/index.js` as ESM, failing the
			// build with a `"…" is not exported by dist/index.js` error for a
			// `@verba/core` named import. `vite dev` avoids this because
			// `optimizeDeps` (see below) pre-bundles the package with esbuild.
			// Extending the include here runs the same @rollup/plugin-commonjs
			// transform on the core dist for `vite build`, which resolves every
			// named export.
			include: [/node_modules/, /packages\/core\/dist/],
		},
		rollupOptions: {
			input: {
				main: 'index.html',
				hud: 'hud.html',
			},
		},
	},
	// `@verba/core` is a linked npm-workspace package (symlinked outside this
	// project root), so Vite serves it via `/@fs/...` as a raw file instead of
	// running it through esbuild's dependency pre-bundler — and it compiles to
	// CommonJS (`require`/`exports`), which the browser cannot `import` as-is
	// (no ESM named-export conversion happens on the `/@fs/` path at all).
	// Forcing it into `optimizeDeps` routes it through the pre-bundler, which
	// does proper CJS-to-ESM interop.
	optimizeDeps: {
		include: ['@verba/core'],
	},
});
