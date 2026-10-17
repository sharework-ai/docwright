import { readFile, readdir, realpath } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve } from 'node:path'
import { normalizeWindowsPath } from './paths.ts'

/**
 * Material references: paths relative to the materials root (default
 * `<workspace>/references/`), or inline text whose first line is the explicit
 * `#!inline` marker (no heuristics). Containment is enforced twice against
 * the WORKSPACE root: lexically first (so `../..` gets a clear traversal
 * error even for nonexistent paths), then on REAL paths (so a symlink inside
 * the workspace that points outside it is rejected too). Both keep secrets
 * out of prompts.
 */
/** Sorted file names under dir (capped); explains a missing dir instead of throwing. */
async function listFiles(dir: string): Promise<string> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    const names = entries.filter(e => e.isFile()).map(e => e.name).sort()
    return names.length === 0 ? '(no files)' : names.slice(0, 8).join(', ')
  } catch {
    return '(directory does not exist)'
  }
}

/** Loud failure with recovery hints: what exists where, and the no-prefix rule. */
async function notReadable(ref: string, abs: string, materialBase: string, root: string, cause: unknown): Promise<Error> {
  const parts = [
    `material not readable: ${ref}`,
    `resolved: ${abs}`,
    `materials root: ${materialBase}`,
    `available: ${await listFiles(materialBase)}`,
  ]
  const defaultRoot = resolve(root, 'references')
  if (resolve(materialBase) !== defaultRoot) parts.push(`workspace references/ has: ${await listFiles(defaultRoot)}`)
  parts.push(`hint: refs are relative to the materials root — do not repeat the root directory name inside the ref; cause: ${(cause as Error).message}`)
  return new Error(parts.join('; '))
}

export async function readMaterials(
  refs: readonly string[],
  workspaceRoot: string,
  materialsRoot: string,
): Promise<readonly string[]> {
  // An empty list is legal: chained packs may rely on the upstream artifact
  // alone for context. The tool layer enforces "some input exists".
  if (refs.length === 0) return []
  const root = await realpath(resolve(workspaceRoot))
  const materialBase = resolve(root, materialsRoot)
  const out: string[] = []
  for (const ref of refs) {
    if (typeof ref !== 'string') {
      throw new Error(`material reference must be a string, got ${JSON.stringify(ref)}`)
    }
    if (ref.startsWith('#!inline')) {
      out.push(ref.slice('#!inline'.length).replace(/^\n/, ''))
      continue
    }
    const abs = resolve(materialBase, normalizeWindowsPath(ref))
    const lexicalRel = relative(root, abs)
    if (lexicalRel === '..' || lexicalRel.startsWith('../') || isAbsolute(lexicalRel)) {
      throw new Error(`material path escapes the workspace root: ${ref} (root: ${root})`)
    }
    let real: string | undefined
    try {
      real = await realpath(abs)
    } catch (error) {
      // Models habitually prefix refs with the materials root's directory
      // name ("references/x.md" under a references/ root double-resolves to
      // references/references/x.md). When stripping that leading segment
      // lands on an existing in-root file, accept it; otherwise fail loud
      // with the available names so the retry can pick a real one.
      const prefix = `${basename(materialBase)}/`
      if (ref.startsWith(prefix)) {
        const strippedAbs = resolve(materialBase, ref.slice(prefix.length))
        const strippedRel = relative(root, strippedAbs)
        const contained = strippedRel !== '..' && !strippedRel.startsWith('../') && !isAbsolute(strippedRel)
        if (contained) {
          try {
            real = await realpath(strippedAbs)
          } catch { /* fall through to the loud error below */ }
        }
      }
      if (real === undefined) throw await notReadable(ref, abs, materialBase, root, error)
    }
    const realRel = relative(root, real)
    if (realRel === '..' || realRel.startsWith('../') || isAbsolute(realRel)) {
      throw new Error(`material path escapes the workspace root via symlink: ${ref} (root: ${root})`)
    }
    out.push(await readFile(real, 'utf8'))
  }
  return out
}
