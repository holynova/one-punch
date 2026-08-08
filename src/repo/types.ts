export interface RepoIdentity {
  origin: string;
  owner: string;
  repo: string;
  sourceUrl: string;
}

export interface TreeDirectoryEntry {
  type: "directory";
  path: string;
  url: string;
}

export interface TreeFileEntry {
  type: "file";
  path: string;
  url: string;
}

export interface TreeUnsupportedEntry {
  type: "unsupported";
  path: string;
  reason: string;
  url?: string;
}

export type TreeEntry =
  | TreeDirectoryEntry
  | TreeFileEntry
  | TreeUnsupportedEntry;

export interface RepoTextFile {
  type: "text";
  path: string;
  content: string;
  sourceUrl: string;
  byteLength: number;
}

export interface RepoUnsupportedFile {
  path: string;
  reason: string;
  sourceUrl?: string;
}

export interface Repository {
  name: string;
  sourceUrl: string;
  ref: string;
  files: RepoTextFile[];
  unsupported: RepoUnsupportedFile[];
  warnings: string[];
}

export interface CrawlLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}

export interface CrawlProgress {
  phase: "tree" | "file";
  url: string;
  treesVisited: number;
  filesDiscovered: number;
  filesRead: number;
  textFiles: number;
  unsupportedFiles: number;
  totalBytes: number;
}

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export interface CrawlOptions {
  sourceUrl?: string;
  initialDocument?: Document;
  hostDocument?: Document;
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
  preserveExactText?: boolean;
  delayMs?: number;
  limits?: Partial<CrawlLimits>;
  onProgress?: (progress: CrawlProgress) => void;
}

export interface ParsedTreePage {
  kind: "tree";
  ref: string;
  path: string;
  entries: TreeEntry[];
}

export interface ParsedBlobText {
  type: "text";
  content: string;
  rawUrl?: string;
  ref?: string;
}

export interface ParsedBlobUnsupported {
  type: "unsupported";
  reason: string;
}

export type ParsedBlobPage = ParsedBlobText | ParsedBlobUnsupported;
