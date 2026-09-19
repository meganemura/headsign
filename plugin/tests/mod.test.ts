// Tests for the plugin's function-hooks module, run by `claude plugin test plugin` with
// `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`. The kit loads the module as the engine does and
// hands each test the engine's own `$`; the hooks a test registers with `on` sit beneath the
// module, where the shell, the file system and the terminal would be. Nothing here spawns
// the real CLI: `process.run` answers from a script, so what is tested is what the module
// asks for and what it draws, not what `headsign status` prints (ADR-0030 owns that).

import type { CommandRunInput, On, RenderInput } from 'claude-code'
import { describe, expect, test, tier } from 'claude-code/testing'

tier('user')

const SESSION = { surface: 'terminal', isInteractive: true, cwd: '/work' } as const

const PANE: RenderInput<'Pane'> = {
  component: 'Pane',
  surface: 'terminal',
  requestId: 'headsign',
  viewport: { columns: 120, rows: 40 },
  props: { title: 'headsign', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
}

const HEADSIGN: CommandRunInput = { command: 'headsign', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } }

const RUNNING = 'RUNNING implement (attempt 0/5)\n\n  pick\n      │\n  ╔══════════════════╗\n  ║ implement   0/80 ║\n  ╚══════════════════╝\n      ├─ pass ─▶ review\n      └─ fail ─▶ implement   (5 attempts left)\n\nworkflow: beads-loop\nlast stop: paused by a note\n'

// The world beneath the module: a session in /work whose `.headsign/` is where `hasRun`
// says, a `headsign status` that answers from `status`, and a terminal that keeps what was
// opened, closed and asked to redraw.
function world(
  on: On,
  options: { hasRun?: boolean; status?: { exitCode: number; stdout: string; stderr: string }; sessionId?: string; registers?: boolean } = {},
) {
  const runs: (readonly string[])[] = []
  const opened: string[] = []
  const closed: string[] = []
  const logged: string[] = []
  const status = options.status ?? { exitCode: 0, stdout: RUNNING, stderr: '' }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  if (options.registers !== false) on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.cwd', () => ({ value: '/work' }))
  on('session.id', () => ({ value: options.sessionId ?? 'the-session' }))
  on('fs.exists', ($, e) => ({ value: e.path === '/work/.headsign' ? options.hasRun !== false : e.path === '/work/.git' }))
  on('process.run', ($, e) => {
    runs.push(e.argv)
    return { value: status }
  })
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { value: undefined }
  })
  on('ui.close', ($, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.log', ($, e) => {
    logged.push(e.text)
    return { value: undefined }
  })
  on('tool.call', ($, e) => ({ result: e.tool === 'Bash' ? e.command : '' }))
  return { runs, opened, closed, logged }
}

// The strings of a drawn tree, one per outer Text, with the color the Text carries and, when
// the line opens with a nested bold Text, that bold prefix on its own.
type Line = { text: string; color?: string; dim?: boolean; bold?: string }

function textOf(node: unknown): string {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node !== 'object' || node === null) return ''
  return textOf(Reflect.get(node, 'children'))
}

function linesOf(tree: unknown): Line[] {
  if (Array.isArray(tree)) return tree.flatMap(linesOf)
  if (typeof tree !== 'object' || tree === null) return []
  const type: unknown = Reflect.get(tree, 'type')
  const props: unknown = Reflect.get(tree, 'props')
  const children: unknown = Reflect.get(tree, 'children')
  if (type === 'Text') {
    const first: unknown = Array.isArray(children) ? children[0] : undefined
    const firstProps: unknown = typeof first === 'object' && first ? Reflect.get(first, 'props') : undefined
    const bold = typeof firstProps === 'object' && firstProps && Reflect.get(firstProps, 'bold') === true ? textOf(first) : undefined
    const color = typeof props === 'object' && props ? Reflect.get(props, 'color') : undefined
    const dim = typeof props === 'object' && props ? Reflect.get(props, 'dimColor') : undefined
    return [{ text: textOf(children), ...(typeof color === 'string' ? { color } : {}), ...(dim === true ? { dim } : {}), ...(bold === undefined ? {} : { bold }) }]
  }
  return linesOf(children)
}

// A hook that is not awaited by the call that started it (`headsign start` opening the pane)
// finishes after a few turns of the task queue. `setTimeout` is reached through the global
// object because the module's own declarations name no host globals.
async function settle(): Promise<void> {
  const later = (globalThis as unknown as { setTimeout: (f: () => void, ms: number) => unknown }).setTimeout
  for (let i = 0; i < 8; i += 1) await new Promise<void>((resolve) => later(resolve, 0))
}

describe('the actor stamp', () => {
  test("a headsign command in the session's own loop gets the session exported in front of it", async ($, on) => {
    world(on)
    const { result } = await $.tool.call({ tool: 'Bash', command: 'cd /work && node plugin/dist/headsign.mjs next' })
    expect(result).toEqual("export HEADSIGN_ACTOR='the-session'; cd /work && node plugin/dist/headsign.mjs next")
  })

  test("a headsign command in a subagent's loop carries the agent id after the session's", async ($, on) => {
    world(on)
    const { result } = await $.tool.call({ tool: 'Bash', command: 'headsign next', agentId: 'agent-one' } as Parameters<typeof $.tool.call>[0])
    expect(result).toEqual("export HEADSIGN_ACTOR='the-session/agent-one'; headsign next")
  })

  test('a command that does not name headsign passes through untouched', async ($, on) => {
    world(on)
    const { result } = await $.tool.call({ tool: 'Bash', command: 'npm test' })
    expect(result).toEqual('npm test')
  })

  test('a session id outside the alphabet leaves the command untouched rather than half-quoted', async ($, on) => {
    world(on, { sessionId: "the session'; rm -rf /" })
    const { result } = await $.tool.call({ tool: 'Bash', command: 'headsign status' })
    expect(result).toEqual('headsign status')
  })
})

describe('the pane', () => {
  test('/headsign opens the pane, reads status in the run directory, and closes it again', async ($, on) => {
    const kept = world(on)
    await $.session.start(SESSION)

    expect(await $.command.run(HEADSIGN)).toEqual({ text: 'headsign pane shown' })
    expect(kept.opened).toEqual(['headsign'])
    expect(kept.runs).toHaveLength(1)
    expect(kept.runs[0]?.[0]).toEqual('node')
    expect(kept.runs[0]?.[2]).toEqual('status')

    expect(await $.command.run(HEADSIGN)).toEqual({ text: 'headsign pane hidden' })
    expect(kept.closed).toEqual(['headsign'])
  })

  test('the first line is colored by its token and every other line is drawn as it came', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    await $.command.run(HEADSIGN)

    const lines = linesOf(await $.ui.render(PANE))
    expect(lines[0]).toEqual({ text: 'RUNNING implement (attempt 0/5)', color: 'yellow' })
    expect(lines[1]).toEqual({ text: ' ' })
    expect(lines[2]).toEqual({ text: '  pick' })
    expect(lines[4]).toEqual({ text: '  ╔══════════════════╗' })
    expect(lines[8]).toEqual({ text: '      └─ fail ─▶ implement   (5 attempts left)' })
    expect(lines[10]).toEqual({ text: 'workflow: beads-loop', bold: 'workflow:' })
    expect(lines[11]).toEqual({ text: 'last stop: paused by a note', bold: 'last stop:' })
    expect(lines[lines.length - 1]?.text).toContain('/headsign closes this pane')
  })

  // The split is by shape alone: a lowercase label, a colon, a space. Anything else, the
  // picture's rows included, is drawn whole.
  test('only a line shaped `label: rest` gets a bold label', async ($, on) => {
    world(on, { status: { exitCode: 0, stdout: 'RUNNING x (attempt 0)\n\n  ╔═══════╗\n\nnote: Waiting: for x\nURL: http://a\n--- phase: x ---\nDo it.\n', stderr: '' } })
    await $.session.start(SESSION)
    await $.command.run(HEADSIGN)

    const lines = linesOf(await $.ui.render(PANE))
    expect(lines[2]).toEqual({ text: '  ╔═══════╗' })
    expect(lines[4]).toEqual({ text: 'note: Waiting: for x', bold: 'note:' })
    expect(lines[5]).toEqual({ text: 'URL: http://a' })
    expect(lines[6]).toEqual({ text: '--- phase: x ---' })
    expect(lines[7]).toEqual({ text: 'Do it.' })
  })

  test('with no .headsign between the directory and the git root the pane says so and runs nothing', async ($, on) => {
    const kept = world(on, { hasRun: false })
    await $.session.start(SESSION)
    await $.command.run(HEADSIGN)

    expect(kept.runs).toEqual([])
    expect(linesOf(await $.ui.render(PANE))[0]).toEqual({ text: 'no .headsign/ between here and the Git root', dim: true })
  })

  test('exit 3 is drawn dim, as nothing to report, not as an error', async ($, on) => {
    world(on, { status: { exitCode: 3, stdout: '', stderr: 'ERROR: no run in progress\n' } })
    await $.session.start(SESSION)
    await $.command.run(HEADSIGN)

    expect(linesOf(await $.ui.render(PANE))[0]).toEqual({ text: 'ERROR: no run in progress', dim: true })
  })

  test('a headsign start from the shell opens the pane by itself', async ($, on) => {
    const kept = world(on)
    await $.session.start(SESSION)

    await $.tool.call({ tool: 'Bash', command: 'headsign start beads' })
    await settle()

    expect(kept.opened).toEqual(['headsign'])
  })

  test('a headsign command while the pane is open refreshes it once more', async ($, on) => {
    const kept = world(on)
    await $.session.start(SESSION)
    await $.command.run(HEADSIGN)
    expect(kept.runs).toHaveLength(1)

    await $.tool.call({ tool: 'Bash', command: 'headsign next' })
    await settle()

    expect(kept.runs).toHaveLength(2)
  })

  test('a refused registration leaves the session whole and says why in the transcript', async ($, on) => {
    const kept = world(on, { registers: false })
    on('command.register', () => ({ deny: 'the name is taken' }))
    await $.session.start(SESSION)

    expect(kept.logged).toHaveLength(1)
    expect(kept.logged[0]).toContain('/headsign is not available')
  })
})
