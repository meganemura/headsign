# ADOPTION_PAIN — headsign (rocky local dogfood)

Date: 2026-09-24 (JST)

## Setup
- Worktree: `headsign-archstrict-adopt` from `origin/main`
- Install: `file:../archstrict` (local unpublished)
- Result: `npx archstrict check` exit 0; `todo` firstRun with 0 freezable debt

## Frictions

### 1. `src/*` discovers zero modules (archstrict-lh9)
`src/` is flat — only loose `.ts` files, no subdirectories. `init 'src/*'` wrote an empty `declaredModules` and `ModuleName = never`.

### 2. Whole-tree analysis without seeded excludes (archstrict-4fq)
Without hand-written excludes, `tests/`, `plugin/`, `example.headsign/` would flood `uncovered-module`.

### 3. Hand-edited module vs regenerated types (archstrict-re9)
After adding `{ name: "headsign", glob: "src/**" }`, `ModuleName` had to be patched by hand from `never` to `"headsign"`.

### 4. No `index.ts` surface (expected for first adopt)
Single module has no public-surface file (`modules without a public surface: 1`). Fine while everything lives in one module; refining later needs a real surface or multi-entry story.

## What made it operational
- `exclude`: tests/plugin/example.headsign/dist/coverage/scripts/features/fixtures + root `*.ts`
- Single module `{ name: "headsign", glob: "src/**", surface: "index.ts" }`
- Patched `ModuleName` to `"headsign"`
