export class UnsafeRepoPathError extends Error {
  constructor(path: string, reason: string) {
    super(`Unsafe repository path ${JSON.stringify(path)}: ${reason}`);
    this.name = "UnsafeRepoPathError";
  }
}

/**
 * Validates the POSIX relative paths emitted by GitHub tree pages.
 * The generated shell script calls this again at generation time so the
 * encoder never trusts a path merely because it came from a web page.
 */
export function validateRepoPath(path: string): string {
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
  if (
    segments.some(
      (segment) =>
        segment.length === 0 || segment === "." || segment === ".."
    )
  ) {
    throw new UnsafeRepoPathError(
      path,
      "empty, current-directory, and parent-directory segments are not allowed"
    );
  }

  return path;
}

export function joinRepoPath(parent: string, child: string): string {
  const path = parent.length === 0 ? child : `${parent}/${child}`;
  return validateRepoPath(path);
}

export function repoParentPath(path: string): string {
  validateRepoPath(path);
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}
