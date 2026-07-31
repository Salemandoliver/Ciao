import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts", "src/worker.ts", "src/db/migrate.ts", "src/db/seed.ts"],
  format: ["esm"],
  target: "node20",
  sourcemap: true,
  clean: true,
  // Bundle workspace source (@ciao/shared) into the output; keep npm deps external.
  noExternal: ["@ciao/shared"],
  outDir: "dist",
});
