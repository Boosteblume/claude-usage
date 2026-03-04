import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node18",
  clean: true,
  bundle: true,
  sourcemap: false,
  outExtension: () => ({ js: ".js" }),
  banner: {
    js: "#!/usr/bin/env node",
  },
});
