// The plugin's one function-hooks module (a "Claude Mod"; the validator admits one per
// plugin). It has two responsibilities, kept in two sections below:
//
// 1. Draw the current run beside the transcript, in a Claude Code pane, from the text
//    `headsign status` prints. `/headsign` opens and closes the pane; a `headsign` shell
//    command or a finished turn refreshes it. This section judges, advances, and records
//    nothing about the run.
// 2. Tell the CLI who is running it. A `headsign` shell command that the session or one of
//    its subagents runs gets `HEADSIGN_ACTOR` exported in front of it, carrying the session
//    id and, for a subagent, the agent id. The CLI reads that variable when `start` and
//    `next` record who drove the run (ADR-0041). This section names the caller and decides
//    nothing about what the CLI records.
//
// Must NOT know about: the shape of `.headsign/state.json` (it never reads the file), the
// wording of any `status` line past the first (ADR-0030: the token line and the exit code
// are the contract; every other line is shown as text, never parsed), and the stop hooks,
// which stay command hooks in hooks.json so that Codex and a managed Claude Code both keep
// them (ADR-0040). A command that does not name `headsign` passes through untouched, so a
// build or a test suite the session runs inherits nothing from here.
//
// It loads only where Claude Code has function hooks enabled; everywhere else the file is
// inert. The engine's validator reads it statically, so every call on `$` is spelled
// `$.noun.event(...)` and `$` is handed only to the function declarations at the top of
// this file.

import type { Elements, On, RenderElement } from 'claude-code'

const PANE_ID = 'headsign'
const PANE_TITLE = 'headsign'
const COMMAND = 'headsign'

// The CLI ships beside this module: `<plugin>/hooks/mod.ts` and `<plugin>/dist/`.
// `import.meta.url` is the one thing a hooks module knows about its own location (measured:
// `$.env.get('CLAUDE_PLUGIN_ROOT')` answers nothing inside the module's environment).
const CLI = new URL('../dist/headsign.mjs', (import.meta as { url: string }).url).pathname

// `status` answers in well under a second; this bounds a wedged spawn, not a slow one.
const STATUS_TIMEOUT_MS = 10_000

// What one `headsign status` call left behind, kept by `refresh` and read by the render
// hook. The render hook never spawns: a pane redraws several times a second while it is
// open, and a spawn per redraw would be a spawn storm.
type Report =
  | { kind: 'no-run-dir' }
  | { kind: 'answered'; exitCode: number; stdout: string; stderr: string }
  | { kind: 'failed'; reason: string }

type Host = {
  cwd: () => Promise<string>
  exists: (path: string) => Promise<boolean>
  run: (argv: readonly string[], cwd: string) => Promise<{ exitCode: number; stdout: string; stderr: string }>
  open: () => Promise<void>
  close: () => Promise<void>
  invalidate: () => void
  log: (text: string) => void
  register: () => Promise<unknown>
}

type State = {
  host: Host | null
  isOpen: boolean
  report: Report | null
  refreshedAt: string | null
  isRefreshing: boolean
  isQueued: boolean
}

// The host is a bundle of closures over `$`, built once at `session.start`, so that the
// rest of this file never holds `$` itself. That is the validator's rule and also the
// seam a test would fake.
function hostOf($: any): Host {
  return {
    cwd: () => $.session.cwd(),
    exists: (path) => $.fs.exists(path),
    run: (argv, cwd) => $.process.run(argv, { cwd, timeoutMs: STATUS_TIMEOUT_MS }),
    open: () => $.ui.open({ id: PANE_ID, title: PANE_TITLE }),
    close: () => $.ui.close({ id: PANE_ID }),
    invalidate: () => $.ui.invalidate('ui.render'),
    log: (text) => $.ui.log(text),
    register: () => $.command.register({ name: COMMAND, description: 'Show or hide the headsign run pane' }),
  }
}

function parentOf(dir: string): string {
  const cut = dir.lastIndexOf('/')
  return cut <= 0 ? '/' : dir.slice(0, cut)
}

// The same walk the stop hooks make: up from the session's directory to the first Git
// boundary, and the first `.headsign/` on the way is the run. Past a `.git` there is
// nothing of this checkout's. `$.session.repo()` is not used because it names the main
// working tree even from a worktree, and a worktree owns its own run.
async function findRunDir(host: Host): Promise<string | null> {
  let dir = await host.cwd()
  for (;;) {
    if (await host.exists(`${dir}/.headsign`)) return dir
    if (await host.exists(`${dir}/.git`)) return null
    const parent = parentOf(dir)
    if (parent === dir) return null
    dir = parent
  }
}

async function readReport(host: Host): Promise<Report> {
  const runDir = await findRunDir(host)
  if (runDir === null) return { kind: 'no-run-dir' }
  try {
    const { exitCode, stdout, stderr } = await host.run(['node', CLI, 'status'], runDir)
    return { kind: 'answered', exitCode, stdout, stderr }
  } catch (error) {
    return { kind: 'failed', reason: error instanceof Error ? error.message : String(error) }
  }
}

// Coalesced: a refresh asked for while one is running is run once more after it, not
// in parallel, so two `headsign` commands in one turn cost two spawns at most.
async function refresh(state: State): Promise<void> {
  const host = state.host
  if (host === null) return
  if (state.isRefreshing) {
    state.isQueued = true
    return
  }
  state.isRefreshing = true
  try {
    do {
      state.isQueued = false
      state.report = await readReport(host)
      state.refreshedAt = new Date().toLocaleTimeString()
      host.invalidate()
    } while (state.isQueued)
  } finally {
    state.isRefreshing = false
  }
}

async function showPane(state: State): Promise<void> {
  const host = state.host
  if (host === null || state.isOpen) return
  await host.open()
  state.isOpen = true
  await refresh(state)
}

// The first word of `status` is its contract (ADR-0030). Anything else is drawn as it came.
function tokenColorOf(line: string): string | undefined {
  const token = line.split(' ')[0]
  if (token === 'RUNNING') return 'yellow'
  if (token === 'COMPLETE') return 'green'
  if (token === 'ESCALATED' || token === 'ABORTED') return 'red'
  return undefined
}

function linesOf(text: string): string[] {
  const lines = text.split('\n')
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

// The real element types, so the typecheck refuses a prop the engine would refuse.
type Ui = Pick<Elements['terminal'], 'Box' | 'Text'>

function bodyOf(ui: Ui, state: State): RenderElement[] {
  const { Text } = ui
  const report = state.report
  if (report === null) return [Text({ dimColor: true, children: 'reading…' })]
  if (report.kind === 'no-run-dir') return [Text({ dimColor: true, children: 'no .headsign/ between here and the Git root' })]
  if (report.kind === 'failed') return [Text({ color: 'red', children: `headsign status could not run: ${report.reason}` })]
  // Exit 3 is "nothing to report here" — a checkout with `.headsign/` and no run yet, or a
  // state file the CLI could not read. Both are ordinary and neither is an error to color.
  if (report.exitCode === 3) return [Text({ dimColor: true, children: linesOf(`${report.stdout}\n${report.stderr}`).join('\n') || 'headsign has nothing to report here' })]
  const lines = linesOf(report.stdout)
  const head = lines[0] ?? ''
  const rest = lines.slice(1)
  // A prop that is present but undefined is still a prop to the engine's allowlist check,
  // and one refused prop drops the whole tree, so the color key is added only when set.
  const color = tokenColorOf(head)
  return [
    Text({ bold: true, ...(color === undefined ? {} : { color }), children: head }),
    ...rest.map((line) => Text({ wrap: 'wrap', children: line })),
    ...(report.exitCode === 0 ? [] : [Text({ color: 'red', children: `exit ${report.exitCode}${report.stderr ? `: ${report.stderr.trim()}` : ''}` })]),
  ]
}

function paneOf(ui: Ui, state: State): RenderElement {
  const { Box, Text } = ui
  const footer = state.refreshedAt === null ? '/headsign closes this pane' : `refreshed ${state.refreshedAt} · /headsign closes this pane`
  return Box({
    flexDirection: 'column',
    paddingTop: 1,
    paddingRight: 1,
    children: [
      Box({ flexDirection: 'column', children: bodyOf(ui, state) }),
      Box({ marginTop: 1, children: [Text({ dimColor: true, children: footer })] }),
    ],
  })
}

function isHeadsignCommand(command: unknown): boolean {
  return typeof command === 'string' && /\bheadsign(\.mjs)?\s+\w/.test(command)
}

function isHeadsignStart(command: unknown): boolean {
  return typeof command === 'string' && /\bheadsign(\.mjs)?\s+start\b/.test(command)
}

// ---- 2. The actor stamp -------------------------------------------------------------------
//
// Why a rewrite of the command and not an environment for the tool: `tool.call` for Bash
// carries the command text and nothing else a hook may set for the shell. Measured on
// 2026-09-15: a rewritten `e.command` is what the shell runs; `export NAME=…; <command>`
// survives `cd … &&` and a pipeline inside the command; and the Bash tool's shell state does
// not carry the variable into the next call. The ids are checked against a narrow alphabet
// before they are written into a shell string, because they come from the engine, not from
// this file.
//
// Where the claim ceremony stays: `headsign claim` and the SubagentStop seal are still the
// path on Codex, on a Claude Code without function hooks, and on a managed Claude Code, and
// they stay correct here too. This is the shorter path where the module loads.

const ACTOR_VARIABLE = 'HEADSIGN_ACTOR'

// Session ids and agent ids are UUID-shaped or short word tokens. Anything else is refused
// rather than escaped: the command is a shell string and the ids are not this file's to trust.
function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value)
}

async function sessionIdOf($: any): Promise<unknown> {
  return $.session.id()
}

// `<session>` for the session's own loop, `<session>/<agentId>` for a subagent's. The CLI
// splits on the one slash.
function actorOf(sessionId: unknown, agentId: unknown): string | null {
  if (!isSafeId(sessionId)) return null
  if (agentId === undefined || agentId === null) return sessionId
  return isSafeId(agentId) ? `${sessionId}/${agentId}` : null
}

export function register(on: On) {
  const state: State = { host: null, isOpen: false, report: null, refreshedAt: null, isRefreshing: false, isQueued: false }

  // Registered ahead of the pane's own `tool.call` hook so that the rewrite is what that
  // hook's `next(e)` runs; the pane's matcher reads the command text after the prefix, and
  // `\b` matches there just as it did.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (!isHeadsignCommand(e.command)) return next(e)
    const actor = actorOf(await sessionIdOf($), e.agentId)
    if (actor === null) return next(e)
    return next({ ...e, command: `export ${ACTOR_VARIABLE}='${actor}'; ${e.command}` })
  })

  // ---- 1. The pane ------------------------------------------------------------------------

  on('session.start', async ($, e, next) => {
    state.host = hostOf($)
    // A failed registration (the name already taken by another plugin, say) leaves the pane
    // unreachable but the session whole; the transcript says why.
    await state.host.register().catch((error: unknown) => {
      state.host?.log(`headsign: /${COMMAND} is not available: ${error instanceof Error ? error.message : String(error)}`)
    })
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e, next) => {
    if (state.host === null) return next(e)
    if (state.isOpen) {
      await state.host.close()
      state.isOpen = false
      return { text: 'headsign pane hidden' }
    }
    await showPane(state)
    return { text: 'headsign pane shown' }
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE_ID) return next(e)
    const { Box, Text } = await $.ui.resolve(e)
    return paneOf({ Box, Text }, state)
  })

  // The person's close (Esc, ctrl+x x) reaches here too; after it the next `/headsign`
  // must open rather than try to close again.
  on('ui.close', { id: PANE_ID }, async ($, e, next) => {
    const result = await next(e)
    if (result.deny === undefined) state.isOpen = false
    return result
  })

  // A `headsign` command may have changed the run (a `status` did not, and costs one
  // spawn more; the coalescer above bounds that); a `headsign start` begins one, and the
  // pane opens itself for it. Refresh after the tool ran, whichever loop ran it.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    try {
      return await next(e)
    } finally {
      if (isHeadsignStart(e.command) && !state.isOpen) void showPane(state).catch(() => undefined)
      else if (state.isOpen && isHeadsignCommand(e.command)) void refresh(state).catch(() => undefined)
    }
  })

  // Fires after the stop hooks have run (measured), so `last stop:` is current by now.
  on('turn.complete', ($, e, next) => {
    if (state.isOpen) void refresh(state).catch(() => undefined)
    return next(e)
  })
}
