export const VIEWS_DIR = new URL("../../resources/views", import.meta.url);
export const CLIENT_DIR = "./dist/client";
export const VITE_MANIFEST_PATH = `${CLIENT_DIR}/.vite/manifest.json`;
export const VITE_ENTRY = "resources/js/app.ts";
export const SSR_BUNDLE_PATH = new URL("../../dist/ssr/ssr.js", import.meta.url).pathname;
