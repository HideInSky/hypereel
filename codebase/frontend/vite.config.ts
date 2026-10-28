import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the backend runs on :3000 and Vite on :5173. These proxy
// rules forward API, media and share-page requests so the frontend can use
// relative URLs ("/api/...") exactly like it does in production, where the
// backend serves dist/ from the same origin.
// docker compose sets VITE_PROXY_TARGET=http://backend:3000 (container DNS name).
const backend = process.env.VITE_PROXY_TARGET ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": backend,
      "/media": backend,
      "^/v/": backend, // share pages (/v/:id) are server-rendered by the backend
    },
  },
  build: { outDir: "dist" },
});
