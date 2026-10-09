import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue()],
  server: {
    // The page comes from the app server, not from Vite. Without this, the CSS asks the app
    // server for the font files and gets a 404. With it, the links point at Vite.
    origin: process.env.VITE_DEV_SERVER_URL ?? "http://localhost:5173",
  },
  build: {
    outDir: "dist/client",
    manifest: true,
    rollupOptions: { input: "resources/js/app.ts" },
  },
});
