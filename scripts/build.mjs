import { cp, mkdir } from "node:fs/promises";
import { build } from "esbuild";

await build({
  entryPoints: ["src/entry/console.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  minify: false,
  sourcemap: false,
  outfile: "dist/repo2script.paste.js",
  banner: {
    js: "/* Repo2Script Phase 1 - paste this file into a GitHub repository page Console. */"
  }
});

await mkdir("dist", { recursive: true });
await Promise.all(
  ["index.html", "styles.css", "favicon.svg", "screenshot.png"].map((file) =>
    cp(file, `dist/${file}`),
  ),
);

console.log("Built dist/repo2script.paste.js");
