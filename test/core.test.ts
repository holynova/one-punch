import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { DOMParser, parseHTML } from "linkedom";
import { test } from "node:test";
import {
  GitHubPageAdapter,
  GitHubScopeError,
  assertAllowedRepositoryUrl,
  buildTreeUrl,
  crawlRepository,
  generateSetupScript,
  identifyRepository,
  validateRepoPath
} from "../src/index";
import type { FetchLike, Repository } from "../src/repo/types";

Object.assign(globalThis, { DOMParser });

const fixture = async (name: string): Promise<string> =>
  readFile(join(process.cwd(), "test", "fixtures", name), "utf8");

const documentFor = (html: string) => parseHTML(html).document;

function response(body: string, url: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}

test("identifies and scopes a GitHub repository without API routes", () => {
  const identity = identifyRepository("https://github.com/acme/demo/tree/main/src");
  assert.deepEqual(identity, {
    origin: "https://github.com",
    owner: "acme",
    repo: "demo",
    sourceUrl: "https://github.com/acme/demo/tree/main/src"
  });
  assert.equal(buildTreeUrl(identity, "main"), "https://github.com/acme/demo/tree/main/");
  assert.throws(
    () => identifyRepository("https://github.com/acme/demo/issues"),
    GitHubScopeError
  );
  assert.throws(
    () => identifyRepository("https://api.github.com/repos/acme/demo"),
    GitHubScopeError
  );
  assert.doesNotThrow(() =>
    assertAllowedRepositoryUrl(
      "https://raw.githubusercontent.com/acme/demo/main/file.txt",
      identity,
      "raw"
    )
  );
  assert.throws(
    () =>
      assertAllowedRepositoryUrl(
        "https://raw.githubusercontent.com/other/repo/main/file.txt",
        identity,
        "raw"
      ),
    GitHubScopeError
  );
});

test("parses embedded GitHub tree and blob data, including fallback DOM text", async () => {
  const adapter = new GitHubPageAdapter();
  const identity = identifyRepository("https://github.com/acme/demo");
  const root = documentFor(await fixture("root.html"));
  const tree = adapter.parseTree(root, identity.sourceUrl, identity);
  assert.ok(tree);
  assert.equal(tree.ref, "main");
  assert.deepEqual(
    tree.entries.map((entry) => [entry.type, entry.path]),
    [
      ["file", "README.md"],
      ["directory", "src"],
      ["unsupported", "linked.txt"]
    ]
  );
  assert.equal(tree.entries[0]?.url, "https://github.com/acme/demo/blob/main/README.md");

  const overviewRouteTree = adapter.parseTree(
    documentFor((await fixture("root.html")).replace("codeViewTreeRoute", "codeViewRepoRoute")),
    identity.sourceUrl,
    identity
  );
  assert.equal(overviewRouteTree?.entries.length, 3);

  const domBlob = adapter.parseBlob(
    documentFor(await fixture("blob-dom.html")),
    "https://github.com/acme/demo/blob/main/dom.txt",
    identity
  );
  assert.equal(domBlob.type, "text");
  if (domBlob.type === "text") {
    assert.equal(domBlob.content, '<tag attr="x"> &\n');
  }
});

test("crawls a text-only fixture and reports symlinks", async () => {
  const pages = new Map<string, string>([
    ["/acme/demo/tree/main/src", await fixture("tree-src.html")],
    ["/acme/demo/blob/main/README.md", await fixture("blob-readme.html")],
    ["/acme/demo/blob/main/src/special.txt", await fixture("blob-special.html")],
    [
      "/acme/demo/blob/main/src/no-final-newline.txt",
      await fixture("blob-no-final-newline.html")
    ],
    ["/acme/demo/blob/main/src/empty.txt", await fixture("blob-empty.html")]
  ]);
  const raw = new Map<string, string>([
    ["/acme/demo/raw/refs/heads/main/README.md", "# Demo\n"],
    [
      "/acme/demo/raw/refs/heads/main/src/special.txt",
      "中文 $HOME\n${TOKEN}\n$(command)\n<tag> &\nEOF\n"
    ],
    ["/acme/demo/raw/refs/heads/main/src/no-final-newline.txt", "no final newline"],
    ["/acme/demo/raw/refs/heads/main/src/empty.txt", ""]
  ]);
  const fetchImpl: FetchLike = async (input) => {
    const url = new URL(input.toString());
    const body = pages.get(url.pathname) ?? raw.get(url.pathname);
    if (body === undefined) return new Response("Not found", { status: 404 });
    return response(body, url.href);
  };

  const repository = await crawlRepository({
    sourceUrl: "https://github.com/acme/demo",
    initialDocument: documentFor(await fixture("root.html")),
    fetchImpl,
    preserveExactText: true,
    delayMs: 0
  });

  assert.equal(repository.name, "acme/demo");
  assert.equal(repository.ref, "main");
  assert.deepEqual(
    repository.files.map((file) => file.path),
    ["README.md", "src/empty.txt", "src/no-final-newline.txt", "src/special.txt"]
  );
  assert.equal(repository.files.find((file) => file.path === "README.md")?.content, "# Demo\n");
  assert.equal(
    repository.files.find((file) => file.path === "src/no-final-newline.txt")?.content,
    "no final newline"
  );
  assert.equal(repository.unsupported[0]?.path, "linked.txt");
  assert.equal(repository.warnings.length, 0);
});

test("generated setup.sh restores exact text, including no-final-newline and shell syntax", async () => {
  const special = "中文 $HOME\n${TOKEN}\n$(command)\n<tag> &\nEOF\n";
  const repository: Repository = {
    name: "acme/demo",
    sourceUrl: "https://github.com/acme/demo",
    ref: "main",
    files: [
      {
        type: "text",
        path: "src/special.txt",
        content: special,
        sourceUrl: "https://github.com/acme/demo/blob/main/src/special.txt",
        byteLength: new TextEncoder().encode(special).byteLength
      },
      {
        type: "text",
        path: "src/no-final-newline.txt",
        content: "no final newline ' $HOME",
        sourceUrl: "https://github.com/acme/demo/blob/main/src/no-final-newline.txt",
        byteLength: new TextEncoder().encode("no final newline ' $HOME").byteLength
      },
      {
        type: "text",
        path: "empty.txt",
        content: "",
        sourceUrl: "https://github.com/acme/demo/blob/main/empty.txt",
        byteLength: 0
      }
    ],
    unsupported: [],
    warnings: []
  };
  const script = generateSetupScript(repository);
  assert.match(script, /<<'__R2S_TEXT_/);
  assert.match(script, /base64 -d/);
  assert.doesNotMatch(script, /npm install|npm run|pip install|cargo/);

  const temp = await mkdtemp(join(tmpdir(), "repo2script-test-"));
  const scriptPath = join(temp, "setup.sh");
  const outputPath = join(temp, "restored");
  await writeFile(scriptPath, script, "utf8");
  const run = spawnSync("bash", [scriptPath, outputPath], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);

  assert.equal(await readFile(join(outputPath, "src/special.txt"), "utf8"), special);
  assert.equal(
    await readFile(join(outputPath, "src/no-final-newline.txt"), "utf8"),
    "no final newline ' $HOME"
  );
  const noFinalNewline = await readFile(join(outputPath, "src/no-final-newline.txt"));
  assert.equal(noFinalNewline[noFinalNewline.length - 1], 69);
  assert.equal((await readFile(join(outputPath, "empty.txt"))).byteLength, 0);
});

test("rejects unsafe repository paths before shell generation", () => {
  assert.equal(validateRepoPath("src/index.ts"), "src/index.ts");
  for (const unsafe of ["../escape", "/absolute", "src/../escape", "C:\\escape", "a\0b"]) {
    assert.throws(() => validateRepoPath(unsafe));
  }
});
