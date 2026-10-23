import { expect, mock, test } from 'claude-code/testing'

import { splitPath } from '../hooks/entries'

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
  await ui.advance(500)
  const middle = texts(await ui.drawn({ in: 'typer' }))
  expect(middle).toContain('if (!token) {')
  expect(middle).not.toContain("log.warn('sin token')")

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

test('without a Client the mod types it itself: desktop, vscode, mobile', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', () => ({ result: EDIT_RESULT }))

  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    await $.tool.call({
      tool: 'Edit',
      file_path: '/repo/src/auth.ts',
      old_string: 'if (!token) return null',
      new_string: EDIT_RESULT.newString,
    })
    const ui = await $.ui.mount({ ...PANE, surface })
    const start = texts(await ui.drawn())
    expect(start).toContain('auth.ts')
    expect(start).toContain('-if (!token) return null')
    expect(start).not.toContain('sin token')

    // Still taking the old line out: nothing new typed yet.
    for (let i = 0; i < 2; i++) await clock.advance(80)
    expect(texts(await ui.drawn())).not.toContain('+if')

    for (let i = 0; i < 40; i++) await clock.advance(80)
    const end = texts(await ui.drawn())
    expect(end).toContain("+  log.warn('sin token')")
    expect(end).toContain('+}')
    expect(end).toContain(' return user')
    await ui.unmount()
  }
})

test('/tecleo demo plays a sample edit', async ($, on) => {
  const clock = mock.clock(on)
  on('command.register', () => ({ value: { command: 'tecleo' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ran = await $.command.run({ command: 'tecleo', args: 'demo' } as never)
  expect(ran.text).toContain('Demo')

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  for (let i = 0; i < 40; i++) await clock.advance(80)
  expect(texts(await ui.drawn())).toContain("console.warn('sin nombre')")
  await ui.unmount()
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

test('a huge file types only its first added lines and sums up the rest', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const content = Array.from({ length: 900 }, (_, i) => `line ${i}`).join('\n')
  on('tool.call', () => ({
    result: { type: 'create', filePath: '/big.txt', content, structuredPatch: [], originalFile: null },
  }))
  await $.tool.call({ tool: 'Write', file_path: '/big.txt', content })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.resize({ columns: 60, rows: 20, in: 'typer' })
  await ui.advance(66)
  const start = texts(await ui.drawn({ in: 'typer' }))
  expect(start).toContain('grande: solo lo añadido')
  expect(start).toContain('840 líneas añadidas más')
  expect(start).not.toContain('line 5')

  for (let i = 0; i < 40; i++) await ui.advance(200)
  const end = texts(await ui.drawn({ in: 'typer' }))
  expect(end).toContain('line 59')
  expect(end).not.toContain('line 60')
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

const write = (path: string, content: string) => ({
  result: { type: 'create', filePath: path, content, structuredPatch: [], originalFile: null },
})

test('splitPath cuts Windows paths, / paths and bare names', () => {
  expect(splitPath('C:\\repo\\src\\auth.ts')).toEqual({ name: 'auth.ts', folder: 'C:\\repo\\src\\' })
  expect(splitPath('C:\\repo/src\\auth.ts')).toEqual({ name: 'auth.ts', folder: 'C:\\repo/src\\' })
  expect(splitPath('/repo/src/auth.ts')).toEqual({ name: 'auth.ts', folder: '/repo/src/' })
  expect(splitPath('auth.ts')).toEqual({ name: 'auth.ts', folder: '' })
})

test('a Windows path shows its file name in the header and under Tocados', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', () => ({ result: { ...EDIT_RESULT, filePath: 'C:\\repo\\src\\auth.ts' } }))
  await $.tool.call({ tool: 'Edit', file_path: 'C:\\repo\\src\\auth.ts', old_string: 'a', new_string: 'b' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    if (surface === 'terminal') {
      await ui.resize({ columns: 60, rows: 20, in: 'typer' })
      await ui.advance(66)
    }
    const header = await ui.find({ type: 'Text', text: /✎/, ...(surface === 'terminal' ? { in: 'typer' } : {}) } as never)
    expect(header?.text).toBe('✎ auth.ts')
    const touched = await ui.find({ type: 'Button', key: 'f1' } as never)
    expect(touched?.text).toBe('auth.ts')
    await ui.unmount()
  }
})

test('pause, skip and speed from the pane and from /tecleo', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.register', () => ({ value: { command: 'tecleo' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  let n = 0
  on('tool.call', () => write(`/repo/p${++n}.ts`, `export const p = ${n}\n`))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'Write', file_path: '/repo/p1.ts', content: 'x' })
  await $.tool.call({ tool: 'Write', file_path: '/repo/p2.ts', content: 'x' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'pausa' } as never)
  expect(texts(await ui.drawn())).toContain('en pausa')
  for (let i = 0; i < 40; i++) await clock.advance(80)
  // Paused: nothing typed yet.
  expect(texts(await ui.drawn())).not.toContain('export const p = 1')

  await ui.press({ key: 'saltar' } as never)
  expect(texts(await ui.drawn())).toContain('p2.ts')
  expect(texts(await ui.drawn())).not.toContain('en cola')

  const ran = await $.command.run({ command: 'tecleo', args: 'pausa' } as never)
  expect(ran.text).toContain('reanudado')
  expect(texts(await ui.drawn())).not.toContain('en pausa')

  expect(texts(await ui.drawn())).toContain('Velocidad: normal')
  await ui.press({ key: 'velocidad' } as never)
  expect(texts(await ui.drawn())).toContain('Velocidad: rapido')
  const slow = await $.command.run({ command: 'tecleo', args: 'lento' } as never)
  expect(slow.text).toContain('lento')
  expect(texts(await ui.drawn())).toContain('Velocidad: lento')
  expect((await $.command.run({ command: 'tecleo', args: 'rapido' } as never)).text).toContain('rapido')
  expect((await $.command.run({ command: 'tecleo', args: 'saltar' } as never)).text).toContain('saltada')
  expect((await $.command.run({ command: 'tecleo', args: 'saltar' } as never)).text).toContain('nada')
  await ui.unmount()
})

test('a terminal Client stands still while paused', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', () => ({ result: EDIT_RESULT }))
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/auth.ts', old_string: 'a', new_string: 'b' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.resize({ columns: 60, rows: 20, in: 'typer' })
  await ui.press({ key: 'pausa' } as never)
  await ui.advance(4000)
  const still = texts(await ui.drawn({ in: 'typer' }))
  expect(still).toContain('en pausa')
  expect(still).not.toContain('sin token')
  await ui.press({ key: 'pausa' } as never)
  await ui.advance(4000)
  expect(texts(await ui.drawn({ in: 'typer' }))).toContain("log.warn('sin token')")
  await ui.unmount()
})

test('a backlog says how many it skipped, and Ver plays them', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  let n = 0
  on('tool.call', () => write(`/repo/s${++n}.ts`, `export const s = ${n}\n`))
  for (let i = 0; i < 7; i++) {
    await $.tool.call({ tool: 'Write', file_path: 'x', content: 'x' })
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(texts(await ui.drawn())).toContain('2 cambios saltados')
  expect(texts(await ui.drawn())).toContain('s3.ts')

  await ui.press({ key: 'ver-saltados' } as never)
  const tree = texts(await ui.drawn())
  expect(tree).not.toContain('cambios saltados')
  expect(tree).toContain('s1.ts')
  expect(tree).toContain('6 en cola')
  await ui.unmount()
})

test('the pane waits for what is queued to play before it closes', async ($, on) => {
  const clock = mock.clock(on)
  const closed: string[] = []
  on('ui.close', (_, e) => {
    closed.push(e.id)

    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  // About 360 characters: some 12 seconds at lento, 1.5 at rapido.
  const content = Array.from({ length: 12 }, (_, i) => `const value${i} = compute(${i}, 'x')`).join('\n')
  on('tool.call', () => write('/repo/long.ts', content))

  await $.command.run({ command: 'tecleo', args: 'lento' } as never)
  await $.tool.call({ tool: 'Write', file_path: '/repo/long.ts', content })
  await clock.advance(10_000)
  expect(closed).toEqual([])
  await clock.advance(12_000)
  expect(closed).toEqual(['tecleo'])
})

test('the close comes sooner at rapido', async ($, on) => {
  const clock = mock.clock(on)
  const closed: string[] = []
  on('ui.close', (_, e) => {
    closed.push(e.id)

    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const content = Array.from({ length: 12 }, (_, i) => `const value${i} = compute(${i}, 'x')`).join('\n')
  on('tool.call', () => write('/repo/long.ts', content))
  await $.command.run({ command: 'tecleo', args: 'rapido' } as never)
  await $.tool.call({ tool: 'Write', file_path: '/repo/long.ts', content })
  await clock.advance(11_000)
  expect(closed).toEqual(['tecleo'])
})

test('one file shows Tocados, and any entry of the history plays again', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  let n = 0
  on('tool.call', () => {
    n += 1

    return n === 1 ? { result: EDIT_RESULT } : { result: { ...EDIT_RESULT, structuredPatch: [{ ...EDIT_RESULT.structuredPatch[0]!, lines: [' a', `+b${n}`] }] } }
  })
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/auth.ts', old_string: 'a', new_string: 'b' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.resize({ columns: 60, rows: 20, in: 'typer' })
  expect(texts(await ui.drawn())).toContain('Tocados:')
  for (let i = 0; i < 30; i++) await ui.advance(200)
  expect(texts(await ui.drawn())).toContain('"queue":[]')

  // The same entry, just played, plays again.
  await ui.press({ key: 'f1' } as never)
  expect(texts(await ui.drawn())).toContain('"pending":1')
  for (let i = 0; i < 30; i++) await ui.advance(200)
  expect(texts(await ui.drawn())).toContain('"queue":[]')

  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/auth.ts', old_string: 'a', new_string: 'b' })
  for (let i = 0; i < 30; i++) await ui.advance(200)
  await ui.press({ key: 'historial' } as never)
  const history = texts(await ui.drawn())
  expect(history).toContain('Historial:')
  expect(history).toContain('"key":"h1"')
  expect(history).toContain('"key":"h2"')
  // The older edit of the same file, which Tocados no longer offers.
  await ui.press({ key: 'h1' } as never)
  await ui.advance(66)
  expect(texts(await ui.drawn({ in: 'typer' }))).toContain('-if (!token) return null')
  await ui.advance(3000)
  expect(texts(await ui.drawn({ in: 'typer' }))).toContain('sin token')
  await ui.unmount()
})

test('a command that writes files shows a terminal notice; one that reads, nothing', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', () => ({ result: { stdout: '', stderr: '' } }))
  await $.tool.call({ tool: 'Bash', command: 'ls -la && cat a.txt 2>&1' })
  const empty = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(texts(await empty.drawn())).toContain('Esperando')
  await empty.unmount()

  await $.tool.call({ tool: 'Bash', command: 'echo hola > notas.txt 2>/dev/null' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const tree = texts(await ui.drawn())
  expect(tree).toContain('archivo cambiado por terminal')
  expect(tree).toContain('notas.txt')
  expect(tree).toContain('echo hola')
  await ui.unmount()
})

test('a PowerShell command and sed -i are noticed too', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', () => ({ result: { stdout: '', stderr: '' } }))
  await $.tool.call({ tool: 'PowerShell', command: "Set-Content -Path C:\\repo\\a.txt -Value 'x'" } as never)
  await $.tool.call({ tool: 'Bash', command: "sed -i 's/a/b/' src/b.ts" })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'historial' } as never)
  const tree = texts(await ui.drawn())
  expect(tree).toContain('⌨ a.txt')
  expect(tree).toContain('⌨ b.ts')
  await ui.unmount()
})

test('once the queue empties the pane sums up the run', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  let n = 0
  on('tool.call', () => (++n === 3 ? { result: EDIT_RESULT } : write(`/repo/r${n}.ts`, 'a\nb\n')))
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Write', file_path: 'x', content: 'x' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(texts(await ui.drawn())).not.toContain('✓')
  for (let i = 0; i < 120; i++) await clock.advance(80)
  expect(texts(await ui.drawn())).toContain('✓ 3 archivos, +8 −1')

  // A new write starts a new run.
  await $.tool.call({ tool: 'Write', file_path: 'x', content: 'x' })
  expect(texts(await ui.drawn())).not.toContain('✓')
  await ui.unmount()
})

test('Abrir en editor opens the file on the line typing ended', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const runs: (readonly string[])[] = []
  on('process.run', (_, e) => {
    runs.push(e.argv)

    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(String((e as { text?: unknown }).text ?? JSON.stringify(e)))

    return { value: undefined }
  })
  let path = '/repo/src/auth.ts'
  on('tool.call', () => ({ result: { ...EDIT_RESULT, filePath: path } }))
  await $.tool.call({ tool: 'Edit', file_path: path, old_string: 'a', new_string: 'b' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'editor' } as never)
  expect(runs[0]).toEqual(['code', '-g', '/repo/src/auth.ts:44'])
  expect(toasts.join()).toContain('auth.ts:44')

  path = 'C:\\repo\\src\\auth.ts'
  await $.tool.call({ tool: 'Edit', file_path: path, old_string: 'a', new_string: 'b' })
  for (let i = 0; i < 120; i++) await clock.advance(80)
  await ui.press({ key: 'editor' } as never)
  expect(runs[1]).toEqual(['cmd', '/c', 'code', '-g', 'C:\\repo\\src\\auth.ts:44'])
  await ui.unmount()
})

test('the editor command can be set', { options: { editor: 'subl {archivo}:{linea}' } } as never, async ($, on) => {
  const clock = mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.register', () => ({ value: { command: 'tecleo' } }))
  const runs: (readonly string[])[] = []
  on('process.run', (_, e) => {
    runs.push(e.argv)

    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.call', () => ({ result: EDIT_RESULT }))
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/auth.ts', old_string: 'a', new_string: 'b' })
  const ran = await $.command.run({ command: 'tecleo', args: 'editor' } as never)
  expect(ran.text).toContain('Abierto auth.ts:44')
  expect(runs[0]).toEqual(['subl', '/repo/src/auth.ts:44'])
})

test('no typing sound unless it is turned on', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const played: unknown[] = []
  on('audio.play', (_, e) => {
    played.push(e)

    return { value: undefined }
  })
  on('tool.call', () => ({ result: EDIT_RESULT }))
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/auth.ts', old_string: 'a', new_string: 'b' })
  expect(played).toEqual([])
})

test('with sonido on, a typing sound loops while an entry types', { options: { sonido: true } } as never, async ($, on) => {
  const clock = mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const played: { clip: unknown; shouldLoop: boolean }[] = []
  on('audio.play', (_, e) => {
    played.push(e)

    return new Promise(() => undefined) as never
  })
  on('tool.call', () => ({ result: EDIT_RESULT }))
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/auth.ts', old_string: 'a', new_string: 'b' })
  expect(played).toHaveLength(1)
  expect(played[0]).toMatchObject({ clip: { asset: 'sounds/tecleo.wav' }, shouldLoop: true })
})

test('the sound turns on and off from the pane and from /tecleo sonido', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.register', () => ({ value: { command: 'tecleo' } }))
  const played: unknown[] = []
  on('audio.play', (_, e) => {
    played.push(e)

    return new Promise(() => undefined) as never
  })
  on('tool.call', () => ({ result: EDIT_RESULT }))
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/auth.ts', old_string: 'a', new_string: 'b' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(texts(await ui.drawn())).toContain('🔇 Sonido')
  expect(played).toHaveLength(0)

  await ui.press({ key: 'sonido' } as never)
  expect(texts(await ui.drawn())).toContain('🔊 Sonido')
  expect(played).toHaveLength(1)

  const off = await $.command.run({ command: 'tecleo', args: 'sonido' } as never)
  expect(off.text).toContain('desactivado')
  expect(texts(await ui.drawn())).toContain('🔇 Sonido')
  const again = await $.command.run({ command: 'tecleo', args: 'sonido' } as never)
  expect(again.text).toContain('activado')
  expect(played).toHaveLength(2)
  await ui.unmount()
})
