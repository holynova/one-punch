import {
  asArray,
  asBoolean,
  asRecord,
  asString,
  getEmbeddedRoute,
  readEmbeddedPayload
} from "./embedded";
import {
  buildBlobUrl,
  buildTreeUrl,
  canonicalUrl,
  pathForKnownRef,
  routeRefFromUrl
} from "./identify";
import type {
  ParsedBlobPage,
  ParsedBlobText,
  ParsedTreePage,
  RepoIdentity,
  TreeEntry
} from "../repo/types";
import { joinRepoPath, validateRepoPath } from "../repo/validate-path";

interface TreeRouteData {
  ref: string;
  path: string;
  items: unknown[];
}

interface BlobMetadata {
  rawUrl?: string;
  ref?: string;
  image: boolean;
  viewable: boolean;
  large: boolean;
  truncated: boolean;
  empty: boolean;
}

function normalizeTreePath(path: string): string {
  const normalized = path.replace(/^\/+|\/+$/g, "");
  return normalized.length === 0 ? "" : validateRepoPath(normalized);
}

function readTreeRoute(document: Document): TreeRouteData | null {
  const payload = readEmbeddedPayload(document);
  const route =
    getEmbeddedRoute(payload, "codeViewTreeRoute") ??
    getEmbeddedRoute(payload, "codeViewRepoRoute");
  if (!route) return null;

  const refInfo = asRecord(route.refInfo);
  const ref = refInfo ? asString(refInfo.name) : null;
  const tree = asRecord(route.tree);
  const items = tree ? asArray(tree.items) : null;
  const path = asString(route.path);

  if (!ref || !items || path === null) return null;
  return { ref, path: normalizeTreePath(path), items };
}

function readBlobMetadata(document: Document): BlobMetadata {
  const payload = readEmbeddedPayload(document);
  const layout = getEmbeddedRoute(payload, "codeViewBlobLayoutRoute");
  const blob = layout ? asRecord(layout.blob) : null;
  const refInfo = layout ? asRecord(layout.refInfo) : null;
  const ref = refInfo ? asString(refInfo.name) : null;
  const headerInfo = blob ? asRecord(blob.headerInfo) : null;
  const blobSize = headerInfo ? asString(headerInfo.blobSize) : null;

  const rawUrl = blob ? asString(blob.rawBlobUrl) : null;
  const image = blob ? asBoolean(blob.image) === true : false;
  const viewable = blob ? asBoolean(blob.viewable) !== false : true;
  const large = blob ? asBoolean(blob.large) === true : false;
  const truncated = blob ? asBoolean(blob.truncated) === true : false;
  const empty = blobSize === "0 B" || blobSize === "0 bytes";

  return {
    ...(rawUrl ? { rawUrl } : {}),
    ...(ref ? { ref } : {}),
    image,
    viewable,
    large,
    truncated,
    empty
  };
}

function readBlobRawLines(document: Document): string[] | null {
  const payload = readEmbeddedPayload(document);
  const styledBlob = payload ? asRecord(payload["codeViewBlobLayoutRoute.StyledBlob"]) : null;
  const rawLines = styledBlob ? asArray(styledBlob.rawLines) : null;
  if (!rawLines || !rawLines.every((line) => typeof line === "string")) {
    return null;
  }
  return rawLines as string[];
}

function textFromCodeCell(cell: Element): string {
  const text = cell.textContent ?? "";
  // GitHub's server-rendered empty line contains one formatting newline. It
  // is not part of the source line; all other whitespace is source data.
  if (text === "\n" || text === "\r\n") return "";
  return text.replace(/\r\n/g, "\n");
}

function readDomCodeLines(document: Document): string[] {
  const currentCells = Array.from(document.querySelectorAll('[data-testid="code-cell"]'));
  const legacyCells = Array.from(
    document.querySelectorAll("td.blob-code-inner, .blob-code-inner")
  );
  const cells = currentCells.length > 0 ? currentCells : legacyCells;

  return cells
    .map((cell, index) => ({
      cell,
      index,
      line: Number(cell.getAttribute("data-line-number") ?? Number.NaN)
    }))
    .sort((left, right) => {
      const leftHasLine = Number.isFinite(left.line);
      const rightHasLine = Number.isFinite(right.line);
      if (leftHasLine && rightHasLine && left.line !== right.line) {
        return left.line - right.line;
      }
      return left.index - right.index;
    })
    .map(({ cell }) => textFromCodeCell(cell));
}

function hasBinaryMessage(document: Document): boolean {
  const text = document.body?.textContent ?? "";
  return /binary file|file is too large to be displayed|unable to render/i.test(text);
}

function collectTreeAnchors(
  document: Document,
  identity: RepoIdentity,
  ref: string
): Map<string, string> {
  const selectors = [
    "tr.react-directory-row a[href]",
    '[data-testid="tree-item"] a[href]',
    'div[role="row"] a[href]',
    ".js-navigation-item a[href]",
    ".Box-row a[href]"
  ];
  const seen = new Set<Element>();
  const anchors: HTMLAnchorElement[] = [];

  for (const selector of selectors) {
    for (const anchor of Array.from(document.querySelectorAll(selector))) {
      if (!seen.has(anchor)) {
        seen.add(anchor);
        if (anchor.tagName.toLowerCase() === "a") anchors.push(anchor as HTMLAnchorElement);
      }
    }
    if (anchors.length > 0) break;
  }

  if (anchors.length === 0) {
    for (const anchor of Array.from(document.querySelectorAll("a[href]"))) {
      if (!seen.has(anchor)) anchors.push(anchor as HTMLAnchorElement);
    }
  }

  const result = new Map<string, string>();
  for (const anchor of anchors) {
    const href = anchor.getAttribute("href");
    if (!href) continue;

    let url: URL;
    try {
      url = new URL(href, identity.origin);
    } catch {
      continue;
    }

    for (const type of ["tree", "blob"] as const) {
      try {
        const path = pathForKnownRef(url, identity, type, ref);
        if (path !== null && path.length > 0) {
          const key = `${type}:${path}`;
          if (!result.has(key)) result.set(key, canonicalUrl(url));
        }
      } catch {
        // Links to another repository or origin are intentionally ignored.
      }
    }
  }

  return result;
}

function parseEmbeddedTreeEntries(
  route: TreeRouteData,
  document: Document,
  identity: RepoIdentity
): TreeEntry[] {
  const anchorMap = collectTreeAnchors(document, identity, route.ref);
  const entries: TreeEntry[] = [];

  for (const rawItem of route.items) {
    const item = asRecord(rawItem);
    const name = item ? asString(item.name) : null;
    const itemPath = item ? asString(item.path) : null;
    const contentType = item ? asString(item.contentType) : null;
    if (!name || !itemPath || !contentType) continue;

    const path = validateRepoPath(itemPath);
    const type =
      contentType === "directory"
        ? "directory"
        : contentType === "file"
          ? "file"
          : "unsupported";

    if (type === "unsupported") {
      const unsupportedUrl = anchorMap.get(`blob:${path}`);
      const unsupportedEntry = {
        type,
        path,
        reason: `GitHub content type ${contentType} is not supported in Phase 1`
      } as const;
      entries.push(
        unsupportedUrl ? { ...unsupportedEntry, url: unsupportedUrl } : unsupportedEntry
      );
      continue;
    }

    const fromDom = anchorMap.get(`${type}:${path}`);
    const url =
      fromDom ??
      (type === "directory"
        ? buildTreeUrl(identity, route.ref, path)
        : buildBlobUrl(identity, route.ref, path));
    entries.push(type === "directory" ? { type, path, url } : { type, path, url });
  }

  return entries;
}

function parseDomTreeEntries(
  document: Document,
  identity: RepoIdentity,
  ref: string,
  currentPath: string
): TreeEntry[] {
  const links = collectTreeAnchors(document, identity, ref);
  const entries: TreeEntry[] = [];
  const prefix = currentPath.length === 0 ? "" : `${currentPath}/`;

  for (const [key, url] of links) {
    const separator = key.indexOf(":");
    const type = key.slice(0, separator);
    const path = key.slice(separator + 1);
    if (!path.startsWith(prefix)) continue;
    const relative = path.slice(prefix.length);
    if (relative.includes("/")) continue;
    if (type === "tree") entries.push({ type: "directory", path, url });
    if (type === "blob") entries.push({ type: "file", path, url });
  }

  return entries;
}

export class GitHubPageAdapter {
  parseTree(document: Document, pageUrl: string, identity: RepoIdentity): ParsedTreePage | null {
    const embedded = readTreeRoute(document);
    if (embedded) {
      return {
        kind: "tree",
        ref: embedded.ref,
        path: embedded.path,
        entries: parseEmbeddedTreeEntries(embedded, document, identity)
      };
    }

    const ref = routeRefFromUrl(pageUrl, identity, "tree");
    if (!ref) return null;
    const currentPath = normalizeTreePath(
      pathForKnownRef(pageUrl, identity, "tree", ref) ?? ""
    );
    return {
      kind: "tree",
      ref,
      path: currentPath,
      entries: parseDomTreeEntries(document, identity, ref, currentPath)
    };
  }

  parseBlob(document: Document, _pageUrl: string, _identity: RepoIdentity): ParsedBlobPage {
    const metadata = readBlobMetadata(document);
    if (metadata.image) {
      return { type: "unsupported", reason: "Binary image files are not supported in Phase 1" };
    }
    if (!metadata.viewable) {
      return { type: "unsupported", reason: "GitHub marked this file as not viewable" };
    }

    const rawLines = readBlobRawLines(document);
    if (rawLines) {
      const textResult: ParsedBlobText = {
        type: "text",
        content: rawLines.join("\n"),
        ...(metadata.rawUrl ? { rawUrl: metadata.rawUrl } : {}),
        ...(metadata.ref ? { ref: metadata.ref } : {})
      };
      return textResult;
    }

    const domLines = readDomCodeLines(document);
    if (domLines.length > 0) {
      return {
        type: "text",
        content: domLines.join("\n"),
        ...(metadata.rawUrl ? { rawUrl: metadata.rawUrl } : {}),
        ...(metadata.ref ? { ref: metadata.ref } : {})
      };
    }

    if (hasBinaryMessage(document)) {
      return { type: "unsupported", reason: "GitHub did not expose this file as text" };
    }

    if (metadata.empty) {
      return {
        type: "text",
        content: "",
        ...(metadata.rawUrl ? { rawUrl: metadata.rawUrl } : {}),
        ...(metadata.ref ? { ref: metadata.ref } : {})
      };
    }

    if (metadata.large || metadata.truncated) {
      return {
        type: "unsupported",
        reason: "GitHub exposed only a truncated or oversized file view"
      };
    }

    return {
      type: "unsupported",
      reason: "No text content was exposed by the GitHub blob page"
    };
  }
}

export const githubPageAdapter = new GitHubPageAdapter();
