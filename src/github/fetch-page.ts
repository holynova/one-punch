import { assertAllowedRepositoryUrl, GitHubScopeError } from "./identify";
import type { FetchLike, RepoIdentity } from "../repo/types";

export interface FetchPageOptions {
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
  hostDocument?: Document;
  allowIframeFallback?: boolean;
}

function defaultFetch(): FetchLike {
  if (typeof globalThis.fetch !== "function") {
    throw new Error("This browser does not provide fetch");
  }
  return globalThis.fetch.bind(globalThis);
}

function parseHtml(html: string): Document {
  if (typeof DOMParser === "undefined") {
    throw new Error("This browser does not provide DOMParser");
  }
  const document = new DOMParser().parseFromString(html, "text/html");
  if (!document) throw new Error("GitHub returned an empty HTML document");
  return document;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function loadDocumentInIframe(
  sourceUrl: string,
  identity: RepoIdentity,
  hostDocument: Document,
  signal?: AbortSignal
): Promise<Document> {
  const url = assertAllowedRepositoryUrl(sourceUrl, identity, "page");
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("The operation was aborted", "AbortError"));
      return;
    }

    const iframe = hostDocument.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.cssText =
      "position:fixed;left:-10000px;top:-10000px;width:1px;height:1px;border:0;opacity:0;";
    iframe.src = url.href;

    let settled = false;
    const timeout = globalThis.setTimeout(() => {
      finish(new Error("Timed out while loading a GitHub page in the iframe"));
    }, 30_000);

    const abort = () => finish(new DOMException("The operation was aborted", "AbortError"));
    const cleanup = () => {
      globalThis.clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      iframe.remove();
    };
    const finish = (error?: Error) => {
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

export async function fetchPageDocument(
  sourceUrl: string,
  identity: RepoIdentity,
  options: FetchPageOptions = {}
): Promise<Document> {
  const pageUrl = assertAllowedRepositoryUrl(sourceUrl, identity, "page");
  const fetchImpl = options.fetchImpl ?? defaultFetch();

  try {
    const response = await fetchImpl(pageUrl, {
      credentials: "include",
      headers: { Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      ...(options.signal ? { signal: options.signal } : {})
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

export async function fetchExactTextResource(
  sourceUrl: string,
  identity: RepoIdentity,
  options: FetchPageOptions = {}
): Promise<string> {
  const rawUrl = assertAllowedRepositoryUrl(sourceUrl, identity, "raw");
  const fetchImpl = options.fetchImpl ?? defaultFetch();
  const response = await fetchImpl(rawUrl, {
    credentials: "include",
    headers: { Accept: "text/plain,*/*" },
    redirect: "follow",
    ...(options.signal ? { signal: options.signal } : {})
  });
  if (!response.ok) {
    throw new Error(`GitHub returned HTTP ${response.status} for raw text resource`);
  }
  const finalUrl = response.url ? new URL(response.url) : rawUrl;
  assertAllowedRepositoryUrl(finalUrl, identity, "raw");
  return response.text();
}

export function waitMs(ms: number, signal?: AbortSignal): Promise<void> {
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

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted", "AbortError");
  }
}
