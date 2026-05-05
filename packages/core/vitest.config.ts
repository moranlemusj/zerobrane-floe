import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/__tests__/client.real.test.ts", "**/node_modules/**", "**/dist/**"],
    environment: "node",
  },
});
