import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = path.resolve(packageRoot, "../..");

/** Product skill XML files used by integration-style framework tests. */
export const APP_SKILLS_DIR = path.join(repoRoot, "apps/personal-assistant/data/skills");
