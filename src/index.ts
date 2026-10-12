import type { Context } from '@deepseek-ai/cordis'
import { join } from 'node:path'
import { Config, type Config as DocwrightConfig } from './config.ts'
import { loadPacks } from './pack-loader.ts'
import { defineDocGenerateTool, defineDocPacksTool, defineDocValidateTool } from './tools.ts'

/**
 * docwright — closed-loop document generation for deepseek-harness.
 * JSON is the single source of truth; every document ships with a
 * replayable validation receipt. See docs/designs/docwright-mvp.md.
 * @module @sharework-ai/dsh-docwright
 */

export const name = 'docwright'
export const inject = ['tools', 'llm']
export { Config }
export type { DocwrightConfig }
export * from './pack.ts'
export { createScoring, defaultScore, type Scoring } from './convergence.ts'
export { resolveEffectiveParams } from './params.ts'
export { DocService, generateDocument } from './doc-service.ts'
export { runRepairLoop, type LoopExhaustReason } from './loop.ts'

export async function apply(ctx: Context, config: DocwrightConfig): Promise<void> {
  await registerTools(ctx, config, join(import.meta.dirname, '..', 'packs'))
}

/**
 * Pack loading is apply-time (decision #9): load failures — bad manifest,
 * broken ruleset, missing Config-default language — fail loud here.
 * Split from {@link apply} so the packs root is injectable for tests.
 */
export async function registerTools(ctx: Context, config: DocwrightConfig, builtinRoot: string): Promise<void> {
  const packs = await loadPacks(builtinRoot, { extra: config.packsDir === undefined || config.packsDir.length === 0 ? undefined : [config.packsDir] })
  if (packs.size === 0) {
    throw new Error(`docwright: no packs found under ${builtinRoot}`)
  }
  if (config.defaultLanguage !== undefined && config.defaultLanguage.length > 0) {
    const missing = [...packs.values()].filter(p => !p.manifest.languages.includes(config.defaultLanguage ?? ''))
    if (missing.length > 0) {
      throw new Error(`docwright: defaultLanguage "${config.defaultLanguage}" missing from packs: ${missing.map(p => p.manifest.name).join(', ')} (available per pack: ${[...packs.values()].map(p => `${p.manifest.name}=[${p.manifest.languages.join(',')}]`).join(' ')})`)
    }
  }
  const deps = { packs, config, ctx }
  ctx.tools.register(defineDocPacksTool(deps))
  ctx.tools.register(defineDocGenerateTool(deps))
  ctx.tools.register(defineDocValidateTool(deps))
}
