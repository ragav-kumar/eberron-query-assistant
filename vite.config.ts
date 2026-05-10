import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { eberronApiPlugin } from "./src/server/vite-plugin.js";

export default defineConfig({
  plugins: [eberronApiPlugin(), react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  server: {
    watch: {
      ignored: [
        "**/.eberron-query-assistant/**",
        "**/logs/**",
        "**/foundry-export/**",
        "**/pdf/**"
      ]
    },
    port: 3000,
    strictPort: true
  }
});
