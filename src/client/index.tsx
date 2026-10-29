/**
 * docwright params UI client half: registers the params maintenance views on
 * the two seats the 0.1.7+ slot contract offers third-party bundles —
 * `settings.plugins.tab` (a tab beside 通用/模型/内置插件 in the Settings
 * dialog) and `plugins.bundle.config` (the configuration card on the
 * bundle's own Plugins page). Both seats are reached through `slots.inject`,
 * which waits for the slot to exist: a host that never declares one never
 * runs its registration (dsh-market's detection pattern — no version
 * strings). The old `settings.section` seat is NOT registered: 0.2.1's
 * declaration table rejects it ("slot is not declared") and the section
 * never renders.
 *
 * Built by tsdown into the __ModuleLoader__ factory bundle at client/client.js;
 * externals resolve through the loader's module table. Containment follows
 * dsh-market's lesson: a throw inside the host's client bootstrap takes the
 * whole app down, so each mounting is wrapped and a failure costs this
 * section for the session, never the shell.
 */
import { createElement as h } from 'react'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import { ParamsSection } from './ParamsSection.tsx'

const NS = 'docwright-params'

/** The bundle's package name — the key `plugins.bundle.config` is contracted to. */
const PACKAGE_NAME = '@sharework-ai/dsh-docwright'

/** Primitives this bundle requires that older hosts may lack. */
const REQUIRED_PRIMITIVES = ['Button', 'Input', 'Pill', 'SegmentedTabs', 'Switch', 'Tooltip'] as const

export function missingPrimitives(mod: Record<string, unknown>): string[] {
  return REQUIRED_PRIMITIVES.filter(name => mod[name] === undefined)
}

interface LocaleService {
  getSnapshot(): { active: string }
  subscribe(callback: () => void): () => void
}

interface SlotsService {
  inject(name: string, register: () => unknown): void
  register(options: Record<string, unknown>, component: (owner: { lang?: string; view?: string }) => unknown): unknown
}

interface ClientContext {
  effect(callback: () => unknown, label?: string): void
  locale: LocaleService
  slots: SlotsService
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
  const label = () => (lang === 'zh' ? 'Docwright 参数' : 'Docwright params')

  // Seat 1: the Settings dialog tab (declared by ui-settings-plugins on the
  // 0.1.7 line; "one page inside the Plugins settings section").
  ctx.slots.inject('settings.plugins.tab', () => {
    const off = ctx.slots.register({
      name: 'settings.plugins.tab',
      id: NS,
      order: 60,
      label,
      locale: NS,
      inject: () => ({ lang }),
    }, () => h(ParamsSection, { lang }))
    ctx.effect(() => () => {
      if (typeof off === 'function') (off as () => void)()
    }, 'docwright: settings tab')
  })

  // Seat 2: the configuration card on the bundle's own Plugins page
  // (declared by ui-plugin-manager; "a bundle's configuration belongs in
  // plugins.bundle.config, keyed by the bundle's package name"). `view:
  // 'summary'` is the list row's one-liner slot — the pack description
  // already carries that, so the card renders on the page only.
  ctx.slots.inject('plugins.bundle.config', () => {
    const off = ctx.slots.register({
      name: 'plugins.bundle.config',
      key: PACKAGE_NAME,
      locale: NS,
      inject: () => ({ lang }),
    }, (owner: { view?: string } = {}) => (owner.view === 'summary' ? null : h(ParamsSection, { lang })))
    ctx.effect(() => () => {
      if (typeof off === 'function') (off as () => void)()
    }, 'docwright: bundle config card')
  })
}
