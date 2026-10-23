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

/**
 * PowerShell looping a .wav until it is killed. It writes a dot every 200 ms
 * so the mod's read of it wakes up and can stop it.
 */
export const windowsSoundArgv = (wav: string): string[] => [
  'powershell.exe',
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  `$p = New-Object System.Media.SoundPlayer '${wav.replaceAll("'", "''")}'; ` +
    `$p.PlayLooping(); while ($true) { Write-Output '.'; Start-Sleep -Milliseconds 200 }`,
]
