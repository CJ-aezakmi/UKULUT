import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    clearScreen: false,
    server: {
        port: 3000,
        strictPort: true,
    },
    envPrefix: ['VITE_', 'TAURI_'],
    build: {
        target: ['es2021', 'chrome100', 'safari13'],
        minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
        sourcemap: !!process.env.TAURI_DEBUG,
        // Country flags must be real files: the app CSP does not allow data: images.
        assetsInlineLimit: (file: string) => (file.includes('flag-icons') ? false : undefined),
    },
});
