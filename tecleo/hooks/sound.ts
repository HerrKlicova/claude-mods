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
export const WINDOWS_PLAY_S = 15

/**
 * PowerShell looping a .wav. It first writes its own process id, so the mod
 * can kill it, then a dot every 200 ms so the mod's read of it wakes up. It
 * stops by itself after WINDOWS_PLAY_S, or once the process that started it
 * is gone, so it never outlives Claude.
 */
export const windowsSoundArgv = (wav: string): string[] => [
  'powershell.exe',
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  [
    'Write-Output "pid:$PID"',
    '$pp = (Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId',
    `$p = New-Object System.Media.SoundPlayer '${wav.replaceAll("'", "''")}'`,
    '$p.PlayLooping()',
    `$end = (Get-Date).AddSeconds(${WINDOWS_PLAY_S})`,
    "while ((Get-Date) -lt $end -and (Get-Process -Id $pp -ErrorAction SilentlyContinue)) { Write-Output '.'; Start-Sleep -Milliseconds 200 }",
    '$p.Stop()',
  ].join('; '),
]

/** The process id a PowerShell of `windowsSoundArgv` wrote first. */
export const pidOf = (text: string): number | undefined => {
  const match = /pid:(\d+)/.exec(text)

  return match === null ? undefined : Number(match[1])
}
