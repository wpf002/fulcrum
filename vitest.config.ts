import { defineConfig } from "vitest/config";

// Unit tests for pure logic across the workspace (no DB/network needed).
export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**"],
    environment: "node",
  },
});
