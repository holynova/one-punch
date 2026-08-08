import type { RepoIdentity } from "../repo/types";

const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);
const GITHUB_RAW_HOST = "raw.githubusercontent.com";
const PAGE_ROUTES = new Set(["tree", "blob"]);

export class GitHubScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubScopeError";
  }
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new GitHubScopeError(`Invalid encoded GitHub URL segment: ${segment}`);
  }
}

function pathnameSegments(url: URL): string[] {
  return url.pathname
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(decodeSegment);
}

function assertNoCredentials(url: URL): void {
  if (url.username || url.password) {
    throw new GitHubScopeError("GitHub URLs with embedded credentials are not allowed");
  }
}

export function identifyRepository(source: string | URL): RepoIdentity {
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

function assertRepositoryPrefix(url: URL, identity: RepoIdentity): string[] {
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

function assertRawRepositoryUrl(url: URL, identity: RepoIdentity): string[] {
  assertNoCredentials(url);
  const isSameOrigin = url.origin === identity.origin;
  const isOfficialRawHost =
    url.protocol === "https:" &&
    url.hostname.toLowerCase() === GITHUB_RAW_HOST &&
    url.port.length === 0;
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

export type GitHubResourceKind = "page" | "raw";

export function assertAllowedRepositoryUrl(
  source: string | URL,
  identity: RepoIdentity,
  kind: GitHubResourceKind
): URL {
  const url = new URL(source.toString(), identity.origin);
  const parts = kind === "raw"
    ? assertRawRepositoryUrl(url, identity)
    : assertRepositoryPrefix(url, identity);
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

export function canonicalUrl(source: string | URL): string {
  const url = new URL(source.toString());
  url.hash = "";
  return url.href;
}

function encodePathPart(part: string): string {
  return encodeURIComponent(part);
}

function encodeRef(ref: string): string {
  return ref.split("/").map(encodePathPart).join("/");
}

function encodeRepoPath(path: string): string {
  return path.split("/").map(encodePathPart).join("/");
}

function buildCodeViewUrl(
  identity: RepoIdentity,
  type: "tree" | "blob",
  ref: string,
  path = ""
): string {
  const base = `${identity.origin}/${encodePathPart(identity.owner)}/${encodePathPart(
    identity.repo
  )}/${type}/${encodeRef(ref)}`;
  return path.length === 0 ? `${base}/` : `${base}/${encodeRepoPath(path)}`;
}

export function buildTreeUrl(identity: RepoIdentity, ref: string, path = ""): string {
  return buildCodeViewUrl(identity, "tree", ref, path);
}

export function buildBlobUrl(identity: RepoIdentity, ref: string, path: string): string {
  return buildCodeViewUrl(identity, "blob", ref, path);
}

/**
 * Resolves the path portion of a tree/blob link when the page's ref is known.
 * A known ref is important because branch names may contain slashes.
 */
export function pathForKnownRef(
  source: string | URL,
  identity: RepoIdentity,
  type: "tree" | "blob",
  ref: string
): string | null {
  const url = new URL(source.toString(), identity.origin);
  const parts = assertRepositoryPrefix(url, identity);
  if (parts[2] !== type || parts.length < 4) {
    return null;
  }

  const rawAfterRoute = url.pathname
    .split("/")
    .filter((segment) => segment.length > 0)
    .slice(3)
    .join("/");
  let decodedAfterRoute: string;
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

export function routeRefFromUrl(
  source: string | URL,
  identity: RepoIdentity,
  type: "tree" | "blob"
): string | null {
  const url = new URL(source.toString(), identity.origin);
  const parts = assertRepositoryPrefix(url, identity);
  if (parts[2] !== type || parts.length < 4) {
    return null;
  }
  return parts[3] ?? null;
}
