/**
 * LocalizedText, mirroring the host convention (dsh locale service and
 * package manifests): a plain string renders verbatim on every surface, or
 * a map keyed by lowercase locale ids that MUST carry an `en` entry as the
 * fallback. Resolution prefers the requested locale, then `en` — the same
 * semantics as the host's `ctx.locale.resolveText`, which the browser half
 * uses when the host provides it; this module is the server-side resolver
 * (model face projects `en`) and the client's fallback resolver.
 *
 * Author content lives bilingual at its single home (pack manifests,
 * Config schema meta); no surface hardcodes copy about a pack or a Config
 * key (one home per fact).
 */

export type LocalizedText = string | { readonly en: string; readonly [locale: string]: string }

const LOCALE_KEY = /^[a-z]{2,3}(-[a-z]{2,4})?$/

/** Load-strength validation for a description field (misconfiguration fails loud). */
export function assertLocalizedText(value: unknown, where: string): asserts value is LocalizedText {
  if (typeof value === 'string') {
    if (value.length === 0) throw new Error(`${where} must be a non-empty string`)
    return
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${where} must be a non-empty string or a locale map carrying an "en" entry (e.g. {"zh": "...", "en": "..."})`)
  }
  const entries = Object.entries(value)
  if (entries.length === 0) throw new Error(`${where} must carry at least one locale entry`)
  for (const [locale, text] of entries) {
    if (!LOCALE_KEY.test(locale)) throw new Error(`${where}: locale key "${locale}" must be a lowercase language id like "en", "zh", or "zh-cn"`)
    if (typeof text !== 'string' || text.length === 0) throw new Error(`${where}.${locale} must be a non-empty string`)
  }
  const en = (value as { en?: unknown }).en
  if (typeof en !== 'string' || en.length === 0) throw new Error(`${where}: the locale map requires a non-empty "en" entry (the fallback)`)
}

/** Runtime tolerance for third-party text: valid LocalizedText or undefined. */
export function asLocalizedText(value: unknown): LocalizedText | undefined {
  try {
    assertLocalizedText(value, 'text')
    return value as LocalizedText
  } catch {
    return undefined
  }
}

/** Resolve for a surface: the requested locale first, `en` as the fallback. */
export function resolveLocalized(text: LocalizedText | undefined, locale: string): string {
  if (text === undefined) return ''
  if (typeof text === 'string') return text
  if (locale !== 'en' && typeof text[locale] === 'string') return text[locale]!
  return text.en
}
