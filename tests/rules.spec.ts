import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadPacks } from '../src/pack-loader.ts'
import { DocService } from '../src/doc-service.ts'
import type { Pack } from '../src/pack.ts'
import { fileURLToPath } from 'node:url'

const packsRoot = fileURLToPath(new URL('../packs', import.meta.url))

async function cosmic(): Promise<Pack> {
  const packs = await loadPacks(packsRoot, {})
  const pack = packs.get('cosmic-plan')
  if (pack === undefined) throw new Error('pack missing')
  return pack
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * Mutation tests — the proof that guardrails are enforced, not decorative
 * (prototype-system lesson). Every rule family must catch its corruption.
 */
describe('mutation tests (guardrail-is-real)', () => {
  it.each(['zh-CN', 'en-US'])('catches a schema violation (missing required field)', async (lang) => {
    const pack = await cosmic()
    const service = new DocService(pack, lang)
    const broken = clone(pack.goldenSample) as Record<string, unknown>
    delete broken.functions
    const issues = service.validate(broken)
    expect(issues.some(i => i.ruleId.startsWith('schema/'))).toBe(true)
  })

  it('catches a short funcDesc (minLength family)', async () => {
    const pack = await cosmic()
    const service = new DocService(pack, 'zh-CN')
    const broken = clone(pack.goldenSample) as { functions: Array<Record<string, unknown>> }
    broken.functions[0]!.funcDesc = '太短'
    const issues = service.validate(broken)
    expect(issues.some(i => i.ruleId.includes('min-length') && i.severity === 'error')).toBe(true)
  })

  it('catches a forbidden keyword in a name (forbiddenKeywords family)', async () => {
    const pack = await cosmic()
    const service = new DocService(pack, 'zh-CN')
    const broken = clone(pack.goldenSample) as { functions: Array<Record<string, unknown>> }
    broken.functions[0]!.l1Name = '用户管理'
    const issues = service.validate(broken)
    expect(issues.some(i => i.ruleId.includes('forbidden') || i.ruleId.includes('keyword'))).toBe(true)
  })

  it('catches duplicate funcIds (function-rule uniqueness)', async () => {
    const pack = await cosmic()
    const service = new DocService(pack, 'zh-CN')
    const broken = clone(pack.goldenSample) as { functions: Array<Record<string, unknown>> }
    broken.functions[1]!.funcId = broken.functions[0]!.funcId
    const issues = service.validate(broken)
    expect(issues.some(i => i.ruleId.includes('func-id-unique'))).toBe(true)
  })

  it('catches a total CFP out of range (function-rule range family)', async () => {
    const pack = await cosmic()
    const service = new DocService(pack, 'zh-CN')
    const broken = clone(pack.goldenSample) as { functions: Array<Record<string, unknown>>, totalCfps?: number }
    for (const f of broken.functions) f.estimatedCfps = 1
    broken.totalCfps = broken.functions.length
    const issues = service.validate(broken)
    expect(issues.some(i => i.ruleId.includes('total-cfps'))).toBe(true)
  })

  it('catches a funcId that violates the topicNo numbering', async () => {
    const pack = await cosmic()
    const service = new DocService(pack, 'zh-CN')
    const broken = clone(pack.goldenSample) as { functions: Array<Record<string, unknown>> }
    broken.functions[0]!.funcId = 'KERQ-352-99'
    const issues = service.validate(broken, { topicNo: 'KERQ-352' })
    expect(issues.some(i => i.ruleId.includes('func-id-numbering'))).toBe(true)
  })

  it('every ERROR issue carries a suggestion (DX contract)', async () => {
    const pack = await cosmic()
    const service = new DocService(pack, 'zh-CN')
    const broken = clone(pack.goldenSample) as { functions: Array<Record<string, unknown>> }
    broken.functions[0]!.funcDesc = '短'
    broken.functions[1]!.funcId = broken.functions[0]!.funcId
    const issues = service.validate(broken).filter(i => i.severity === 'error')
    expect(issues.length).toBeGreaterThan(0)
    for (const issue of issues) {
      expect(issue.suggestion, `${issue.ruleId} missing suggestion`).toBeTruthy()
    }
  })
})
