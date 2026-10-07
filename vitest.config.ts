import { defineConfig } from "vitest/config";
import viteTsConfigPaths from "vite-tsconfig-paths";

// Testes das regras de dinheiro (src/**/*.test.ts). Config separada do
// vite.config.ts pra não carregar o plugin do TanStack Start nos testes.
export default defineConfig({
  plugins: [viteTsConfigPaths()],
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
