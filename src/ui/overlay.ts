import type { CrawlProgress, Repository } from "../repo/types";

const OVERLAY_ID = "repo2script-overlay";

export interface OverlayOptions {
  onCancel: () => void;
}

export interface OverlayHandle {
  setProgress(progress: CrawlProgress): void;
  showResult(repository: Repository, setupScript: string): void;
  showError(error: unknown): void;
  dispose(): void;
}

const CSS = `
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

function element<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tag: K,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function makeStat(document: Document, value: string, label: string): HTMLDivElement {
  const box = element(document, "div");
  box.className = "stat";
  box.append(element(document, "strong", value), element(document, "span", label));
  return box;
}

export function createOverlay(
  document: Document = globalThis.document,
  options: OverlayOptions = { onCancel: () => undefined }
): OverlayHandle {
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
  const subtitle = element(document, "div", "Browser-only · GitHub HTML · text files");
  subtitle.className = "subtle";
  heading.append(subtitle);
  const close = element(document, "button", "×");
  close.className = "ghost";
  close.title = "Close";
  close.addEventListener("click", () => host.remove());
  header.append(heading, close);
  panel.append(header);

  const status = element(document, "div", "Reading repository tree…");
  status.className = "status";
  panel.append(status);

  const body = element(document, "div");
  body.className = "content";
  panel.append(body);
  root.append(panel);

  const handle: OverlayHandle = {
    setProgress(progress) {
      const location = progress.url.replace(/^https?:\/\/github\.com\//, "");
      status.textContent =
        `${progress.phase === "tree" ? "Scanning" : "Reading"} ${location} · ` +
        `${progress.textFiles} text · ${progress.unsupportedFiles} unsupported`;
    },
    showResult(repository, setupScript) {
      status.textContent = `Ready · ${repository.name} @ ${repository.ref}`;
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
          ...repository.unsupported.map((item) => `Unsupported: ${item.path} — ${item.reason}`),
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
    cancel.textContent = "Cancelling…";
  });
  header.insertBefore(cancel, close);

  return handle;
}
