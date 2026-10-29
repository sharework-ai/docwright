import type { Context } from '@deepseek-ai/cordis'
import { join } from 'node:path'
import { Config, type Config as DocwrightConfig } from './config.ts'
import { mountParamsRoutes, type ConnectionLike, type WebServerLike, type WriteChannels } from './http.ts'
import { loadPacks } from './pack-loader.ts'
import { buildParamsPayload } from './params-rpc.ts'
import { setPackParamDefault, updateConfigViaHost, type SettingsServiceLike } from './params-writes.ts'
import { defineDocChainStatusTool, defineDocExtractTool, defineDocGenerateTool, defineDocPacksTool, defineDocValidateTool } from './tools.ts'

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
export { resolveEffectiveParams, type ExtractionView } from './params.ts'
export { readExtractionFile, writeExtractionFile, verifyExtraction, type ExtractionFile, type ExtractionRecord } from './extract.ts'
export { buildParamsCatalog, buildConfigCatalog, paramRoles, type ParamsCatalog, type UiConfigEntry } from './params-rpc.ts'
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
  // Mutable copy: the params-UI write channel hot-swaps THIS instance in
  // place (clear + refill) so the tools and the RPC payload see a new pack
  // manifest default without a restart; Map satisfies every ReadonlyMap dep.
  const packs = new Map(await loadPacks(builtinRoot, { extra: config.packsDir === undefined || config.packsDir.length === 0 ? undefined : [config.packsDir] }))
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
  ctx.tools.register(defineDocExtractTool(deps))
  ctx.tools.register(defineDocValidateTool(deps))
  ctx.tools.register(defineDocChainStatusTool(deps))
  // Params maintenance UI (docs/designs/param-management-ui.md): mounts on
  // the host webServer when the host provides one. A headless/CLI host never
  // resolves the service, this inject stays dormant, and the tools are
  // unaffected. Payload and connection resolve lazily per request — the
  // connection service only exists after the host's async init.
  ctx.inject(['webServer'], (hostCtx: Context) => {
    const host = hostCtx as unknown as {
      effect(fn: () => () => void, name?: string): void
      webServer: WebServerLike
    }
    // Config writes proxy the HOST settings service (describe/update over the
    // plugin's profile entry — patch persistence, revision conflicts, and
    // hot reload stay the host's). The service is resolved lazily per call
    // for the same async-init reason as the connection gate; a host without
    // it surfaces a clear error from the write route instead.
    const settingsOf = (): SettingsServiceLike => {
      const service = (ctx as unknown as { get(name: string): unknown }).get('settings') as SettingsServiceLike | undefined
      if (service === undefined || typeof service.describe !== 'function' || typeof service.update !== 'function') {
        throw new Error('the host settings service is not available (cause: this dsh does not expose settings forms; fix: configure docwright via cordis.yml)')
      }
      return service
    }
    const writes: WriteChannels = {
      updateConfig: patch => updateConfigViaHost(settingsOf(), patch),
      setPackParamDefault: (pack, param, value) => setPackParamDefault({
        packs,
        builtinRoot,
        extraPacksDir: config.packsDir !== undefined && config.packsDir.length > 0 ? config.packsDir : undefined,
        loadPacks,
      }, pack, param, value),
    }
    host.effect(() => mountParamsRoutes(host.webServer, {
      payload: () => buildParamsPayload(packs, Config, config),
      connection: () => (ctx as unknown as { get(name: string): unknown }).get('connection') as ConnectionLike | undefined,
      writes,
    }), 'docwright: params routes')
  })
}
