import { build } from "esbuild";
import { mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";

await mkdir("dist", { recursive: true });
await build({
  entryPoints: ["test/core.test.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  target: ["node22"],
  external: ["linkedom"],
  outfile: "dist/core.test.mjs"
});

const child = spawn(process.execPath, ["dist/core.test.mjs"], {
  stdio: "inherit"
});

child.on("exit", async (code, signal) => {
  await rm("dist/core.test.mjs", { force: true });
  if (signal) {
    process.exitCode = 1;
  } else {
    process.exitCode = code ?? 1;
  }
});
