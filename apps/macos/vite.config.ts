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
