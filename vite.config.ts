import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import viteTsConfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    viteTsConfigPaths({
      projects: ["./tsconfig.json"],
    }),
    tailwindcss(),
    tanstackStart({
      tsr: {
        appDirectory: "src",
        routesDirectory: "src/routes",
        generatedRouteTree: "src/routeTree.gen.ts",
        quoteStyle: "double",
        semicolons: true,
      },
    }),
    react(),
  ],
});
