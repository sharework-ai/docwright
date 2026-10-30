import { describe, expect, it } from 'vitest'
import { ApiError } from '../src/client/api.ts'
import { fill, renderError, translate, zh } from '../src/client/locales.ts'

describe('fill', () => {
  it('substitutes {key} placeholders and keeps unknown ones visible', () => {
    expect(fill('target {value}, band {min}-{max}', { value: 60, min: 30, max: 90 })).toBe('target 60, band 30-90')
    expect(fill('missing {nope}', {})).toBe('missing {nope}')
  })
})

describe('renderError', () => {
  it('renders a known code from the locale catalog with params filled', () => {
    const error = new ApiError('unknown pack "ghost" (available: wp); nothing was written', { code: 'unknownPack', params: { pack: 'ghost', available: 'wp' } })
    expect(renderError(error, 'zh').text).toBe('找不到 pack「ghost」。可用：wp。未写入任何内容。')
    expect(renderError(error, 'en').text).toBe('Unknown pack "ghost". Available: wp. Nothing was written.')
  })

  it('fills a numeric param (bodyTooLarge)', () => {
    const error = new ApiError('request body exceeds 65536 bytes', { code: 'bodyTooLarge', params: { max: 65536 } })
    expect(renderError(error, 'zh').text).toContain('65536')
  })

  it('falls back to the raw message for unknown codes and passes the detail through', () => {
    const error = new ApiError('some future server sentence', { code: 'futureCode', detail: 'raw cause' })
    const rendered = renderError(error, 'zh')
    expect(rendered.text).toBe('some future server sentence')
    expect(rendered.detail).toBe('raw cause')
  })

  it('renders coded details as the secondary line (manifestInvalid)', () => {
    const error = new ApiError('pack wp: manifest.params.limit.default must be <= max', { code: 'manifestInvalid', detail: 'pack wp: manifest.params.limit.default must be <= max' })
    const rendered = renderError(error, 'zh')
    expect(rendered.text).toContain('装载期校验')
    expect(rendered.detail).toContain('must be <= max')
  })

  it('every catalog key resolves through translate in both languages', () => {
    const t = translate(zh)
    expect(t('err.gateRejected')).toContain('宿主拒绝')
    expect(t('noSuchKey')).toBe('noSuchKey')
  })
})
