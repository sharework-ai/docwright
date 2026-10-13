import { readFile, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
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
    let real: string
    try {
      real = await realpath(abs)
    } catch (error) {
      throw new Error(`material not readable: ${ref} (resolved: ${abs}; materials root: ${materialBase}; cause: ${(error as Error).message})`)
    }
    const realRel = relative(root, real)
    if (realRel === '..' || realRel.startsWith('../') || isAbsolute(realRel)) {
      throw new Error(`material path escapes the workspace root via symlink: ${ref} (root: ${root})`)
    }
    out.push(await readFile(real, 'utf8'))
  }
  return out
}
