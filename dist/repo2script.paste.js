/* Repo2Script Phase 1 - paste this file into a GitHub repository page Console. */
"use strict";
(() => {
  // src/github/embedded.ts
  function isRecord(value) {
    return typeof value === "object" && value !== null;
  }
  function asRecord(value) {
    return isRecord(value) ? value : null;
  }
  function asString(value) {
    return typeof value === "string" ? value : null;
  }
  function asBoolean(value) {
    return typeof value === "boolean" ? value : null;
  }
  function asArray(value) {
    return Array.isArray(value) ? value : null;
  }
  function readEmbeddedPayload(document) {
    const scripts = document.querySelectorAll(
      'script[type="application/json"][data-target="react-app.embeddedData"]'
    );
    for (const script of Array.from(scripts)) {
      const text = script.textContent?.trim();
      if (!text) continue;
      try {
        const parsed = JSON.parse(text);
        const root = asRecord(parsed);
        const payload = root ? asRecord(root.payload) : null;
        if (payload) return payload;
      } catch {
      }
    }
    return null;
  }
  function getEmbeddedRoute(payload, key) {
    return payload ? asRecord(payload[key]) : null;
  }

  // src/github/identify.ts
  var GITHUB_HOSTS = /* @__PURE__ */ new Set(["github.com", "www.github.com"]);
  var GITHUB_RAW_HOST = "raw.githubusercontent.com";
  var PAGE_ROUTES = /* @__PURE__ */ new Set(["tree", "blob"]);
  var GitHubScopeError = class extends Error {
    constructor(message) {
      super(message);
      this.name = "GitHubScopeError";
    }
  };
  function decodeSegment(segment) {
    try {
      return decodeURIComponent(segment);
    } catch {
      throw new GitHubScopeError(`Invalid encoded GitHub URL segment: ${segment}`);
    }
  }
  function pathnameSegments(url) {
    return url.pathname.split("/").filter((segment) => segment.length > 0).map(decodeSegment);
  }
  function assertNoCredentials(url) {
    if (url.username || url.password) {
      throw new GitHubScopeError("GitHub URLs with embedded credentials are not allowed");
    }
  }
  function identifyRepository(source) {
    const url = new URL(source.toString());
    assertNoCredentials(url);
    if (!GITHUB_HOSTS.has(url.hostname.toLowerCase())) {
      throw new GitHubScopeError(
        `Repo2Script only runs on github.com repository pages; got ${url.hostname}`
      );
    }
    const parts = pathnameSegments(url);
    if (parts.length < 2 || !parts[0] || !parts[1]) {
      throw new GitHubScopeError("The current GitHub URL is not a repository page");
    }
    const route = parts[2];
    if (route && !PAGE_ROUTES.has(route)) {
      throw new GitHubScopeError(
        `The current GitHub route is not a tree/blob page: /${route}`
      );
    }
    return {
      origin: url.origin,
      owner: parts[0],
      repo: parts[1],
      sourceUrl: url.href
    };
  }
  function assertRepositoryPrefix(url, identity) {
    assertNoCredentials(url);
    if (url.origin !== identity.origin) {
      throw new GitHubScopeError(
        `Refusing cross-origin GitHub URL: ${url.origin} !== ${identity.origin}`
      );
    }
    const parts = pathnameSegments(url);
    if (parts[0] !== identity.owner || parts[1] !== identity.repo) {
      throw new GitHubScopeError("Refusing a URL outside the current repository");
    }
    return parts;
  }
  function assertRawRepositoryUrl(url, identity) {
    assertNoCredentials(url);
    const isSameOrigin = url.origin === identity.origin;
    const isOfficialRawHost = url.protocol === "https:" && url.hostname.toLowerCase() === GITHUB_RAW_HOST && url.port.length === 0;
    if (!isSameOrigin && !isOfficialRawHost) {
      throw new GitHubScopeError("Refusing a raw resource outside the current GitHub repository");
    }
    const parts = pathnameSegments(url);
    const ownerIndex = isSameOrigin ? 0 : 0;
    if (parts[ownerIndex] !== identity.owner || parts[ownerIndex + 1] !== identity.repo) {
      throw new GitHubScopeError("Refusing a raw resource from another repository");
    }
    return parts;
  }
  function assertAllowedRepositoryUrl(source, identity, kind) {
    const url = new URL(source.toString(), identity.origin);
    const parts = kind === "raw" ? assertRawRepositoryUrl(url, identity) : assertRepositoryPrefix(url, identity);
    const route = parts[2];
    if (kind === "page") {
      if (route && !PAGE_ROUTES.has(route)) {
        throw new GitHubScopeError(`Refusing non-code-view route: /${route}`);
      }
      if (route && parts.length < 4) {
        throw new GitHubScopeError("Refusing an incomplete tree/blob URL");
      }
    } else if (url.hostname.toLowerCase() === GITHUB_RAW_HOST) {
      if (parts.length < 3) {
        throw new GitHubScopeError("Refusing an incomplete raw GitHub URL");
      }
    } else if (route !== "raw" || parts.length < 5) {
      throw new GitHubScopeError("Refusing an incomplete raw resource URL");
    }
    return url;
  }
  function canonicalUrl(source) {
    const url = new URL(source.toString());
    url.hash = "";
    return url.href;
  }
  function encodePathPart(part) {
    return encodeURIComponent(part);
  }
  function encodeRef(ref) {
    return ref.split("/").map(encodePathPart).join("/");
  }
  function encodeRepoPath(path) {
    return path.split("/").map(encodePathPart).join("/");
  }
  function buildCodeViewUrl(identity, type, ref, path = "") {
    const base = `${identity.origin}/${encodePathPart(identity.owner)}/${encodePathPart(
      identity.repo
    )}/${type}/${encodeRef(ref)}`;
    return path.length === 0 ? `${base}/` : `${base}/${encodeRepoPath(path)}`;
  }
  function buildTreeUrl(identity, ref, path = "") {
    return buildCodeViewUrl(identity, "tree", ref, path);
  }
  function buildBlobUrl(identity, ref, path) {
    return buildCodeViewUrl(identity, "blob", ref, path);
  }
  function pathForKnownRef(source, identity, type, ref) {
    const url = new URL(source.toString(), identity.origin);
    const parts = assertRepositoryPrefix(url, identity);
    if (parts[2] !== type || parts.length < 4) {
      return null;
    }
    const rawAfterRoute = url.pathname.split("/").filter((segment) => segment.length > 0).slice(3).join("/");
    let decodedAfterRoute;
    try {
      decodedAfterRoute = decodeURIComponent(rawAfterRoute);
    } catch {
      return null;
    }
    if (decodedAfterRoute === ref) {
      return "";
    }
    const prefix = `${ref}/`;
    if (!decodedAfterRoute.startsWith(prefix)) {
      return null;
    }
    return decodedAfterRoute.slice(prefix.length);
  }
  function routeRefFromUrl(source, identity, type) {
    const url = new URL(source.toString(), identity.origin);
    const parts = assertRepositoryPrefix(url, identity);
    if (parts[2] !== type || parts.length < 4) {
      return null;
    }
    return parts[3] ?? null;
  }

  // src/repo/validate-path.ts
  var UnsafeRepoPathError = class extends Error {
    constructor(path, reason) {
      super(`Unsafe repository path ${JSON.stringify(path)}: ${reason}`);
      this.name = "UnsafeRepoPathError";
    }
  };
  function validateRepoPath(path) {
    if (typeof path !== "string" || path.length === 0) {
      throw new UnsafeRepoPathError(path, "path must be non-empty");
    }
    if (path.includes("\0")) {
      throw new UnsafeRepoPathError(path, "NUL is not allowed");
    }
    if (/^[\\/]/.test(path) || /^[A-Za-z]:[\\/]/.test(path)) {
      throw new UnsafeRepoPathError(path, "absolute paths are not allowed");
    }
    if (/[\u0001-\u001f\u007f\r\n]/.test(path)) {
      throw new UnsafeRepoPathError(path, "control characters are not allowed");
    }
    const segments = path.split("/");
    if (segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === ".."
    )) {
      throw new UnsafeRepoPathError(
        path,
        "empty, current-directory, and parent-directory segments are not allowed"
      );
    }
    return path;
  }
  function repoParentPath(path) {
    validateRepoPath(path);
    const slash = path.lastIndexOf("/");
    return slash === -1 ? "" : path.slice(0, slash);
  }

  // src/github/adapter.ts
  function normalizeTreePath(path) {
    const normalized = path.replace(/^\/+|\/+$/g, "");
    return normalized.length === 0 ? "" : validateRepoPath(normalized);
  }
  function readTreeRoute(document) {
    const payload = readEmbeddedPayload(document);
    const route = getEmbeddedRoute(payload, "codeViewTreeRoute") ?? getEmbeddedRoute(payload, "codeViewRepoRoute");
    if (!route) return null;
    const refInfo = asRecord(route.refInfo);
    const ref = refInfo ? asString(refInfo.name) : null;
    const tree = asRecord(route.tree);
    const items = tree ? asArray(tree.items) : null;
    const path = asString(route.path);
    if (!ref || !items || path === null) return null;
    return { ref, path: normalizeTreePath(path), items };
  }
  function readBlobMetadata(document) {
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
      ...rawUrl ? { rawUrl } : {},
      ...ref ? { ref } : {},
      image,
      viewable,
      large,
      truncated,
      empty
    };
  }
  function readBlobRawLines(document) {
    const payload = readEmbeddedPayload(document);
    const styledBlob = payload ? asRecord(payload["codeViewBlobLayoutRoute.StyledBlob"]) : null;
    const rawLines = styledBlob ? asArray(styledBlob.rawLines) : null;
    if (!rawLines || !rawLines.every((line) => typeof line === "string")) {
      return null;
    }
    return rawLines;
  }
  function textFromCodeCell(cell) {
    const text = cell.textContent ?? "";
    if (text === "\n" || text === "\r\n") return "";
    return text.replace(/\r\n/g, "\n");
  }
  function readDomCodeLines(document) {
    const currentCells = Array.from(document.querySelectorAll('[data-testid="code-cell"]'));
    const legacyCells = Array.from(
      document.querySelectorAll("td.blob-code-inner, .blob-code-inner")
    );
    const cells = currentCells.length > 0 ? currentCells : legacyCells;
    return cells.map((cell, index) => ({
      cell,
      index,
      line: Number(cell.getAttribute("data-line-number") ?? Number.NaN)
    })).sort((left, right) => {
      const leftHasLine = Number.isFinite(left.line);
      const rightHasLine = Number.isFinite(right.line);
      if (leftHasLine && rightHasLine && left.line !== right.line) {
        return left.line - right.line;
      }
      return left.index - right.index;
    }).map(({ cell }) => textFromCodeCell(cell));
  }
  function hasBinaryMessage(document) {
    const text = document.body?.textContent ?? "";
    return /binary file|file is too large to be displayed|unable to render/i.test(text);
  }
  function collectTreeAnchors(document, identity, ref) {
    const selectors = [
      "tr.react-directory-row a[href]",
      '[data-testid="tree-item"] a[href]',
      'div[role="row"] a[href]',
      ".js-navigation-item a[href]",
      ".Box-row a[href]"
    ];
    const seen = /* @__PURE__ */ new Set();
    const anchors = [];
    for (const selector of selectors) {
      for (const anchor of Array.from(document.querySelectorAll(selector))) {
        if (!seen.has(anchor)) {
          seen.add(anchor);
          if (anchor.tagName.toLowerCase() === "a") anchors.push(anchor);
        }
      }
      if (anchors.length > 0) break;
    }
    if (anchors.length === 0) {
      for (const anchor of Array.from(document.querySelectorAll("a[href]"))) {
        if (!seen.has(anchor)) anchors.push(anchor);
      }
    }
    const result = /* @__PURE__ */ new Map();
    for (const anchor of anchors) {
      const href = anchor.getAttribute("href");
      if (!href) continue;
      let url;
      try {
        url = new URL(href, identity.origin);
      } catch {
        continue;
      }
      for (const type of ["tree", "blob"]) {
        try {
          const path = pathForKnownRef(url, identity, type, ref);
          if (path !== null && path.length > 0) {
            const key = `${type}:${path}`;
            if (!result.has(key)) result.set(key, canonicalUrl(url));
          }
        } catch {
        }
      }
    }
    return result;
  }
  function parseEmbeddedTreeEntries(route, document, identity) {
    const anchorMap = collectTreeAnchors(document, identity, route.ref);
    const entries = [];
    for (const rawItem of route.items) {
      const item = asRecord(rawItem);
      const name = item ? asString(item.name) : null;
      const itemPath = item ? asString(item.path) : null;
      const contentType = item ? asString(item.contentType) : null;
      if (!name || !itemPath || !contentType) continue;
      const path = validateRepoPath(itemPath);
      const type = contentType === "directory" ? "directory" : contentType === "file" ? "file" : "unsupported";
      if (type === "unsupported") {
        const unsupportedUrl = anchorMap.get(`blob:${path}`);
        const unsupportedEntry = {
          type,
          path,
          reason: `GitHub content type ${contentType} is not supported in Phase 1`
        };
        entries.push(
          unsupportedUrl ? { ...unsupportedEntry, url: unsupportedUrl } : unsupportedEntry
        );
        continue;
      }
      const fromDom = anchorMap.get(`${type}:${path}`);
      const url = fromDom ?? (type === "directory" ? buildTreeUrl(identity, route.ref, path) : buildBlobUrl(identity, route.ref, path));
      entries.push(type === "directory" ? { type, path, url } : { type, path, url });
    }
    return entries;
  }
  function parseDomTreeEntries(document, identity, ref, currentPath) {
    const links = collectTreeAnchors(document, identity, ref);
    const entries = [];
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
  var GitHubPageAdapter = class {
    parseTree(document, pageUrl, identity) {
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
    parseBlob(document, _pageUrl, _identity) {
      const metadata = readBlobMetadata(document);
      if (metadata.image) {
        return { type: "unsupported", reason: "Binary image files are not supported in Phase 1" };
      }
      if (!metadata.viewable) {
        return { type: "unsupported", reason: "GitHub marked this file as not viewable" };
      }
      const rawLines = readBlobRawLines(document);
      if (rawLines) {
        const textResult = {
          type: "text",
          content: rawLines.join("\n"),
          ...metadata.rawUrl ? { rawUrl: metadata.rawUrl } : {},
          ...metadata.ref ? { ref: metadata.ref } : {}
        };
        return textResult;
      }
      const domLines = readDomCodeLines(document);
      if (domLines.length > 0) {
        return {
          type: "text",
          content: domLines.join("\n"),
          ...metadata.rawUrl ? { rawUrl: metadata.rawUrl } : {},
          ...metadata.ref ? { ref: metadata.ref } : {}
        };
      }
      if (hasBinaryMessage(document)) {
        return { type: "unsupported", reason: "GitHub did not expose this file as text" };
      }
      if (metadata.empty) {
        return {
          type: "text",
          content: "",
          ...metadata.rawUrl ? { rawUrl: metadata.rawUrl } : {},
          ...metadata.ref ? { ref: metadata.ref } : {}
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
  };
  var githubPageAdapter = new GitHubPageAdapter();

  // src/github/fetch-page.ts
  function defaultFetch() {
    if (typeof globalThis.fetch !== "function") {
      throw new Error("This browser does not provide fetch");
    }
    return globalThis.fetch.bind(globalThis);
  }
  function parseHtml(html) {
    if (typeof DOMParser === "undefined") {
      throw new Error("This browser does not provide DOMParser");
    }
    const document = new DOMParser().parseFromString(html, "text/html");
    if (!document) throw new Error("GitHub returned an empty HTML document");
    return document;
  }
  function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }
  function loadDocumentInIframe(sourceUrl, identity, hostDocument, signal) {
    const url = assertAllowedRepositoryUrl(sourceUrl, identity, "page");
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException("The operation was aborted", "AbortError"));
        return;
      }
      const iframe = hostDocument.createElement("iframe");
      iframe.setAttribute("aria-hidden", "true");
      iframe.style.cssText = "position:fixed;left:-10000px;top:-10000px;width:1px;height:1px;border:0;opacity:0;";
      iframe.src = url.href;
      let settled = false;
      const timeout = globalThis.setTimeout(() => {
        finish(new Error("Timed out while loading a GitHub page in the iframe"));
      }, 3e4);
      const abort = () => finish(new DOMException("The operation was aborted", "AbortError"));
      const cleanup = () => {
        globalThis.clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
        iframe.remove();
      };
      const finish = (error) => {
        if (settled) return;
        settled = true;
        if (error) {
          cleanup();
          reject(error);
          return;
        }
        const frameDocument = iframe.contentDocument;
        if (!frameDocument) {
          cleanup();
          reject(new Error("The GitHub iframe did not expose a readable document"));
          return;
        }
        try {
          const html = frameDocument.documentElement.outerHTML;
          cleanup();
          resolve(parseHtml(html));
        } catch (parseError) {
          cleanup();
          reject(parseError);
        }
      };
      iframe.addEventListener("load", () => finish());
      iframe.addEventListener("error", () => finish(new Error("GitHub iframe failed to load")));
      signal?.addEventListener("abort", abort, { once: true });
      hostDocument.body?.append(iframe);
    });
  }
  async function fetchPageDocument(sourceUrl, identity, options = {}) {
    const pageUrl = assertAllowedRepositoryUrl(sourceUrl, identity, "page");
    const fetchImpl = options.fetchImpl ?? defaultFetch();
    try {
      const response = await fetchImpl(pageUrl, {
        credentials: "include",
        headers: { Accept: "text/html,application/xhtml+xml" },
        redirect: "follow",
        ...options.signal ? { signal: options.signal } : {}
      });
      if (!response.ok) {
        throw new Error(`GitHub returned HTTP ${response.status} for ${pageUrl.href}`);
      }
      const finalUrl = response.url ? new URL(response.url) : pageUrl;
      assertAllowedRepositoryUrl(finalUrl, identity, "page");
      return parseHtml(await response.text());
    } catch (error) {
      if (error instanceof GitHubScopeError || options.allowIframeFallback === false) {
        throw error;
      }
      const hostDocument = options.hostDocument ?? globalThis.document;
      if (!hostDocument?.body) throw error;
      try {
        return await loadDocumentInIframe(pageUrl.href, identity, hostDocument, options.signal);
      } catch (iframeError) {
        throw new Error(
          `Unable to read GitHub HTML with fetch (${errorMessage(error)}) or iframe (${errorMessage(
            iframeError
          )})`
        );
      }
    }
  }
  async function fetchExactTextResource(sourceUrl, identity, options = {}) {
    const rawUrl = assertAllowedRepositoryUrl(sourceUrl, identity, "raw");
    const fetchImpl = options.fetchImpl ?? defaultFetch();
    const response = await fetchImpl(rawUrl, {
      credentials: "include",
      headers: { Accept: "text/plain,*/*" },
      redirect: "follow",
      ...options.signal ? { signal: options.signal } : {}
    });
    if (!response.ok) {
      throw new Error(`GitHub returned HTTP ${response.status} for raw text resource`);
    }
    const finalUrl = response.url ? new URL(response.url) : rawUrl;
    assertAllowedRepositoryUrl(finalUrl, identity, "raw");
    return response.text();
  }
  function waitMs(ms, signal) {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException("The operation was aborted", "AbortError"));
        return;
      }
      const timeout = globalThis.setTimeout(resolve, ms);
      signal?.addEventListener(
        "abort",
        () => {
          globalThis.clearTimeout(timeout);
          reject(new DOMException("The operation was aborted", "AbortError"));
        },
        { once: true }
      );
    });
  }
  function throwIfAborted(signal) {
    if (signal?.aborted) {
      throw new DOMException("The operation was aborted", "AbortError");
    }
  }

  // src/crawler/crawl.ts
  var DEFAULT_LIMITS = {
    maxFiles: 500,
    maxFileBytes: 2 * 1024 * 1024,
    maxTotalBytes: 10 * 1024 * 1024
  };
  var CrawlLimitError = class extends Error {
    constructor(message) {
      super(message);
      this.name = "CrawlLimitError";
    }
  };
  function getDocument(options) {
    if (options.initialDocument) return options.initialDocument;
    if (typeof globalThis.document !== "undefined") return globalThis.document;
    throw new Error("Repo2Script needs the current GitHub page document");
  }
  function getSourceUrl(options) {
    if (options.sourceUrl) return options.sourceUrl;
    if (typeof globalThis.location !== "undefined") return globalThis.location.href;
    throw new Error("Repo2Script needs the current GitHub page URL");
  }
  function getLimits(options) {
    return {
      maxFiles: options.limits?.maxFiles ?? DEFAULT_LIMITS.maxFiles,
      maxFileBytes: options.limits?.maxFileBytes ?? DEFAULT_LIMITS.maxFileBytes,
      maxTotalBytes: options.limits?.maxTotalBytes ?? DEFAULT_LIMITS.maxTotalBytes
    };
  }
  function byteLength(value) {
    return new TextEncoder().encode(value).byteLength;
  }
  function progressSnapshot(phase, url, state) {
    return { phase, url, ...state };
  }
  function reportProgress(callback, progress) {
    callback?.(progress);
  }
  function addUnsupported(unsupported, path, reason, sourceUrl) {
    if (!unsupported.has(path)) {
      unsupported.set(path, {
        path,
        reason,
        ...sourceUrl ? { sourceUrl } : {}
      });
    }
  }
  function parsedBlobError(blob) {
    return blob.type === "unsupported" ? blob.reason : "";
  }
  function assertFileLimits(path, bytes, totalBytes, limits) {
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
  function isTreePage(adapter, document, url, identity) {
    const parsed = adapter.parseTree(document, url, identity);
    if (!parsed) throw new Error(`GitHub page did not expose a readable tree: ${url}`);
    return parsed;
  }
  async function crawlRepository(options = {}) {
    const sourceUrl = getSourceUrl(options);
    const identity = identifyRepository(sourceUrl);
    const initialDocument = getDocument(options);
    const adapter = githubPageAdapter;
    const limits = getLimits(options);
    const initialTree = adapter.parseTree(initialDocument, sourceUrl, identity);
    let rootUrl;
    let rootDocument;
    let ref;
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
      ref = treeRef ?? sourceUrl.split("/blob/")[1]?.split("/")[0] ?? "";
      if (!ref) throw new Error("Could not determine the current GitHub branch or tag");
      rootUrl = buildTreeUrl(identity, ref);
    }
    const treeQueue = [rootUrl];
    const visitedTrees = /* @__PURE__ */ new Set();
    const visitedFiles = /* @__PURE__ */ new Set();
    const files = /* @__PURE__ */ new Map();
    const unsupported = /* @__PURE__ */ new Map();
    const warnings = [];
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
      ...options.fetchImpl ? { fetchImpl: options.fetchImpl } : {},
      ...options.signal ? { signal: options.signal } : {}
    });
    while (treeQueue.length > 0) {
      throwIfAborted(options.signal);
      const treeUrl = treeQueue.shift();
      if (!treeUrl) continue;
      const canonicalTreeUrl = canonicalUrl(treeUrl);
      if (visitedTrees.has(canonicalTreeUrl)) continue;
      visitedTrees.add(canonicalTreeUrl);
      const treeDocument = rootDocument && canonicalUrl(sourceUrl) === canonicalTreeUrl ? rootDocument : await fetchPageDocument(treeUrl, identity, {
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
                ...options.fetchImpl ? { fetchImpl: options.fetchImpl } : {},
                ...options.signal ? { signal: options.signal } : {}
              });
              blob = { ...blob, content: exactContent };
            } catch (error) {
              warnings.push(
                `Used the blob page text for ${entry.path}; exact raw text was unavailable: ${error instanceof Error ? error.message : String(error)}`
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
    const result = {
      name: `${identity.owner}/${identity.repo}`,
      sourceUrl: identity.sourceUrl,
      ref,
      files: [...files.values()].sort((left, right) => left.path.localeCompare(right.path)),
      unsupported: [...unsupported.values()].sort(
        (left, right) => left.path.localeCompare(right.path)
      ),
      warnings
    };
    reportProgress(options.onProgress, progressSnapshot("tree", rootUrl, state()));
    return result;
  }

  // src/generator/base64.ts
  function utf8ToBase64(value) {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    const chunkSize = 32768;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const end = Math.min(offset + chunkSize, bytes.length);
      let chunk = "";
      for (let index = offset; index < end; index += 1) {
        chunk += String.fromCharCode(bytes[index] ?? 0);
      }
      binary += chunk;
    }
    if (typeof btoa !== "function") {
      throw new Error("This browser does not provide btoa for exact file encoding");
    }
    return btoa(binary);
  }
  function wrapBase64(value, width = 76) {
    if (value.length === 0) return "";
    const lines = [];
    for (let offset = 0; offset < value.length; offset += width) {
      lines.push(value.slice(offset, offset + width));
    }
    return lines.join("\n");
  }

  // src/generator/delimiter.ts
  function randomToken() {
    const bytes = new Uint8Array(9);
    const cryptoObject = globalThis.crypto;
    if (cryptoObject?.getRandomValues) {
      cryptoObject.getRandomValues(bytes);
    } else {
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = Math.floor(Math.random() * 256);
      }
    }
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  function uniqueDelimiter(content, prefix = "__R2S__") {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const delimiter = `${prefix}${randomToken()}__`;
      if (!content.includes(delimiter)) return delimiter;
    }
    throw new Error("Could not find a safe heredoc delimiter");
  }

  // src/generator/bash.ts
  function shellQuote(value) {
    return `'${value.replace(/'/g, "'\\''")}'`;
  }
  function shellPath(path) {
    if (path.length === 0) return '"$ROOT"';
    validateRepoPath(path);
    return `"$ROOT"/${shellQuote(path)}`;
  }
  function commentSafe(value) {
    return value.replace(/[\r\n]/g, " ");
  }
  function sortedFiles(files) {
    return [...files].sort((left, right) => left.path.localeCompare(right.path));
  }
  function appendTextFile(chunks, file) {
    validateRepoPath(file.path);
    const target = shellPath(file.path);
    chunks.push(`mkdir -p -- ${shellPath(repoParentPath(file.path))}
`);
    if (file.content.length === 0) {
      chunks.push(`: > ${target}

`);
      return;
    }
    const canUseHeredoc = file.content.endsWith("\n") && !file.content.includes("\0");
    if (canUseHeredoc) {
      const delimiter2 = uniqueDelimiter(file.content, "__R2S_TEXT_");
      chunks.push(`cat > ${target} <<'${delimiter2}'
`);
      chunks.push(file.content);
      chunks.push(`${delimiter2}

`);
      return;
    }
    const delimiter = uniqueDelimiter(file.content, "__R2S_B64_");
    const encoded = wrapBase64(utf8ToBase64(file.content));
    chunks.push(
      `if base64 -d > ${target} <<'${delimiter}'
${encoded}
${delimiter}
then
  :
else
  base64 -D > ${target} <<'${delimiter}'
${encoded}
${delimiter}
fi

`
    );
  }
  function generateSetupScript(repository) {
    const chunks = [
      "#!/usr/bin/env bash\n",
      "set -eu\n",
      "\n",
      "# Generated by Repo2Script (browser-only GitHub HTML exporter).\n",
      `# Source: ${commentSafe(repository.sourceUrl)}
`,
      `# Ref: ${commentSafe(repository.ref)}
`,
      `# Text files: ${repository.files.length}
`,
      `# Unsupported: ${repository.unsupported.length}
`,
      "\n",
      'ROOT="${1:-.}"\n',
      'mkdir -p -- "$ROOT"\n\n'
    ];
    for (const file of sortedFiles(repository.files)) appendTextFile(chunks, file);
    if (repository.unsupported.length > 0) {
      chunks.push("# Unsupported files were intentionally not written:\n");
      for (const item of repository.unsupported) {
        chunks.push(`# - ${commentSafe(item.path)}: ${commentSafe(item.reason)}
`);
      }
      chunks.push("\n");
    }
    if (repository.warnings.length > 0) {
      chunks.push("# Crawl warnings:\n");
      for (const warning of repository.warnings) {
        chunks.push(`# - ${commentSafe(warning)}
`);
      }
      chunks.push("\n");
    }
    return chunks.join("");
  }

  // src/ui/overlay.ts
  var OVERLAY_ID = "repo2script-overlay";
  var CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.panel {
  position: fixed;
  z-index: 2147483647;
  right: 20px;
  bottom: 20px;
  width: min(620px, calc(100vw - 32px));
  max-height: min(760px, calc(100vh - 32px));
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  overflow: hidden;
  color: #e8edf5;
  background: #11151b;
  border: 1px solid #303947;
  border-radius: 14px;
  box-shadow: 0 18px 60px rgba(0, 0, 0, .38);
  font: 13px/1.45 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
.title-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
h1 { margin: 0; color: #fff; font: 700 17px/1.2 ui-sans-serif, system-ui, sans-serif; }
.subtle { color: #98a4b5; overflow-wrap: anywhere; }
.status { color: #d5deeb; min-height: 20px; }
.stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.stat { padding: 9px 10px; background: #1a2029; border: 1px solid #293241; border-radius: 8px; }
.stat strong { display: block; color: #fff; font-size: 16px; }
.stat span { color: #98a4b5; font-size: 11px; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; }
button { cursor: pointer; border: 1px solid #4b5a6e; border-radius: 7px; padding: 8px 12px; color: #fff; background: #253245; font: inherit; }
button:hover { background: #30425a; }
button.primary { border-color: #6aa8ff; background: #2563b8; }
button.primary:hover { background: #3177d2; }
button.ghost { padding: 3px 7px; color: #afbac9; background: transparent; border-color: #3a4554; }
textarea { width: 100%; min-height: 250px; resize: vertical; padding: 12px; color: #dbe6f2; background: #0a0d11; border: 1px solid #303947; border-radius: 8px; outline: none; font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
textarea:focus { border-color: #6aa8ff; box-shadow: 0 0 0 2px rgba(106,168,255,.18); }
.notice { max-height: 100px; overflow: auto; padding: 9px 10px; color: #f4c77b; background: #2a2114; border: 1px solid #5b4424; border-radius: 8px; white-space: pre-wrap; }
@media (max-width: 520px) { .panel { right: 8px; bottom: 8px; width: calc(100vw - 16px); padding: 14px; } .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
`;
  function element(document, tag, text) {
    const node = document.createElement(tag);
    if (text !== void 0) node.textContent = text;
    return node;
  }
  function formatError(error) {
    return error instanceof Error ? error.message : String(error);
  }
  function makeStat(document, value, label) {
    const box = element(document, "div");
    box.className = "stat";
    box.append(element(document, "strong", value), element(document, "span", label));
    return box;
  }
  function createOverlay(document = globalThis.document, options = { onCancel: () => void 0 }) {
    document.getElementById(OVERLAY_ID)?.remove();
    const host = element(document, "div");
    host.id = OVERLAY_ID;
    const shadow = host.attachShadow?.({ mode: "open" });
    const root = shadow ?? host;
    const style = element(document, "style");
    style.textContent = CSS;
    root.append(style);
    document.body.append(host);
    const panel = element(document, "section");
    panel.className = "panel";
    const header = element(document, "div");
    header.className = "title-row";
    const heading = element(document, "div");
    heading.append(element(document, "h1", "Repo2Script"));
    const subtitle = element(document, "div", "Browser-only \xB7 GitHub HTML \xB7 text files");
    subtitle.className = "subtle";
    heading.append(subtitle);
    const close = element(document, "button", "\xD7");
    close.className = "ghost";
    close.title = "Close";
    close.addEventListener("click", () => host.remove());
    header.append(heading, close);
    panel.append(header);
    const status = element(document, "div", "Reading repository tree\u2026");
    status.className = "status";
    panel.append(status);
    const body = element(document, "div");
    body.className = "content";
    panel.append(body);
    root.append(panel);
    const handle = {
      setProgress(progress) {
        const location = progress.url.replace(/^https?:\/\/github\.com\//, "");
        status.textContent = `${progress.phase === "tree" ? "Scanning" : "Reading"} ${location} \xB7 ${progress.textFiles} text \xB7 ${progress.unsupportedFiles} unsupported`;
      },
      showResult(repository, setupScript) {
        status.textContent = `Ready \xB7 ${repository.name} @ ${repository.ref}`;
        body.replaceChildren();
        const stats = element(document, "div");
        stats.className = "stats";
        stats.append(
          makeStat(document, String(repository.files.length), "text files"),
          makeStat(document, String(repository.unsupported.length), "unsupported"),
          makeStat(
            document,
            String(repository.files.reduce((sum, file) => sum + file.byteLength, 0)),
            "UTF-8 bytes"
          ),
          makeStat(document, String(repository.warnings.length), "warnings")
        );
        body.append(stats);
        if (repository.unsupported.length > 0 || repository.warnings.length > 0) {
          const notice = element(document, "div");
          notice.className = "notice";
          const lines = [
            ...repository.unsupported.map((item) => `Unsupported: ${item.path} \u2014 ${item.reason}`),
            ...repository.warnings.map((warning) => `Warning: ${warning}`)
          ];
          notice.textContent = lines.join("\n");
          body.append(notice);
        }
        const textarea = element(document, "textarea");
        textarea.value = setupScript;
        textarea.setAttribute("aria-label", "Generated setup.sh");
        textarea.spellcheck = false;
        body.append(textarea);
        const actions = element(document, "div");
        actions.className = "actions";
        const copy = element(document, "button", "Copy setup.sh");
        copy.className = "primary";
        copy.addEventListener("click", async () => {
          try {
            if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
            await navigator.clipboard.writeText(setupScript);
            copy.textContent = "Copied";
          } catch {
            textarea.focus();
            textarea.select();
            let copied = false;
            try {
              copied = document.execCommand?.("copy") === true;
            } catch {
              copied = false;
            }
            copy.textContent = copied ? "Copied" : "Select all and copy";
          }
        });
        const select = element(document, "button", "Select text");
        select.addEventListener("click", () => {
          textarea.focus();
          textarea.select();
        });
        actions.append(copy, select);
        body.append(actions);
      },
      showError(error) {
        status.textContent = "Stopped";
        body.replaceChildren();
        const notice = element(document, "div", formatError(error));
        notice.className = "notice";
        body.append(notice);
        const retryHint = element(
          document,
          "div",
          "Check that this is a GitHub repository page and that the repository is visible, then paste the script again."
        );
        retryHint.className = "subtle";
        body.append(retryHint);
      },
      dispose() {
        host.remove();
      }
    };
    const cancel = element(document, "button", "Cancel");
    cancel.className = "ghost";
    cancel.addEventListener("click", () => {
      options.onCancel();
      cancel.disabled = true;
      cancel.textContent = "Cancelling\u2026";
    });
    header.insertBefore(cancel, close);
    return handle;
  }

  // src/index.ts
  async function runRepo2Script(options = {}) {
    const pageDocument = options.document ?? globalThis.document;
    const controller = new AbortController();
    const overlay = createOverlay(pageDocument, { onCancel: () => controller.abort() });
    try {
      const repository = await crawlRepository({
        ...options,
        initialDocument: pageDocument,
        hostDocument: pageDocument,
        signal: controller.signal,
        onProgress: (progress) => overlay.setProgress(progress)
      });
      const setupScript = generateSetupScript(repository);
      overlay.showResult(repository, setupScript);
      return { repository, setupScript };
    } catch (error) {
      overlay.showError(error);
      throw error;
    }
  }

  // src/entry/console.ts
  var marker = "__REPO2SCRIPT_ACTIVE__";
  var globalState = globalThis;
  if (globalState[marker]) {
    console.warn("Repo2Script is already running on this page.");
  } else {
    globalState[marker] = true;
    void runRepo2Script().catch((error) => {
      console.error("Repo2Script stopped:", error);
    }).finally(() => {
      globalState[marker] = false;
    });
  }
})();
