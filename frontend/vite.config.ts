import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `vite build --mode pages` serves the site from https://seanome.github.io/CAFA_forever/.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  base: mode === 'pages' ? '/CAFA_forever/' : '/',
}))
