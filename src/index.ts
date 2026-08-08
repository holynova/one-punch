import { crawlRepository } from "./crawler/crawl";
import { generateSetupScript } from "./generator/bash";
import type { CrawlOptions, Repository } from "./repo/types";
import { createOverlay } from "./ui/overlay";

export * from "./crawler/crawl";
export * from "./generator/bash";
export * from "./github/adapter";
export * from "./github/fetch-page";
export * from "./github/identify";
export * from "./repo/types";
export * from "./repo/validate-path";

export interface RunOptions extends Omit<CrawlOptions, "onProgress"> {
  document?: Document;
  sourceUrl?: string;
}

export interface RunResult {
  repository: Repository;
  setupScript: string;
}

export async function runRepo2Script(options: RunOptions = {}): Promise<RunResult> {
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
