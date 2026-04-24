import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        vespa: resolve(__dirname, 'vespa.html'),
        turntable: resolve(__dirname, 'turntable.html')
      }
    }
  }
});
