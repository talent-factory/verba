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
});
