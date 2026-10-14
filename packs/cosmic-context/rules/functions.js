// Function rules for the cosmic-context pack (docs/designs/cosmic-context.md):
// the schema carries structure and enums, these rules carry cross-node
// semantics and the moduleLevels parameter coupling. Contract: export
// `rules`; each check(artifact, context) returns RuleIssue[] ({ jsonPath,
// message, snapshot? }); an empty array means pass. Messages follow the
// artifact's `language` field (zh-CN default, en-US variant).

function isObject(value) {
  return value !== null && typeof value === 'object'
}

/** Message selector: en-US only when the artifact itself says so. */
function say(artifact, zh, en) {
  return isObject(artifact) && artifact.language === 'en-US' ? en : zh
}

function modulesAt(artifact) {
  const doc = isObject(artifact) ? artifact : {}
  return Array.isArray(doc.modules) ? doc.modules : []
}

function childrenOf(node) {
  return isObject(node) && Array.isArray(node.children) ? node.children : []
}

function str(value) {
  return typeof value === 'string' ? value : ''
}

/** Walk the three schema-expressible levels; visits { node, level, path }. */
function* walkModules(nodes, level = 1, base = '$.modules') {
  for (const [index, node] of (nodes ?? []).entries()) {
    const path = `${base}[${index}]`
    yield { node, level, path }
    if (level < 3) {
      yield* walkModules(childrenOf(node), level + 1, `${path}.children`)
    }
  }
}

/** Deepest level holding at least one node (0 for an empty tree). */
function actualDepth(nodes) {
  let depth = 0
  for (const { level } of walkModules(nodes)) depth = Math.max(depth, level)
  return depth
}

function hasModuleAtLevel(nodes, level) {
  for (const entry of walkModules(nodes)) {
    if (entry.level === level) return true
  }
  return false
}

export const rules = [
  {
    // Module codes are the identity of a module (plan-stage funcId segments
    // are code chains): a duplicate code makes the tree ambiguous.
    id: 'context/module-code-unique',
    severity: 'error',
    suggestion: '模块 code 是模块的身份（plan 阶段 funcId 的段即模块 code 链）：调整重复编号使全树（三层）唯一。',
    check: (artifact) => {
      const seen = new Map()
      const issues = []
      for (const { node, level, path } of walkModules(modulesAt(artifact))) {
        const code = str(isObject(node) ? node.code : undefined)
        if (code === '') continue
        if (seen.has(code)) {
          issues.push({
            jsonPath: `${path}.code`,
            message: say(artifact,
              `模块 code 重复：${code} 在第 ${seen.get(code).level} 级（${seen.get(code).path}）与第 ${level} 级（${path}）都存在`,
              `Duplicate module code: ${code} exists both at level ${seen.get(code).level} (${seen.get(code).path}) and level ${level} (${path})`),
            snapshot: code,
          })
        } else {
          seen.set(code, { level, path })
        }
      }
      return issues
    },
  },
  {
    // The declared tree depth is a shared chain parameter (moduleLevels):
    // the artifact must match it exactly, or downstream level-sensitive
    // rules (plan/name-hierarchy) anchor to the wrong depth.
    id: 'context/module-depth',
    severity: 'error',
    suggestion: '调整模块树使其实际最大层级深度等于生效参数 moduleLevels（1-3）：树少一级则继续细分，多一级则合并或提升 moduleLevels 参数。',
    check(artifact, context) {
      const levels = context?.params?.moduleLevels
      if (typeof levels !== 'number') return []
      const modules = modulesAt(artifact)
      const depth = actualDepth(modules)
      if (depth === levels) return []
      return [{
        jsonPath: '$.modules',
        message: say(artifact,
          `模块树实际最大深度 ${depth} 与生效参数 moduleLevels=${levels} 不一致`,
          `The module tree's actual maximum depth ${depth} does not match the effective param moduleLevels=${levels}`),
        snapshot: `depth=${depth}`,
      }]
    },
  },
  {
    // Every level in use must declare its ID convention: new modules are
    // numbered by these conventions at the plan stage (plan/context-alignment).
    id: 'context/module-id-convention',
    severity: 'error',
    suggestion: '树用到第 N 级（N ≤ moduleLevels）就必须声明 moduleIdConventionForLevelN（numeric 数字序号或 alphabetic 字母缩写）：新增模块编号在 plan 阶段依赖该规则。',
    check(artifact, context) {
      const levels = context?.params?.moduleLevels
      if (typeof levels !== 'number') return []
      const doc = isObject(artifact) ? artifact : {}
      const modules = modulesAt(artifact)
      const issues = []
      for (let level = 1; level <= Math.min(levels, 3); level++) {
        const key = `moduleIdConventionForLevel${level}`
        if (hasModuleAtLevel(modules, level) && doc[key] === undefined) {
          issues.push({
            jsonPath: `$.${key}`,
            message: say(artifact,
              `模块树用到第 ${level} 级但未声明 ${key}（numeric 或 alphabetic）`,
              `The module tree uses level ${level} but ${key} (numeric or alphabetic) is not declared`),
            snapshot: 'missing',
          })
        }
      }
      return issues
    },
  },
  {
    // Assumptions are the explicit register of everything the model invented:
    // non-empty means a human must review before the context is fully trusted.
    id: 'context/assumptions-review',
    severity: 'warning',
    suggestion: 'assumptions 中的条目为模型假定（素材未覆盖）：采纳前请人工审阅；修正产物后可用 doc_validate 的 seal 回签重新入链。',
    check: (artifact) => {
      const assumptions = isObject(artifact) ? artifact.assumptions : undefined
      if (!Array.isArray(assumptions) || assumptions.length === 0) return []
      return [{
        jsonPath: '$.assumptions',
        message: say(artifact,
          `以下 ${assumptions.length} 条为模型假定（素材未覆盖），采纳前请审阅；修正后可用 seal 回签重新入链`,
          `The following ${assumptions.length} items are model assumptions (not covered by the materials); review them before adopting; after corrections, re-seal via doc_validate`),
        snapshot: `${assumptions.length} item(s)`,
      }]
    },
  },
]
