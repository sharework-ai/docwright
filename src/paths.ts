import { spawnSync } from 'node:child_process'
import { relative, resolve } from 'node:path'
import { DEFAULT_MATERIALS_ROOT, DEFAULT_OUTPUT_ROOT } from './config.ts'

const WINDOWS_DRIVE_PATH = /^([A-Za-z]):[\\/](.*)$/

/** Per-binary availability cache for the wslpath probe (memoized lazily). */
const wslpathAvailable = new Map<string, boolean>()

/**
 * Translate one Windows drive-letter path through the WSL-native `wslpath`
 * binary, which honors the distro's actual mount configuration. Returns
 * `undefined` when the binary is missing, fails, or times out — the regex
 * fallback then applies. `bin` exists so tests can exercise the failure path.
 */
export function wslpathTranslate(ref: string, bin = 'wslpath'): string | undefined {
  let available = wslpathAvailable.get(bin)
  if (available === undefined) {
    available = spawnSync(bin, ['-u', 'C:\\'], { shell: false, timeout: 2000 }).status === 0
    wslpathAvailable.set(bin, available)
  }
  if (!available) return undefined
  const result = spawnSync(bin, ['-u', ref], { shell: false, timeout: 2000, encoding: 'utf8' })
  if (result.status !== 0) return undefined
  const out = result.stdout.trim()
  return out.length > 0 ? out : undefined
}

/** Regex translation for default-mounted drives: `D:\x\y` → `/mnt/d/x/y`. */
function regexWindowsToWsl(ref: string): string {
  const match = WINDOWS_DRIVE_PATH.exec(ref)!
  return `/mnt/${match[1]!.toLowerCase()}/${match[2]!.replace(/\\/g, '/')}`
}

/**
 * Normalize a Windows drive-letter path (`D:\x\y` or `D:/x/y`) to its WSL
 * mount, because a Linux-side tool otherwise treats the whole backslash
 * string as one filename. Prefers the `wslpath` binary (respects custom
 * mount roots in /etc/wsl.conf) and falls back to the default-mount regex.
 * Only applied on Linux (a Windows host resolves drive paths natively);
 * everything else passes through unchanged. The subprocess only runs for
 * drive-letter-shaped references, never for ordinary POSIX paths.
 */
export function normalizeWindowsPath(
  ref: string,
  wslpath: (ref: string) => string | undefined = wslpathTranslate,
): string {
  if (process.platform !== 'linux') return ref
  if (!WINDOWS_DRIVE_PATH.test(ref)) return ref
  return wslpath(ref) ?? regexWindowsToWsl(ref)
}

/** Minimal execution-context shape docwright reads; avoids importing dsh types. */
export interface SessionWorkspaceCarrier {
  readonly agent?: { readonly session?: { readonly cwd?: string } } | undefined
}

/**
 * Per-call workspace root: the session's workspace directory (the
 * conversation's cwd, e.g. the folder picked in the dsh web UI) wins; a
 * session-less call (scripts, tests) falls back to config `workspaceRoot`,
 * then the process cwd.
 */
export function effectiveWorkspaceRoot(
  exec: SessionWorkspaceCarrier | undefined,
  configRoot: string | undefined,
): string {
  const sessionCwd = exec?.agent?.session?.cwd
  if (typeof sessionCwd === 'string' && sessionCwd.length > 0) return resolve(normalizeWindowsPath(sessionCwd))
  return resolve(configRoot !== undefined && configRoot.length > 0 ? normalizeWindowsPath(configRoot) : process.cwd())
}

/**
 * Resolve one configured root (`materialsRoot` / `outputRoot`) inside the
 * workspace root. A relative spec joins onto the workspace root; an absolute
 * spec is taken as-is; either way the result must stay lexically inside the
 * workspace root, because containment, receipts, and upstream verification
 * all anchor there. Escapes fail loud naming the config key.
 */
export function resolveRootWithin(
  workspaceRoot: string,
  spec: string | undefined,
  key: 'materialsRoot' | 'outputRoot',
): string {
  const root = resolve(workspaceRoot)
  const abs = resolve(root, spec ?? (key === 'materialsRoot' ? DEFAULT_MATERIALS_ROOT : DEFAULT_OUTPUT_ROOT))
  const rel = relative(root, abs)
  if (rel === '..' || rel.startsWith('../')) {
    throw new Error(`config ${key} escapes the workspace root: ${spec} (root: ${root})`)
  }
  return abs
}
