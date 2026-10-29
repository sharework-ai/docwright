/**
 * docwright params UI client half: registers a "Docwright params" settings
 * section rendering the maintenance views (shared-param groups with
 * effective-source resolution, per-pack flat view, plugin Config form).
 * Built by tsdown into the __ModuleLoader__ factory bundle at client/client.js;
 * externals resolve through the loader's module table.
 *
 * Containment follows dsh-market's lesson: a throw inside the host's client
 * bootstrap takes the whole app down, so mounting is wrapped and a failure
 * costs this section for the session, never the shell.
 */
import { createElement as h } from 'react'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import { ParamsSection } from './ParamsSection.tsx'

const NS = 'docwright-params'

/** Primitives this bundle requires that older hosts may lack. */
const REQUIRED_PRIMITIVES = ['Button', 'Input', 'Pill', 'SegmentedTabs', 'Switch', 'Tooltip'] as const

export function missingPrimitives(mod: Record<string, unknown>): string[] {
  return REQUIRED_PRIMITIVES.filter(name => mod[name] === undefined)
}

interface LocaleService {
  getSnapshot(): { active: string }
  subscribe(callback: () => void): () => void
}

interface ClientContext {
  effect(callback: () => unknown, label?: string): void
  locale: LocaleService
  slots: {
    inject(name: string, register: () => unknown): void
    register(options: Record<string, unknown>, component: (owner: { lang?: string }) => unknown): unknown
  }
}

export const name = 'docwright-params'
export const inject = ['slots', 'locale']

export function apply(ctx: ClientContext): void {
  const mod = primitives as unknown as Record<string, unknown>
  const gaps = missingPrimitives(mod)
  if (gaps.length > 0) {
    console.warn(`[docwright] host ui-primitives missing ${gaps.join(', ')} — params section disabled (newer dsh web required)`)
    return
  }
  try {
    mountSection(ctx)
  } catch (error) {
    console.error('[docwright] params section failed to mount; the rest of the app is unaffected.', error)
  }
}

function mountSection(ctx: ClientContext): void {
  let lang = ctx.locale.getSnapshot().active === 'zh' ? 'zh' : 'en'
  ctx.locale.subscribe(() => {
    lang = ctx.locale.getSnapshot().active === 'zh' ? 'zh' : 'en'
  })
  const off = ctx.slots.register({
    name: 'settings.section',
    id: NS,
    order: 45,
    label: () => lang === 'zh' ? 'Docwright 参数' : 'Docwright params',
    locale: NS,
    inject: () => ({ lang }),
  }, () => h(ParamsSection, { lang }))
  ctx.effect(() => () => {
    if (typeof off === 'function') (off as () => void)()
  }, 'docwright: params section')
}
