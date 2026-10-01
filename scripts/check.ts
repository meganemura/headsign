// Check the shipped skills and contributor documentation without executing skill commands.
// Historical ADRs describe retired artifacts, so their links stay outside this check.
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distribution = resolve(root, "skills");
const skills = ["create-project-skill", "improve-project-skill"];
const failures: string[] = [];
const report = (message: string) => failures.push(message);
const label = (path: string) => relative(root, path);
const read = (path: string) => readFileSync(path, "utf8");

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

function inside(path: string, boundary: string): boolean {
  const rel = relative(boundary, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep);
}

function checkReference(source: string, target: string, boundary: string): void {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(target)) return;
  const path = resolve(dirname(source), decodeURIComponent(target.split(/[?#]/)[0]));
  if (!inside(path, boundary)) {
    report(`${label(source)}: reference leaves its distribution: ${target}`);
  } else if (!existsSync(path)) {
    report(`${label(source)}: missing reference: ${target}`);
  } else if (!inside(realpathSync(path), realpathSync(boundary))) {
    report(`${label(source)}: reference resolves outside its distribution: ${target}`);
  }
}

function checkMarkdown(path: string, boundary: string, standalone = false): void {
  const text = read(path);
  // Fenced examples are instructions for a future checkout, not shipped files.
  const prose = text.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, "");
  for (const match of prose.matchAll(/\[[^\]\n]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+["'][^\n]*?["'])?\)/g)) {
    checkReference(path, match[1] ?? match[2], boundary);
  }
  for (const match of prose.matchAll(/^\s*\[[^\]\n]+\]:\s*(?:<([^>]+)>|(\S+))/gm)) {
    checkReference(path, match[1] ?? match[2], boundary);
  }
  if (standalone) {
    for (const match of prose.matchAll(/`(references\/[^`\n]+)`/g)) {
      checkReference(path, match[1], boundary);
    }
  }
}

try {
  for (const name of skills) {
    const directory = resolve(distribution, name);
    const path = resolve(directory, "SKILL.md");
    const header = read(path).match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
    if (!header || !new RegExp(`^name: ${name}$`, "m").test(header)) {
      report(`${label(path)}: frontmatter name must match the skill directory`);
    }
    const description = header?.match(/^description:\s*(.*)((?:\r?\n[ \t]+[^\n]*)*)/m);
    if (!description || !`${description[1].replace(/^[>|][-+]?$/, "").replace(/^(["'])\1$/, "")}${description[2]}`.trim()) {
      report(`${label(path)}: frontmatter needs a description`);
    }
    for (const file of files(directory)) {
      if (file.endsWith(".md")) checkMarkdown(file, directory, true);
    }
  }
  for (const entry of readdirSync(distribution)) {
    if (!skills.includes(entry)) report(`skills/${entry}: unexpected distribution entry`);
  }
  const contributorSkills = resolve(root, ".agents/skills");
  if (existsSync(contributorSkills)) {
    for (const path of files(contributorSkills)) {
      if (path.endsWith(".md")) checkMarkdown(path, root);
    }
  }
  for (const path of files(resolve(root, ".github/workflows"))) {
    if (/\bnpm\s+(?:publish|exec\s+--\s+npm\s+publish)\b|registry\.npmjs\.org/.test(read(path))) {
      report(`${label(path)}: npm distribution is retired`);
    }
  }
  const docs = files(resolve(root, "docs")).filter(path => !inside(path, resolve(root, "docs/adr")));
  const top = readdirSync(root).filter(name => name.endsWith(".md")).map(name => resolve(root, name));
  for (const path of [...top, ...docs]) {
    if (path.endsWith(".md")) checkMarkdown(path, root);
  }
} catch (error) {
  report(error instanceof Error ? error.message : String(error));
}

if (failures.length) {
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
} else {
  console.log("Checked two standalone skills and active documentation links.");
}
