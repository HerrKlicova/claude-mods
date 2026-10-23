import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'tecleo',
  component: 'Pane',
  requestId: 'tecleo',
  props: {
    title: 'Tecleo',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const EDIT_RESULT = {
  filePath: '/repo/src/auth.ts',
  oldString: 'if (!token) return null',
  newString: "if (!token) {\n  log.warn('sin token')\n  return null\n}",
  originalFile: 'x',
  structuredPatch: [
    {
      oldStart: 40,
      oldLines: 3,
      newStart: 40,
      newLines: 6,
      lines: [
        ' const user = await load(id)',
        '-if (!token) return null',
        '+if (!token) {',
        "+  log.warn('sin token')",
        '+  return null',
        '+}',
        ' return user',
      ],
    },
  ],
  userModified: false,
  replaceAll: false,
}

const texts = (tree: unknown): string => JSON.stringify(tree)

test('an edit opens the pane and is typed in, then played', async ($, on) => {
  const clock = mock.clock(on)
  const opened: string[] = []
  const closed: string[] = []
  on('ui.close', (_, e) => {
    closed.push(e.id)

    return { value: undefined }
  })
  on('command.register', () => ({ value: { command: 'tecleo' } }))
  on('ui.open', (_, e) => {
    opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: EDIT_RESULT }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ran = await $.tool.call({
    tool: 'Edit',
    file_path: '/repo/src/auth.ts',
    old_string: 'if (!token) return null',
    new_string: EDIT_RESULT.newString,
  })
  expect(ran.result).toEqual(EDIT_RESULT)
  expect(opened).toEqual(['tecleo'])

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.resize({ columns: 60, rows: 20, in: 'typer' })
  await ui.advance(66)
  const start = texts(await ui.drawn({ in: 'typer' }))
  expect(start).toContain('auth.ts')
  expect(start).toContain('/repo/src/')
  expect(start).toContain('if (!token) return null')
  expect(start).not.toContain('sin token')

  // Part way: some of the new code is there, not all of it.
  await ui.advance(400)
  const middle = texts(await ui.drawn({ in: 'typer' }))
  expect(middle).toContain('if (!token) {')

  // Done: the whole edit stands and the entry is posted as played.
  await ui.advance(3000)
  const end = texts(await ui.drawn({ in: 'typer' }))
  expect(end).toContain("log.warn('sin token')")
  expect(end).toContain('return user')
  const pane = texts(await ui.drawn())
  expect(pane).toContain('"queue":[]')

  // Quiet for a while: the pane closes itself.
  await clock.advance(5000)
  expect(closed).toEqual([])
  await clock.advance(5000)
  expect(closed).toEqual(['tecleo'])
  await ui.unmount()
})

test('a surface with no Client shows the diff whole', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', () => ({
    result: {
      type: 'create',
      filePath: '/repo/hola.py',
      content: 'print("hola")\n',
      structuredPatch: [],
      originalFile: null,
    },
  }))
  await $.tool.call({ tool: 'Write', file_path: '/repo/hola.py', content: 'print("hola")\n' })

  for (const surface of ['vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const tree = texts(await ui.drawn())
    expect(tree).toContain('hola.py')
    expect(tree).toContain('nuevo')
    expect(tree).toContain('+print(\\"hola\\")')
    await ui.unmount()
  }
})

test('a refused or failed call shows nothing and passes through', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', () => ({ result: 'boom', isError: true }))
  const ran = await $.tool.call({ tool: 'Edit', file_path: '/a', old_string: 'a', new_string: 'b' })
  expect(ran.isError).toBe(true)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Esperando/ }))?.text).toContain('Esperando')
  await ui.unmount()
})

test('a result of the wrong shape still answers the tool', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', () => ({ result: { odd: true } }))
  const ran = await $.tool.call({ tool: 'Edit', file_path: '/a.ts', old_string: 'a', new_string: 'b' })
  expect(ran.result).toEqual({ odd: true })
})

test('a huge file is shown at once, not typed', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const content = Array.from({ length: 900 }, (_, i) => `line ${i}`).join('\n')
  on('tool.call', () => ({
    result: { type: 'create', filePath: '/big.txt', content, structuredPatch: [], originalFile: null },
  }))
  await $.tool.call({ tool: 'Write', file_path: '/big.txt', content })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.resize({ columns: 60, rows: 20, in: 'typer' })
  await ui.advance(66)
  const tree = texts(await ui.drawn({ in: 'typer' }))
  expect(tree).toContain('grande, sin animar')
  expect(tree).toContain('line 899')
  await ui.unmount()
})

test('several edits queue up and the touched files can be replayed', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  let n = 0
  on('tool.call', () => {
    n += 1

    return {
      result: {
        type: 'create',
        filePath: `/repo/f${n}.ts`,
        content: `export const n = ${n}\n`,
        structuredPatch: [],
        originalFile: null,
      },
    }
  })
  for (let i = 0; i < 3; i++) {
    await $.tool.call({ tool: 'Write', file_path: `/repo/f${i}.ts`, content: 'x' })
  }

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.resize({ columns: 60, rows: 20, in: 'typer' })
  await ui.advance(66)
  expect(texts(await ui.drawn({ in: 'typer' }))).toContain('2 en cola')
  for (let i = 0; i < 30; i++) await ui.advance(200)
  expect(texts(await ui.drawn())).toContain('"queue":[]')

  await ui.press({ key: 'f1' })
  expect(texts(await ui.drawn())).toContain('"pending":1')
  await ui.advance(66)
  expect(texts(await ui.drawn({ in: 'typer' }))).toContain('f1.ts')
  await ui.unmount()
})
