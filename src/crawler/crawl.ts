import { GitHubPageAdapter, githubPageAdapter } from "../github/adapter";
import {
  buildTreeUrl,
  canonicalUrl,
  identifyRepository
} from "../github/identify";
import {
  fetchExactTextResource,
  fetchPageDocument,
  throwIfAborted,
  waitMs
} from "../github/fetch-page";
import type {
  CrawlLimits,
  CrawlOptions,
  CrawlProgress,
  ParsedBlobPage,
  ParsedTreePage,
  RepoTextFile,
  RepoUnsupportedFile,
  Repository,
  TreeEntry
} from "../repo/types";

const DEFAULT_LIMITS: CrawlLimits = {
  maxFiles: 500,
  maxFileBytes: 2 * 1024 * 1024,
  maxTotalBytes: 10 * 1024 * 1024
};

export class CrawlLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrawlLimitError";
  }
}

function getDocument(options: CrawlOptions): Document {
  if (options.initialDocument) return options.initialDocument;
  if (typeof globalThis.document !== "undefined") return globalThis.document;
  throw new Error("Repo2Script needs the current GitHub page document");
}

function getSourceUrl(options: CrawlOptions): string {
  if (options.sourceUrl) return options.sourceUrl;
  if (typeof globalThis.location !== "undefined") return globalThis.location.href;
  throw new Error("Repo2Script needs the current GitHub page URL");
}

function getLimits(options: CrawlOptions): CrawlLimits {
  return {
    maxFiles: options.limits?.maxFiles ?? DEFAULT_LIMITS.maxFiles,
    maxFileBytes: options.limits?.maxFileBytes ?? DEFAULT_LIMITS.maxFileBytes,
    maxTotalBytes: options.limits?.maxTotalBytes ?? DEFAULT_LIMITS.maxTotalBytes
  };
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function progressSnapshot(
  phase: CrawlProgress["phase"],
  url: string,
  state: {
    treesVisited: number;
    filesDiscovered: number;
    filesRead: number;
    textFiles: number;
    unsupportedFiles: number;
    totalBytes: number;
  }
): CrawlProgress {
  return { phase, url, ...state };
}

function reportProgress(
  callback: CrawlOptions["onProgress"],
  progress: CrawlProgress
): void {
  callback?.(progress);
}

function addUnsupported(
  unsupported: Map<string, RepoUnsupportedFile>,
  path: string,
  reason: string,
  sourceUrl?: string
): void {
  if (!unsupported.has(path)) {
    unsupported.set(path, {
      path,
      reason,
      ...(sourceUrl ? { sourceUrl } : {})
    });
  }
}

function parsedBlobError(blob: ParsedBlobPage): string {
  return blob.type === "unsupported" ? blob.reason : "";
}

function assertFileLimits(
  path: string,
  bytes: number,
  totalBytes: number,
  limits: CrawlLimits
): void {
  if (bytes > limits.maxFileBytes) {
    throw new CrawlLimitError(
      `File ${path} is ${bytes} bytes, over the ${limits.maxFileBytes}-byte per-file limit`
    );
  }
  if (totalBytes + bytes > limits.maxTotalBytes) {
    throw new CrawlLimitError(
      `Repository text is over the ${limits.maxTotalBytes}-byte total limit`
    );
  }
}

function isTreePage(
  adapter: GitHubPageAdapter,
  document: Document,
  url: string,
  identity: ReturnType<typeof identifyRepository>
): ParsedTreePage {
  const parsed = adapter.parseTree(document, url, identity);
  if (!parsed) throw new Error(`GitHub page did not expose a readable tree: ${url}`);
  return parsed;
}

export async function crawlRepository(options: CrawlOptions = {}): Promise<Repository> {
  const sourceUrl = getSourceUrl(options);
  const identity = identifyRepository(sourceUrl);
  const initialDocument = getDocument(options);
  const adapter = githubPageAdapter;
  const limits = getLimits(options);
  const initialTree = adapter.parseTree(initialDocument, sourceUrl, identity);

  let rootUrl: string;
  let rootDocument: Document | undefined;
  let ref: string;

  if (initialTree) {
    ref = initialTree.ref;
    if (initialTree.path.length === 0) {
      rootUrl = canonicalUrl(sourceUrl);
      rootDocument = initialDocument;
    } else {
      rootUrl = buildTreeUrl(identity, ref);
    }
  } else {
    const initialBlob = adapter.parseBlob(initialDocument, sourceUrl, identity);
    if (initialBlob.type === "unsupported") {
      throw new Error(`The current GitHub page is not a readable repository tree: ${initialBlob.reason}`);
    }

    const treeRef = initialBlob.type === "text" ? initialBlob.ref : null;
    // Blob pages expose the active ref in embedded layout data. If a future
    // GitHub DOM omits it, the URL fallback handles simple refs such as main.
    ref = treeRef ?? sourceUrl.split("/blob/")[1]?.split("/")[0] ?? "";
    if (!ref) throw new Error("Could not determine the current GitHub branch or tag");
    rootUrl = buildTreeUrl(identity, ref);
  }

  const treeQueue: string[] = [rootUrl];
  const visitedTrees = new Set<string>();
  const visitedFiles = new Set<string>();
  const files = new Map<string, RepoTextFile>();
  const unsupported = new Map<string, RepoUnsupportedFile>();
  const warnings: string[] = [];
  let treesVisited = 0;
  let filesDiscovered = 0;
  let filesRead = 0;
  let textFiles = 0;
  let unsupportedFiles = 0;
  let totalBytes = 0;

  const state = () => ({
    treesVisited,
    filesDiscovered,
    filesRead,
    textFiles,
    unsupportedFiles,
    totalBytes
  });

  const delayMs = options.delayMs ?? 80;
  const pageFetchOptions = () => ({
    hostDocument: options.hostDocument ?? initialDocument,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.signal ? { signal: options.signal } : {})
  });

  while (treeQueue.length > 0) {
    throwIfAborted(options.signal);
    const treeUrl = treeQueue.shift();
    if (!treeUrl) continue;
    const canonicalTreeUrl = canonicalUrl(treeUrl);
    if (visitedTrees.has(canonicalTreeUrl)) continue;
    visitedTrees.add(canonicalTreeUrl);

    const treeDocument =
      rootDocument && canonicalUrl(sourceUrl) === canonicalTreeUrl
        ? rootDocument
        : await fetchPageDocument(treeUrl, identity, {
            ...pageFetchOptions()
          });
    if (delayMs > 0) await waitMs(delayMs, options.signal);

    const tree = isTreePage(adapter, treeDocument, treeUrl, identity);
    treesVisited += 1;
    reportProgress(options.onProgress, progressSnapshot("tree", treeUrl, state()));

    for (const entry of tree.entries) {
      throwIfAborted(options.signal);
      if (entry.type === "unsupported") {
        unsupportedFiles += 1;
        addUnsupported(unsupported, entry.path, entry.reason, entry.url);
        continue;
      }

      if (entry.type === "directory") {
        const childUrl = canonicalUrl(entry.url);
        if (!visitedTrees.has(childUrl)) treeQueue.push(childUrl);
        continue;
      }

      filesDiscovered += 1;
      if (filesDiscovered > limits.maxFiles) {
        throw new CrawlLimitError(
          `Repository has more than the ${limits.maxFiles}-file Phase 1 limit`
        );
      }

      const fileUrl = canonicalUrl(entry.url);
      if (visitedFiles.has(fileUrl)) continue;
      visitedFiles.add(fileUrl);
      filesRead += 1;
      reportProgress(options.onProgress, progressSnapshot("file", entry.url, state()));

      try {
        const blobDocument = await fetchPageDocument(entry.url, identity, {
          ...pageFetchOptions()
        });
        if (delayMs > 0) await waitMs(delayMs, options.signal);

        let blob = adapter.parseBlob(blobDocument, entry.url, identity);
        if (blob.type === "unsupported") {
          unsupportedFiles += 1;
          addUnsupported(unsupported, entry.path, parsedBlobError(blob), entry.url);
          continue;
        }

        if (options.preserveExactText !== false && blob.rawUrl) {
          try {
            const exactContent = await fetchExactTextResource(blob.rawUrl, identity, {
              ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
              ...(options.signal ? { signal: options.signal } : {})
            });
            blob = { ...blob, content: exactContent };
          } catch (error) {
            warnings.push(
              `Used the blob page text for ${entry.path}; exact raw text was unavailable: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }
        }

        const bytes = byteLength(blob.content);
        assertFileLimits(entry.path, bytes, totalBytes, limits);
        totalBytes += bytes;
        textFiles += 1;
        files.set(entry.path, {
          type: "text",
          path: entry.path,
          content: blob.content,
          sourceUrl: entry.url,
          byteLength: bytes
        });
      } catch (error) {
        if (error instanceof CrawlLimitError) throw error;
        throwIfAborted(options.signal);
        unsupportedFiles += 1;
        addUnsupported(
          unsupported,
          entry.path,
          error instanceof Error ? error.message : String(error),
          entry.url
        );
      }
    }
  }

  const result: Repository = {
    name: `${identity.owner}/${identity.repo}`,
    sourceUrl: identity.sourceUrl,
    ref,
    files: [...files.values()].sort((left, right) => left.path.localeCompare(right.path)),
    unsupported: [...unsupported.values()].sort((left, right) =>
      left.path.localeCompare(right.path)
    ),
    warnings
  };
  reportProgress(options.onProgress, progressSnapshot("tree", rootUrl, state()));
  return result;
}
