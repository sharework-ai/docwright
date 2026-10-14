// Cross-field rules for the cosmic-plan pack, migrated from
// cosmic-claude cosmic_core/auditors/plan_auditor.py (E204 funcId unique,
// E205 path unique, E200 family) plus the shared-budget band rules
// plan/cfp-per-func-band and plan/cfp-total-band
// (docs/designs/params-and-chain-contract.md), the upstream-context
// reconciliation rule plan/context-alignment and the moduleLevels-driven
// plan/name-hierarchy (docs/designs/cosmic-context.md).
// Contract: export `rules`; each check(artifact) returns RuleIssue[]
// ({ jsonPath, message, snapshot? }); an empty array means pass.

function getFunctions(artifact) {
  const doc = typeof artifact === 'object' && artifact !== null ? artifact : {}
  return Array.isArray(doc.functions) ? doc.functions : []
}

function str(value) {
  return typeof value === 'string' ? value : ''
}

function isObject(value) {
  return value !== null && typeof value === 'object'
}

/** Message selector: en-US only when the artifact itself says so. */
function say(artifact, zh, en) {
  return isObject(artifact) && artifact.language === 'en-US' ? en : zh
}

/** All module codes of the upstream context tree (up to three levels). */
function contextModuleCodes(contextArtifact) {
  const codes = new Set()
  const walk = (nodes, level) => {
    if (!Array.isArray(nodes) || level > 3) return
    for (const node of nodes) {
      if (!isObject(node)) continue
      if (typeof node.code === 'string' && node.code !== '') codes.add(node.code)
      walk(node.children, level + 1)
    }
  }
  walk(contextArtifact?.modules, 1)
  return codes
}

/** funcId segments (hyphen-separated, non-empty). */
function funcIdSegments(funcId) {
  return str(funcId).split('-').filter(segment => segment.length > 0)
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
  }
,
  {
    // Module-change reconciliation against the upstream context
    // (docs/designs/cosmic-context.md): modified functions must reference a
    // module code that already exists in the context tree; added functions
    // must NOT collide with an existing code and must follow the ID
    // convention of their level. v1 reconciles the leaf code (the last
    // funcId segment) against the whole-tree code set; per-segment alignment
    // of the full code chain is a v2 item.
    id: 'plan/context-alignment',
    severity: 'error',
    suggestion: '以绿回执的 cosmic-context 产物为 upstream 重新生成：修改类功能的模块编号（funcId 末段）必须已存在于 context 模块树；新增类功能不得与已有编号冲突，且须符合对应层级的 moduleIdConventionForLevelN；doc_validate 复验需传入相同 upstream 路径。',
    check(artifact, context) {
      if (!isObject(artifact)) return []
      const upstream = Array.isArray(context?.upstream) ? context.upstream : []
      const project = upstream.find(item => isObject(item) && item.docType === 'context')
      if (project === undefined) {
        return [{
          jsonPath: '$',
          message: say(artifact,
            '找不到上游 context 产物（docType="context"）：生成时必须以绿回执的 cosmic-context 产物为 upstream；doc_validate 复验需传入相同 upstream 路径',
            'Upstream context artifact not found (docType="context"): generate with a green cosmic-context artifact as upstream; pass the same upstream paths when revalidating with doc_validate'),
        }]
      }
      const codes = contextModuleCodes(project)
      const levels = typeof context?.params?.moduleLevels === 'number' ? context.params.moduleLevels : undefined
      const issues = []
      getFunctions(artifact).forEach((fn, index) => {
        const changeKind = fn?.changeKind
        if (changeKind !== 'added' && changeKind !== 'modified') return // schema rejects other values
        const segments = funcIdSegments(fn?.funcId)
        const leafCode = segments[segments.length - 1] ?? ''
        if (leafCode === '') return
        if (changeKind === 'modified') {
          if (!codes.has(leafCode)) {
            issues.push({
              jsonPath: `$.functions[${index}].funcId`,
              message: say(artifact,
                `修改类功能的模块编号 "${leafCode}" 不存在于 context 模块树（修改必须指向已有模块）`,
                `The modified function's module code "${leafCode}" does not exist in the context module tree (a modification must target an existing module)`),
              snapshot: leafCode,
            })
          }
          return
        }
        if (codes.has(leafCode)) {
          issues.push({
            jsonPath: `$.functions[${index}].funcId`,
            message: say(artifact,
              `新增类功能的模块编号 "${leafCode}" 与 context 已有模块冲突（新增不得复用已有编号）`,
              `The added function's module code "${leafCode}" collides with an existing context module code (new modules must not reuse existing codes)`),
            snapshot: leafCode,
          })
          return
        }
        if (levels === undefined) return
        const level = Math.min(segments.length, levels)
        const convention = project[`moduleIdConventionForLevel${level}`]
        if (convention === 'numeric' && !/^[0-9]+$/.test(leafCode)) {
          issues.push({
            jsonPath: `$.functions[${index}].funcId`,
            message: say(artifact,
              `新增模块编号 "${leafCode}" 不符合第 ${level} 级编号规则 numeric（纯数字序号）`,
              `The added module code "${leafCode}" violates the level-${level} ID convention numeric (digits only)`),
            snapshot: leafCode,
          })
        } else if (convention === 'alphabetic' && !/^[A-Za-z]+$/.test(leafCode)) {
          issues.push({
            jsonPath: `$.functions[${index}].funcId`,
            message: say(artifact,
              `新增模块编号 "${leafCode}" 不符合第 ${level} 级编号规则 alphabetic（纯字母缩写）`,
              `The added module code "${leafCode}" violates the level-${level} ID convention alphabetic (letters only)`),
            snapshot: leafCode,
          })
        }
      })
      return issues
    },
  },
  {
    // moduleLevels parameter coupling (docs/designs/cosmic-context.md): the
    // schema keeps l2Name/l3Name optional (static structure); the effective
    // depth policy is enforced here — l2Name required from level 2, l3Name
    // from level 3, and the funcId segment count floors at moduleLevels.
    id: 'plan/name-hierarchy',
    severity: 'error',
    suggestion: '按生效参数 moduleLevels 补齐层级命名：levels≥2 时 l2Name 必填、levels=3 时 l3Name 必填；funcId 分段数不得少于 moduleLevels。',
    check(artifact, context) {
      if (!isObject(artifact)) return []
      const levels = context?.params?.moduleLevels
      if (typeof levels !== 'number') return []
      const issues = []
      getFunctions(artifact).forEach((fn, index) => {
        const segments = funcIdSegments(fn?.funcId)
        if (segments.length > 0 && segments.length < levels) {
          issues.push({
            jsonPath: `$.functions[${index}].funcId`,
            message: say(artifact,
              `funcId 分段数 ${segments.length} 少于生效参数 moduleLevels=${levels}（段即模块编号链）`,
              `funcId has ${segments.length} segment(s), fewer than the effective param moduleLevels=${levels} (segments are the module code chain)`),
            snapshot: str(fn?.funcId),
          })
        }
        if (levels >= 2 && str(fn?.l2Name) === '') {
          issues.push({
            jsonPath: `$.functions[${index}].l2Name`,
            message: say(artifact,
              `moduleLevels=${levels} 时 l2Name 必填`,
              `l2Name is required when moduleLevels=${levels}`),
          })
        }
        if (levels >= 3 && str(fn?.l3Name) === '') {
          issues.push({
            jsonPath: `$.functions[${index}].l3Name`,
            message: say(artifact,
              `moduleLevels=${levels} 时 l3Name 必填`,
              `l3Name is required when moduleLevels=${levels}`),
          })
        }
      })
      return issues
    },
  },
]
