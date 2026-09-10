import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Use the shared package sources directly so edits hot-reload in dev.
      "@sr/shared": fileURLToPath(new URL("../shared/src/index.ts", import.meta.url)),
    },
  },
});
