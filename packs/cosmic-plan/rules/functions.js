// Cross-field rules for the cosmic-plan pack, migrated from
// cosmic-claude cosmic_core/auditors/plan_auditor.py (E204 funcId unique,
// E205 path unique, E200 family) plus the shared-budget band rules
// plan/cfp-per-func-band and plan/cfp-total-band
// (docs/designs/params-and-chain-contract.md).
// Contract: export `rules`; each check(artifact) returns RuleIssue[]
// ({ jsonPath, message, snapshot? }); an empty array means pass.

function getFunctions(artifact) {
  const doc = typeof artifact === 'object' && artifact !== null ? artifact : {}
  return Array.isArray(doc.functions) ? doc.functions : []
}

function str(value) {
  return typeof value === 'string' ? value : ''
}

export const rules = [
  {
    id: 'plan/func-id-unique',
    severity: 'error',
    suggestion: '重新编号使 funcId 唯一',
    check: (artifact) => {
      const functions = getFunctions(artifact)
      const seen = new Map()
      const issues = []
      functions.forEach((fn, index) => {
        const funcId = str(fn?.funcId)
        if (funcId === '') return
        if (seen.has(funcId)) {
          issues.push({
            jsonPath: `$.functions[${index}].funcId`,
            message: `功能ID重复：${funcId} 在功能 ${seen.get(funcId) + 1} 和 ${index + 1} 中都存在`,
            snapshot: funcId,
          })
        } else {
          seen.set(funcId, index)
        }
      })
      return issues
    },
  },
  {
    id: 'plan/l1-path-unique',
    severity: 'error',
    suggestion: '调整功能层级名称，使 l1Name/l2Name/l3Name 组合路径互不相同',
    check: (artifact) => {
      const functions = getFunctions(artifact)
      const seen = new Map()
      const issues = []
      functions.forEach((fn, index) => {
        const l1Name = str(fn?.l1Name)
        const l2Name = str(fn?.l2Name)
        const l3Name = str(fn?.l3Name)
        const hasL3 = l3Name !== ''
        const key = hasL3 ? `${l1Name}|${l2Name}|${l3Name}` : `${l1Name}|${l2Name}`
        const display = hasL3 ? `${l1Name} > ${l2Name} > ${l3Name}` : `${l1Name} > ${l2Name}`
        if (key === '|') return
        if (seen.has(key)) {
          issues.push({
            jsonPath: `$.functions[${index}].l1Name`,
            message: `功能路径重复：${display} 在功能 ${seen.get(key) + 1} 和 ${index + 1} 中都存在`,
            snapshot: display,
          })
        } else {
          seen.set(key, index)
        }
      })
      return issues
    },
  },
  {
    // Band rule driven by the shared param cfpPerFunc {value, min, max}
    // (docs/designs/params-and-chain-contract.md): user budgets are first-
    // class validation, not prompt prose. Skips when params are absent
    // (programmatic misuse); required chain-head params guarantee presence.
    id: 'plan/cfp-per-func-band',
    severity: 'error',
    suggestion: '调整该功能的 estimatedCfps 到生效参数 cfpPerFunc 的 [min, max] 区间内；如需调整预算请向用户确认后修改 params',
    check(artifact, context) {
      const budget = context?.params?.cfpPerFunc
      if (typeof budget !== 'object' || budget === null || typeof budget.min !== 'number' || typeof budget.max !== 'number') return []
      const issues = []
      getFunctions(artifact).forEach((fn, index) => {
        const cfps = fn?.estimatedCfps
        if (typeof cfps === 'number' && Number.isFinite(cfps) && (cfps < budget.min || cfps > budget.max)) {
          issues.push({
            jsonPath: `$.functions[${index}].estimatedCfps`,
            message: `单功能CFP超出预算区间：${cfps}，允许 [${budget.min}, ${budget.max}]（cfpPerFunc）`,
            snapshot: String(cfps),
          })
        }
      })
      return issues
    },
  },
  {
    // Band rule driven by the shared param cfpTotal {value, downFactor,
    // upFactor}: the total must stay inside [value*downFactor, value*upFactor].
    id: 'plan/cfp-total-band',
    severity: 'error',
    suggestion: '调整各功能的 estimatedCfps，使 totalCfps 落在生效参数 cfpTotal 的 [value×downFactor, value×upFactor] 区间内；如需调整预算请向用户确认后修改 params',
    check(artifact, context) {
      const budget = context?.params?.cfpTotal
      if (typeof budget !== 'object' || budget === null || typeof budget.value !== 'number' || typeof budget.downFactor !== 'number' || typeof budget.upFactor !== 'number') return []
      const total = getFunctions(artifact).reduce((sum, fn) => {
        const cfps = fn?.estimatedCfps
        return typeof cfps === 'number' && Number.isFinite(cfps) ? sum + cfps : sum
      }, 0)
      const floor = budget.value * budget.downFactor
      const ceil = budget.value * budget.upFactor
      if (total < floor || total > ceil) {
        return [{
          jsonPath: '$.functions',
          message: `CFP总数超出预算区间：实际 ${total}，允许 [${floor}, ${ceil}]（cfpTotal.value=${budget.value}）`,
          snapshot: String(total),
        }]
      }
      return []
    },
  },
  {
    // Thresholds migrated from plan_auditor.py: per-function recommended
    // 20-50 (W101), schema hard bounds 10-100; without desiredCfps the
    // total band is [20, 1000]. Also verifies totalCfps === sum.
    id: 'plan/total-cfps-range',
    severity: 'error',
    suggestion: '调整各功能的 estimatedCfps（单项建议 20-50、硬边界 10-100），使总和落在 20-1000 区间，并保证 totalCfps 等于各项之和',
    check: (artifact) => {
      const doc = typeof artifact === 'object' && artifact !== null ? artifact : {}
      const functions = getFunctions(artifact)
      const issues = []
      let total = 0
      for (const fn of functions) {
        const cfps = fn?.estimatedCfps
        if (typeof cfps === 'number' && Number.isFinite(cfps)) total += cfps
      }
      if (total < 20 || total > 1000) {
        issues.push({
          jsonPath: '$.functions',
          message: `CFP总数超出合理范围：实际总和 ${total}，允许区间 [20, 1000]`,
          snapshot: String(total),
        })
      }
      if (typeof doc.totalCfps === 'number' && doc.totalCfps !== total) {
        issues.push({
          jsonPath: '$.totalCfps',
          message: `totalCfps 与 estimatedCfps 之和不一致：${doc.totalCfps} != ${total}`,
          snapshot: String(doc.totalCfps),
        })
      }
      return issues
    },
  },
]
