import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],

  // Prevent Vite from pre-bundling the ONNX/WASM packages — they must stay as
  // native ES modules so the browser can load the WASM binary correctly.
  optimizeDeps: {
    exclude: ['kokoro-js', '@huggingface/transformers'],
  },

  server: {
    // Required for SharedArrayBuffer (used by ONNX multi-threaded WASM)
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
})
