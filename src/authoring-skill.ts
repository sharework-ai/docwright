import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Pack-authoring skill (docs/designs/pack-authoring.md): the plugin's model
 * face teaches both USING packs (doc_packs -> doc_generate) and AUTHORING
 * them. The playbook body ships as a bundled guide file (guides/, a sibling
 * of packs/), read once at apply time — a missing guide fails loud because a
 * broken package must never silently lose the authoring capability. The
 * guide is self-contained: repo-side docs (AGENTS.md, docs/designs/*) are
 * NOT shipped with the installed plugin and must never be referenced from
 * the model-facing body.
 */

export const AUTHORING_SKILL_NAME = 'docwright-pack-authoring'

/** Structural subset of the dsh skills registry docwright needs (dsh-skill `ctx.skills`). */
export interface SkillRegistrarLike {
  register(skill: {
    name: string
    description: string
    whenToUse: string
    content: string
    resourceBase: { kind: 'directory'; path: string }
  }): unknown
}

/** Host context carrying an optional skills service; injected only when present. */
export interface SkillsHostContext {
  readonly skills?: SkillRegistrarLike
}

/** Skill catalog metadata (stable invitation text; the body is the guide file). */
export const AUTHORING_SKILL_DESCRIPTION =
  'Author a new docwright document pack when no installed pack covers the document type the user needs: '
  + 'a nine-stage playbook (domain analysis, artifact planning, schema, rules, params, chain design) '
  + 'through a green, verified pack.'
export const AUTHORING_SKILL_WHEN_TO_USE =
  'Use when the user asks for a document type no installed pack generates, or asks to create/extend a docwright pack or scenario.'

/** Read the bundled guide; fail loud with a fix hint when absent. */
export async function readAuthoringGuide(guidesRoot: string): Promise<string> {
  const path = join(guidesRoot, 'pack-authoring.md')
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    throw new Error(`docwright: the pack-authoring guide is missing at ${path} (${(error as Error).message}); fix: reinstall the package so guides/ ships next to packs/`)
  }
}

/**
 * Register the authoring skill on the host's skills registry. Caller wraps
 * this in `ctx.inject(['skills'], ...)` (optional injection, webServer
 * precedent): hosts without the skills service stay dormant. Called from the
 * inject callback with the resolved subcontext.
 */
export function registerAuthoringSkill(skillsCtx: SkillsHostContext, guidesRoot: string, guide: string): void {
  const skills = skillsCtx.skills
  if (skills === undefined || typeof skills.register !== 'function') {
    throw new Error('docwright: the skills service resolved but ctx.skills.register is unavailable; fix: this dsh build does not match the expected dsh-skill surface')
  }
  skills.register({
    name: AUTHORING_SKILL_NAME,
    description: AUTHORING_SKILL_DESCRIPTION,
    whenToUse: AUTHORING_SKILL_WHEN_TO_USE,
    content: guide,
    resourceBase: { kind: 'directory', path: guidesRoot },
  })
}
