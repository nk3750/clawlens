import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/plugins/clawlens/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
