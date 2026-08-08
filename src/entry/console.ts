import { runRepo2Script } from "../index";

const marker = "__REPO2SCRIPT_ACTIVE__";
const globalState = globalThis as typeof globalThis & {
  [marker]?: boolean;
};

if (globalState[marker]) {
  console.warn("Repo2Script is already running on this page.");
} else {
  globalState[marker] = true;
  void runRepo2Script()
    .catch((error: unknown) => {
      console.error("Repo2Script stopped:", error);
    })
    .finally(() => {
      globalState[marker] = false;
    });
}
