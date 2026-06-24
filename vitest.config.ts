import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      // Measure coverage of the source, not the tests themselves.
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/main.ts"],
      reporter: [
        "text", // console summary
        "html", // human-browsable report at coverage/index.html
        "lcov", // coverage/lcov.info — consumed by SonarQube (sonar.javascript.lcov.reportPaths)
        "cobertura", // coverage/cobertura-coverage.xml — generic XML for GitHub coverage actions
      ],
    },
  },
});
