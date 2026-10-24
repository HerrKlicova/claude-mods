// Windows has no player for `$.audio.play`: there PowerShell plays the clip.

/** A path that names a Windows drive or share. */
export const isWindowsPath = (path: string): boolean =>
  /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\')

/** The clip's absolute path, in the plugin's folder. */
export const assetPath = (root: string, asset: string): string => {
  const separator = isWindowsPath(root) ? '\\' : '/'
  const base = root.replace(/[\\/]+$/, '')

  return `${base}${separator}${asset.split('/').join(separator)}`
}

/** How long one PowerShell plays at most; the mod starts another if needed. */
export const WINDOWS_PLAY_S = 60

/**
 * The PowerShell script that loops a .wav. It first writes its own process
 * id, so the mod can kill it, then a dot every 200 ms so the mod's read of it
 * wakes up. It plays only while the window in front is Claude's (a process
 * it descends from, or one named Claude or WindowsTerminal), so nothing
 * sounds while the person is in another program. It stops by itself after
 * WINDOWS_PLAY_S, or once the process that started it is gone.
 */
export const windowsSoundScript = (wav: string): string =>
  [
    'Write-Output "pid:$PID"',
    'Add-Type -Name Fg -Namespace Tecleo -MemberDefinition \'[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);\'',
    '$pp = (Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId',
    '$mine = @{}',
    '$id = $PID',
    'for ($i = 0; $i -lt 16 -and $id; $i++) { $mine[[int]$id] = $true; $id = (Get-CimInstance Win32_Process -Filter "ProcessId=$id").ParentProcessId }',
    'function Test-Seen { [uint32]$fp = 0; [void][Tecleo.Fg]::GetWindowThreadProcessId([Tecleo.Fg]::GetForegroundWindow(), [ref]$fp); if ($mine.ContainsKey([int]$fp)) { return $true }; $name = (Get-Process -Id $fp -ErrorAction SilentlyContinue).ProcessName; return ($name -match \'^(claude|windowsterminal)$\') }',
    `$p = New-Object System.Media.SoundPlayer '${wav.replaceAll("'", "''")}'`,
    '$on = $false',
    `$end = (Get-Date).AddSeconds(${WINDOWS_PLAY_S})`,
    'while ((Get-Date) -lt $end -and (Get-Process -Id $pp -ErrorAction SilentlyContinue)) { $seen = Test-Seen; if ($seen -and -not $on) { $p.PlayLooping(); $on = $true } elseif (-not $seen -and $on) { $p.Stop(); $on = $false }; Write-Output \'.\'; Start-Sleep -Milliseconds 200 }',
    '$p.Stop()',
  ].join('\n')

const BASE64 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// A script as `-EncodedCommand` takes it: UTF-16LE, base64. No quoting of the
// command line can then reach PowerShell's parser.
export const encodeCommand = (script: string): string => {
  const bytes: number[] = []
  for (let i = 0; i < script.length; i++) {
    const code = script.charCodeAt(i)
    bytes.push(code & 0xff, code >> 8)
  }
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const [a = 0, b = 0, c = 0] = [bytes[i], bytes[i + 1], bytes[i + 2]]
    const n = (a << 16) | (b << 8) | c
    out += BASE64[(n >> 18) & 63]! + BASE64[(n >> 12) & 63]!
    out += i + 1 < bytes.length ? BASE64[(n >> 6) & 63]! : '='
    out += i + 2 < bytes.length ? BASE64[n & 63]! : '='
  }

  return out
}

export const windowsSoundArgv = (wav: string): string[] => [
  'powershell.exe',
  '-NoProfile',
  '-NonInteractive',
  '-WindowStyle',
  'Hidden',
  '-EncodedCommand',
  encodeCommand(windowsSoundScript(wav)),
]

/** The process id a PowerShell of `windowsSoundArgv` wrote first. */
export const pidOf = (text: string): number | undefined => {
  const match = /pid:(\d+)/.exec(text)

  return match === null ? undefined : Number(match[1])
}
