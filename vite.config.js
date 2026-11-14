import { defineConfig } from 'vite';

export default defineConfig({
  // Electron opens dist/index.html with file://, so assets must be relative.
  base: './',
});
