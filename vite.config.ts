import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Use relative URLs so the app works from a subfolder like /h/poe/hideout/
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    open: true
  }
});
