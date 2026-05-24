import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  base: "./",
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        antim: resolve(__dirname, 'antim-sanskar.html'),
        emergency: resolve(__dirname, 'emergency.html'),
        booking: resolve(__dirname, 'booking-form.html'),
        admin: resolve(__dirname, 'admin.html'),
        tracking: resolve(__dirname, 'tracking.html'),
      },
    },
  },
});
