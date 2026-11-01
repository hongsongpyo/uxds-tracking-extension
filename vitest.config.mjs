import { defineConfig } from "vitest/config";

// The production source and the current unit/integration suites live in
// different roots. Do not discover archived source snapshots or Node's
// built-in test-runner suites as Vitest tests.
export default defineConfig({
  test: {
    include: ["tests/**/*.{test,spec}.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
  },
});
