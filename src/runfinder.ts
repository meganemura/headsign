// Responsibility: locate a run by walking upward from a hook-provided directory.
// The walk stops at the first Git boundary so a hook cannot adopt a run from a parent repository.
// Must NOT read or change run state.

import fs from "node:fs";
import path from "node:path";
import { statePath } from "./state.ts";

export function findRunDir(startDir: string): string | null {
  let dir = startDir;
  for (;;) {
    if (fs.existsSync(statePath(dir))) return dir;
    if (fs.existsSync(path.join(dir, ".git"))) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
