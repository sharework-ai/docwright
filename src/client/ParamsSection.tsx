/**
 * The Docwright params section: three views over one catalog fetch —
 * shared-param groups (the aggregation with effective-source resolution),
 * per-pack flat view, and the plugin Config form. Controls map from the
 * ParamSpec type (number → numeric input, enum → select, boolean → switch,
 * object → JSON-per-value with endpoints read-only); every row carries a
 * hover tooltip with the author's description. Writes go through the
 * plugin's own routes (src/http.ts), never the conversation.
 */
import { createElement as h, useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Input, Pill, SegmentedTabs, Switch, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { fetchParams, saveConfigPatch, savePackParam } from './api.ts'
import type { ParamsPayload, UiConfigEntry, UiPackEntry, UiParamDeclaration } from './api.ts'
import { en, translate, zh } from './locales.ts'
import type { Translate } from './locales.ts'

const NS = 'docwright-params'

import type { CSSProperties } from 'react'

const row: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0',
}
const rowHead: CSSProperties = {
  display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap', minWidth: 0,
}
const nameStyle: CSSProperties = {
  fontWeight: 600, fontFamily: 'var(--dsw-font-mono, monospace)',
}
const desc: CSSProperties = {
  color: 'var(--dsw-alias-text-secondary, inherit)', marginTop: '2px',
  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
}
const valueStyle: CSSProperties = {
  fontFamily: 'var(--dsw-font-mono, monospace)',
}
const muted: CSSProperties = {
  color: 'var(--dsw-alias-text-secondary, inherit)',
}
const group: CSSProperties = {
  border: '0.5px solid var(--dsw-alias-border-l4, var(--dsw-alias-settings-card-stroke, transparent))',
  borderRadius: 'var(--dsw-radius-xl, 20px)',
  background: 'var(--dsw-alias-bg-layer-2, var(--dsw-alias-settings-card-fill, transparent))',
  padding: '12px 16px', marginBottom: '12px',
}
const card: CSSProperties = { ...group }
const hint: CSSProperties = {
  cursor: 'help', color: 'var(--dsw-alias-text-secondary, inherit)', border: '1px solid currentColor',
  borderRadius: '50%', width: '15px', height: '15px', fontSize: '10px', lineHeight: '13px',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  userSelect: 'none',
}
const inputStyle: CSSProperties = {
  width: '160px',
}
const actions: CSSProperties = {
  display: 'flex', gap: '8px', alignItems: 'center', marginTop: '8px',
}

/** The "?" affordance with the author's description on hover. */
function DescriptionHint(props: { text: string }) {
  return h(Tooltip, {
    label: props.text, side: 'bottom', maxWidth: 360,
    children: h('span', { className: `${NS}-hint`, style: hint, 'aria-label': props.text }, '?'),
  })
}

/** Fill a {key}-templated locale string. */
function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`))
}

/**
 * Human projection of a declared default: value-band objects read as
 * "target 60 (band 30-90)" instead of raw JSON; anything else that is not a
 * plain scalar falls back to JSON.
 */
function displayDefault(d: UiParamDeclaration, t: Translate): string {
  if (typeof d.default !== 'object' || d.default === null) return String(d.default)
  const o = d.default as Record<string, unknown>
  if (typeof o.value === 'number' && typeof o.min === 'number' && typeof o.max === 'number') {
    return fill(t('bandValue'), { value: o.value, min: o.min, max: o.max })
  }
  if (typeof o.value === 'number' && typeof o.downFactor === 'number' && typeof o.upFactor === 'number') {
    return fill(t('factorValue'), { value: o.value, down: o.downFactor, up: o.upFactor })
  }
  return JSON.stringify(d.default)
}

/** Value-semantics flags, rendered as quiet pills. The confirm gate flag is
 * deliberately absent: it says nothing about maintaining the default (and is
 * not editable here), so it only confused readers. */
function FlagPills(props: { d: UiParamDeclaration; t: Translate }) {
  const { d, t } = props
  const flags: string[] = []
  if (d.extractable) flags.push(t('extractable'))
  if (d.overridable) flags.push(t('overridable'))
  return flags.length === 0 ? null : h('div', { style: { display: 'flex', gap: '4px', flexWrap: 'wrap' } satisfies CSSProperties },
    flags.map(f => h(Pill, { key: f }, f)))
}

/** Constraint summary under the value: range, choices, and the Mind-the-gap note for object bands. */
function ConstraintLine(props: { d: UiParamDeclaration; t: Translate }) {
  const { d, t } = props
  const bits: string[] = []
  if (d.enumValues !== undefined) bits.push(`${t('choices')}: ${d.enumValues.join(' / ')}`)
  if (d.min !== undefined) bits.push(`${t('min')} ${d.min}`)
  if (d.max !== undefined) bits.push(`${t('max')} ${d.max}`)
  if (d.type === 'object') bits.push(t('objectBandNote'))
  return bits.length === 0 ? null : h('div', { style: muted }, bits.join(' · '))
}

/** Validate one proposed default against the declaration (client-side mirror of the server gate). */
function validateDraft(d: UiParamDeclaration, text: string): string | undefined {
  if (d.type === 'object') {
    try {
      const parsed: unknown = JSON.parse(text)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return 'invalidJson'
      return undefined
    } catch {
      return 'invalidJson'
    }
  }
  if (d.enumValues !== undefined) return undefined
  if (d.type === 'number') {
    const n = Number(text)
    if (text.trim() === '' || !Number.isFinite(n)) return 'invalidNumber'
    if ((d.min !== undefined && n < d.min) || (d.max !== undefined && n > d.max)) return 'outOfRange'
    return undefined
  }
  return undefined
}

/**
 * One declaration's value line, editability decided by ROLE (not by view):
 * a source declaration is editable whereever it is shown (the parameter
 * view's governing row and the owning pack's row in the Packs view write
 * the same manifest field); a shadowed declaration renders its value
 * struck-through and muted — it NEVER takes effect on the chain (the
 * receipt base outranks it) — with an explicit note naming the manager.
 */
function ValueRow(props: { d: UiParamDeclaration; t: Translate; onSaved?: (() => void) | undefined }) {
  const { d, t } = props
  if (d.role === 'shadowed') {
    return h('div', { style: rowHead },
      h('span', { style: { ...valueStyle, color: 'var(--dsw-alias-text-secondary, inherit)', textDecoration: 'line-through' } satisfies CSSProperties }, displayDefault(d, t)),
      h(Pill, {}, fill(t('shadowedByNote'), { pack: d.shadowedBy ?? '' })))
  }
  return h(EditSeat, { d, t, onSaved: props.onSaved })
}

/** The staged-edit control for a source declaration. */
function EditSeat(props: { d: UiParamDeclaration; t: Translate; onSaved?: (() => void) | undefined }) {
  const { d, t } = props
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const start = () => {
    setDraft(d.type === 'object' ? JSON.stringify(d.default, null, 2) : String(d.default))
    setError(undefined)
    setEditing(true)
  }
  const save = async () => {
    const problem = validateDraft(d, draft)
    if (problem !== undefined) {
      setError(problem === 'outOfRange' ? fill(t('rangeTemplate'), { min: String(d.min ?? ''), max: String(d.max ?? '') }) : t(problem))
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      const value = d.type === 'object' ? JSON.parse(draft) : d.type === 'number' ? Number(draft) : draft
      await savePackParam(d.pack, d.name, value)
      setEditing(false)
      props.onSaved?.()
    } catch (saveError) {
      setError((saveError as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const valueLine = h('div', { style: rowHead },
    h('span', { style: valueStyle }, displayDefault(d, t)),
    editing ? null : h(Button, { size: 'sm', variant: 'ghost', onClick: start }, t('edit')))
  if (!editing) return valueLine
  return h('div', null,
    d.enumValues !== undefined
      ? h('select', { value: String(d.default), onChange: (e: { target: { value: string } }) => setDraft(e.target.value), style: inputStyle },
          d.enumValues.map(v => h('option', { key: String(v), value: String(v) }, String(v))))
      : d.type === 'object'
        ? h('textarea', { value: draft, onChange: (e: { target: { value: string } }) => setDraft(e.target.value), rows: 4,
            style: { ...inputStyle, width: '100%', maxWidth: '480px', fontFamily: 'var(--dsw-font-mono, monospace)' } satisfies CSSProperties })
        : h(Input, { value: draft, type: d.type === 'number' ? 'number' : 'text', step: 'any',
            onChange: (e: { target: { value: string } }) => setDraft(e.target.value), style: inputStyle }),
    h('div', { style: actions },
      h(Button, { size: 'sm', disabled: busy, onClick: () => void save() }, busy ? t('saving') : t('save')),
      h(Button, { size: 'sm', variant: 'ghost', disabled: busy, onClick: () => setEditing(false) }, t('cancel')),
      error !== undefined ? h('span', { style: { color: 'var(--dsw-alias-text-critical, crimson)', } satisfies CSSProperties }, error) : null))
}

/**
 * One aggregated parameter group = ONE card: header carries the name and
 * every group-level invariant (flags, hover description, Mind-the-gap
 * note), one governing row carries the effective value and the edit seat,
 * and the shadowed declarations collapse into a single sentence — their
 * values never take effect (the receipt base outranks them), so rendering
 * them per-card repeated the same text N times and showed misleading
 * never-applied numbers.
 */
function ParamGroupCard(props: { name: string; declarations: readonly UiParamDeclaration[]; t: Translate; onSaved: () => void }) {
  const { name, declarations, t } = props
  const governing = declarations.find(d => d.role === 'source') ?? declarations[0]!
  const shadowed = declarations.filter(d => d !== governing)
  const governingPack = h(Pill, {}, governing.pack)
  return h('div', { style: group },
    h('div', { style: rowHead },
      h('span', { style: nameStyle }, name),
      h(FlagPills, { d: governing, t }),
      h(DescriptionHint, { text: governing.description })),
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' } satisfies CSSProperties },
      h('span', { style: muted }, `${t('sources')}:`),
      governingPack,
      h(ValueRow, { d: governing, t, onSaved: props.onSaved })),
    h('div', { style: { marginTop: '4px' } },
      h(ConstraintLine, { d: governing, t })),
    shadowed.length > 0
      ? h('div', { style: { ...muted, marginTop: '4px' } satisfies CSSProperties },
          fill(t('shadowedNote'), { packs: shadowed.map(d => d.pack).join(', ') }))
      : null)
}

/** Aggregated parameter view: one card per parameter name. */
function GroupsView(props: { payload: ParamsPayload; t: Translate; onSaved: () => void }) {
  const { payload, t } = props
  if (payload.groups.length === 0) return h('p', { style: muted }, t('empty'))
  return h('div', null, payload.groups.map(g => h(ParamGroupCard, { key: g.name, name: g.name, declarations: g.declarations, t, onSaved: props.onSaved })))
}

/** One declaration row inside a pack's card. Source rows carry the edit seat; shadowed rows strike their never-applied value through. */
function PackDeclRow(props: { d: UiParamDeclaration; t: Translate; onSaved: () => void }) {
  const { d, t } = props
  return h('div', { className: `${NS}-row`, style: row },
    h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 } satisfies CSSProperties },
      h('div', { style: rowHead },
        h('span', { style: nameStyle }, d.name),
        h(FlagPills, { d, t }),
        h(DescriptionHint, { text: d.description })),
      h(ValueRow, { d, t, onSaved: props.onSaved }),
      h('div', { style: { marginTop: '4px' } },
        h(ConstraintLine, { d, t }))))
}

/** Per-pack flat view (pack-author / troubleshooting perspective). */
function PacksView(props: { payload: ParamsPayload; t: Translate; onSaved: () => void }) {
  const { payload, t } = props
  return h('div', null,
    h('p', { style: muted }, t('packsEditNote')),
    payload.packs.map((p: UiPackEntry) => h('div', { key: p.name, style: card },
    h('div', { style: rowHead },
      h('span', { style: nameStyle }, p.name),
      h(Pill, {}, `v${p.version}`),
      h(Pill, {}, p.scope === 'workspace' ? t('scopeWorkspace') : t('scopeTopic')),
      p.paramDriftPolicy !== undefined ? h(Pill, {}, `${t('driftPolicy')}: ${p.paramDriftPolicy}`) : null),
    h('div', { style: desc }, p.description),
    p.consumes.length > 0 ? h('div', { style: muted }, `${t('consumed')}: ${p.consumes.join(', ')}`) : null,
    h('div', { style: { marginTop: '6px' } },
      p.params.length === 0
        ? h('p', { style: muted }, t('empty'))
        : p.params.map(d => h(PackDeclRow, { key: d.name, d, t, onSaved: props.onSaved }))))))
}

/** Config form: top-level keys as rows, oscillation.* folded under Advanced. */
function ConfigView(props: { payload: ParamsPayload; t: Translate; onSaved: () => void }) {
  const { payload, t } = props
  const entries = payload.config
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [switches, setSwitches] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [done, setDone] = useState(false)
  const toplevel = entries.filter(e => !e.key.includes('.') && e.type !== 'object')
  const advanced = entries.filter(e => e.key.startsWith('oscillation.') && e.type !== 'object')
  const draftOf = (e: UiConfigEntry): string => drafts[e.key] ?? (e.value === undefined ? '' : String(e.value))
  const dirty = entries.some(e => {
    if (e.type === 'boolean') return switches[e.key] !== undefined && switches[e.key] !== e.value
    if (e.type === 'object' || e.key.includes('.')) return false
    const draft = drafts[e.key]
    return draft !== undefined && draft !== (e.value === undefined ? '' : String(e.value))
  })
  const renderRow = (e: UiConfigEntry) => {
    const invalid = (() => {
      if (e.type === 'number' && drafts[e.key] !== undefined) {
        const n = Number(drafts[e.key])
        return drafts[e.key] !== '' && !Number.isFinite(n)
      }
      return false
    })()
    const control = e.type === 'boolean'
      ? h(Switch, {
          checked: switches[e.key] ?? e.value === true,
          onChange: (next: boolean) => setSwitches(prev => ({ ...prev, [e.key]: next })),
          label: e.key,
        })
      : e.choices !== undefined
        ? h('select', { value: draftOf(e) || String(e.value ?? ''), onChange: (ev: { target: { value: string } }) => setDrafts(prev => ({ ...prev, [e.key]: ev.target.value })), style: inputStyle },
            e.choices.map(c => h('option', { key: String(c), value: String(c) }, String(c))))
        : h(Input, { value: draftOf(e), type: e.type === 'number' ? 'number' : 'text', step: 'any', 'aria-invalid': invalid,
            onChange: (ev: { target: { value: string } }) => setDrafts(prev => ({ ...prev, [e.key]: ev.target.value })), style: inputStyle })
    return h('div', { key: e.key, className: `${NS}-row`, style: row },
      h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 } satisfies CSSProperties },
        h('div', { style: rowHead },
          h('span', { style: nameStyle }, e.key),
          e.description !== undefined ? h(DescriptionHint, { text: e.description }) : null,
          h(Pill, {}, e.origin === 'configured' ? t('configured') : e.value === undefined ? t('unset') : t('inherited'))),
        control,
        e.origin === 'default' && e.default !== undefined && String(e.default) !== String(e.value ?? '')
          ? h('div', { style: muted }, `${t('inherited')}: ${String(e.default)}`)
          : null,
        ))
  }
  const saveAll = async () => {
    const patch: Record<string, unknown> = {}
    for (const e of entries) {
      if (e.type === 'object' || e.key.includes('.')) continue
      if (e.type === 'boolean') {
        const next = switches[e.key]
        if (next !== undefined && next !== e.value) patch[e.key] = next
        continue
      }
      const draft = drafts[e.key]
      if (draft === undefined || draft === (e.value === undefined ? '' : String(e.value))) continue
      patch[e.key] = e.type === 'number' ? Number(draft) : draft === '' ? undefined : draft
    }
    if (Object.keys(patch).length === 0) return
    setBusy(true)
    setError(undefined)
    try {
      await saveConfigPatch(patch)
      setDone(true)
      setDrafts({})
      setSwitches({})
      props.onSaved()
    } catch (saveError) {
      setError((saveError as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const [showAdvanced, setShowAdvanced] = useState(false)
  return h('div', null,
    h('p', { style: muted }, t('configHint')),
    toplevel.map(e => renderRow(e)),
    advanced.length > 0
      ? h('div', { style: { marginTop: '8px' } },
          h(Button, { size: 'sm', variant: 'ghost', onClick: () => setShowAdvanced(v => !v) }, `${showAdvanced ? '▾' : '▸'} ${t('advanced')}`),
          showAdvanced ? advanced.map(e => renderRow(e)) : null)
      : null,
    h('div', { style: actions },
      h(Button, { size: 'sm', disabled: !dirty || busy, onClick: () => void saveAll() }, busy ? t('saving') : t('saveConfig')),
      done && !dirty ? h('span', { style: muted }, t('saved')) : null,
      error !== undefined ? h('span', { style: { color: 'var(--dsw-alias-text-critical, crimson)', } satisfies CSSProperties }, error) : null))
}

/** The section: one fetch, three views. */
export function ParamsSection(props: { lang: string }) {
  const t = useMemo<Translate>(() => translate(props.lang === 'zh' ? zh : en), [props.lang])
  const [payload, setPayload] = useState<ParamsPayload | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [view, setView] = useState<'groups' | 'packs' | 'config'>('groups')
  const refresh = useCallback(() => {
    fetchParams().then(p => {
      setPayload(p)
      setError(undefined)
    }).catch((e: Error) => setError(e.message))
  }, [])
  useEffect(() => { refresh() }, [refresh])
  if (error !== undefined) {
    return h('div', null,
      h('p', { style: { color: 'var(--dsw-alias-text-critical, crimson)' } }, t('loadFailed')),
      h('p', { style: muted }, error),
      h(Button, { size: 'sm', onClick: refresh }, t('retry')))
  }
  if (payload === undefined) return h('p', { style: muted }, t('loading'))
  const tabs = [
    { value: 'groups', label: t('viewGroups'), id: `${NS}-groups`, panelId: `${NS}-groups-panel` },
    { value: 'packs', label: t('viewPacks'), id: `${NS}-packs`, panelId: `${NS}-packs-panel` },
    { value: 'config', label: t('viewConfig'), id: `${NS}-config`, panelId: `${NS}-config-panel` },
  ] as const
  return h('div', { className: `${NS}-section` },
    h('h3', { style: { margin: '0 0 4px' } }, t('title')),
    h('p', { style: muted }, t('intro')),
    h('div', { style: { margin: '8px 0 12px' } },
      h(SegmentedTabs, { items: [...tabs], value: view, onChange: v => setView(v as 'groups' | 'packs' | 'config'), label: t('title') })),
    view === 'groups' ? h(GroupsView, { payload, t, onSaved: refresh }) : null,
    view === 'packs' ? h(PacksView, { payload, t, onSaved: refresh }) : null,
    view === 'config' ? h(ConfigView, { payload, t, onSaved: refresh }) : null)
}
