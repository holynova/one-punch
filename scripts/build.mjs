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

console.log("Built dist/repo2script.paste.js");
