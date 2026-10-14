import type { Pack } from '../src/pack.ts'
import { defineDocGenerateTool } from '../src/tools.ts'

/**
 * Shared test support for the cosmic chain specs. Since cosmic-plan consumes
 * cosmic-context (docs/designs/cosmic-context.md), every plan generation in
 * the engine specs needs a green workspace-level context artifact first —
 * {@link seedContext} produces it from the pack's golden sample.
 */

export const signal = new AbortController().signal

export interface DepsLike {
  readonly packs: ReadonlyMap<string, Pack>
  readonly ctx: { llm: unknown }
}

/** Scripted LLM port that replies with the given texts in order (stays on the last one). */
export function scriptedLlm(replies: string[]) {
  let n = 0
  return {
    stream: async function* () {
      const reply = replies[Math.min(n, replies.length - 1)]
      n++
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: reply }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
      yield { type: 'finish', reason: 'stop' }
    },
  }
}

/**
 * Generate the workspace-level context artifact (`context/context.json`) via
 * doc_generate with the cosmic-context golden sample, so a chained plan
 * generation can consume it as upstream. Restores the previous LLM port
 * afterwards, so the caller's scripted replies for the plan step stay intact.
 */
export async function seedContext(deps: DepsLike): Promise<string> {
  const contextPack = deps.packs.get('cosmic-context')
  if (contextPack === undefined) throw new Error('cosmic-context pack not loaded')
  const previous = deps.ctx.llm
  deps.ctx.llm = scriptedLlm([JSON.stringify(contextPack.goldenSample)])
  try {
    await defineDocGenerateTool(deps as never).execute(
      { pack: 'cosmic-context', materials: ['#!inline\n项目背景素材'], language: 'zh-CN', artifactName: 'context' } as never,
      { signal } as never,
    )
  } finally {
    deps.ctx.llm = previous
  }
  return 'context/context.json'
}
