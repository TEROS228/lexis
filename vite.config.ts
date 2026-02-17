import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        tiers: resolve(__dirname, 'tiers.html'),
        learn: resolve(__dirname, 'learn.html'),
        wordList: resolve(__dirname, 'word-list.html'),
        wordDetails: resolve(__dirname, 'word-details.html'),
        quiz: resolve(__dirname, 'quiz.html'),
        profile: resolve(__dirname, 'profile.html'),
        teacherDashboard: resolve(__dirname, 'teacher-dashboard.html'),
        createAssignment: resolve(__dirname, 'create-assignment.html'),
      },
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
