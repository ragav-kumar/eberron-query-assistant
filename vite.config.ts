import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { eberronApiPlugin } from "./src/server/vite-plugin.js";

export default defineConfig({
  plugins: [eberronApiPlugin(), react()],
  server: {
    port: 3000,
    strictPort: true
  }
});
