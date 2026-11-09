import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
const proxy = { '/api': 'http://localhost:4000', '/ws': { target: 'ws://localhost:4000', ws: true } };
export default defineConfig({ plugins: [react()], server: { proxy }, preview: { proxy } });
