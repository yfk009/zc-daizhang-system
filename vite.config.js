import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: { outDir: 'dist', chunkSizeWarningLimit: 1500 },
  // 自建后端（server/）：dev / preview 均把 /api 反代到后端；
  // 默认 127.0.0.1:3000（与线上 nginx 一致），本机 3000 被占时用 ZC_API_PROXY 覆盖，如：
  //   ZC_API_PROXY=http://127.0.0.1:3100 npx vite preview --port 4655
  server: { proxy: { '/api': process.env.ZC_API_PROXY || 'http://127.0.0.1:3000' } },
  preview: { proxy: { '/api': process.env.ZC_API_PROXY || 'http://127.0.0.1:3000' } },
});
