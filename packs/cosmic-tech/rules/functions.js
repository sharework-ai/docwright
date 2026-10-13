// Function rules for the cosmic-tech pack: data-movement sequence checks
// migrated from cosmic-claude auditors/tech_auditor.py (E107/E109/E103/A101
// movement counts, E101 first entry, E105 no consecutive E/W/X, E108 entry
// after exit, W103 duplicate movements, W101 subprocess description keywords,
// W102 data property count) plus the CFP budget check (E101/W100/E200/W200
// family, parametrized by the shared cfpTotal downFactor/upFactor factors) and the chain-alignment
// pattern generalized from the req pack (E303): index/funcId/desiredCfps and
// process-name coverage against the upstream func artifact.
// Contract: export `rules`; each check(artifact, context) returns RuleIssue[]
// ({ jsonPath, message, snapshot? }); an empty array means pass. `context`
// carries upstream (parsed artifacts), materials (raw texts), and effective
// params — see docs/designs/function-rule-context.md. Messages follow the
// artifact's `language` field (zh-CN default, en-US variant) so one rule
// serves both language rule files.

function isObject(value) {
  return value !== null && typeof value === 'object'
}

/** Message selector: en-US only when the artifact itself says so. */
function say(artifact, zh, en) {
  return isObject(artifact) && artifact.language === 'en-US' ? en : zh
}

function getProcesses(artifact) {
  return isObject(artifact) && Array.isArray(artifact.processes) ? artifact.processes : []
}

function getMovements(proc) {
  return isObject(proc) && Array.isArray(proc.subProcesses) ? proc.subProcesses : []
}

/** W101 keyword list: technical-implementation words that belong in designs, not in subprocess descriptions. */
const DESC_KEYWORDS = ['计算', '转化', '转换', '拆分', '日志', '解析', '编码', '缓存', '临时', '筛选', '排序']


/** Tolerance band around desiredCfps, from the shared cfpTotal {downFactor, upFactor}; defaults tighten the old [0.9, 1.5] to [0.9, 1.2]. */
function budgetFactors(context) {
  const shared = context?.params?.cfpTotal
  const down = typeof shared?.downFactor === 'number' ? shared.downFactor : 0.9
  const up = typeof shared?.upFactor === 'number' ? shared.upFactor : 1.2
  return { down, up }
}

export const rules = [
  {
    // E303 pattern (generalized in the req pack): index/funcId/desiredCfps
    // plus process-name coverage against the upstream func artifact.
    id: 'tech/func-alignment',
    severity: 'error',
    suggestion: 'index/funcId/desiredCfps 必须与上游 func 产物完全一致（三者原样复制）；上游 func 的每个功能过程都必须出现在本产物的 processes 中（同名过程，不得遗漏或改写名称）；doc_validate 复验时请传入与生成时相同的 upstream 路径。',
    check(artifact, context) {
      if (!isObject(artifact)) return []
      const upstream = Array.isArray(context?.upstream) ? context.upstream : []
      const func = upstream.find(item => isObject(item) && item.docType === 'func')
      if (func === undefined) {
        return [{
          jsonPath: '$',
          message: say(artifact,
            '找不到上游 func 产物（docType="func"）：生成时必须以绿回执的 func 产物为 upstream；doc_validate 复验需传入相同 upstream 路径',
            'Upstream func artifact not found (docType="func"): generate with a green func artifact as upstream; pass the same upstream paths when revalidating with doc_validate'),
        }]
      }
      const issues = []
      const expect = (field, funcValue) => {
        if (artifact[field] !== funcValue) {
          issues.push({
            jsonPath: `$.${field}`,
            message: say(artifact,
              `${field} 与上游 func 不一致：tech 为 ${String(artifact[field])}，func 为 ${String(funcValue)}`,
              `${field} mismatches the upstream func artifact: tech has ${String(artifact[field])}, func has ${String(funcValue)}`),
            snapshot: `${field}=${String(artifact[field])}`,
          })
        }
      }
      expect('index', func.index)
      expect('funcId', func.funcId)
      expect('desiredCfps', func.desiredCfps)
      const techNames = new Set(getProcesses(artifact).map(p => (isObject(p) && typeof p.name === 'string' ? p.name : '')))
      for (const [index, proc] of getProcesses(func).entries()) {
        const name = isObject(proc) && typeof proc.name === 'string' ? proc.name : ''
        if (name !== '' && !techNames.has(name)) {
          issues.push({
            jsonPath: '$.processes',
            message: say(artifact,
              `上游 func 的功能过程 "${name}"（第 ${index + 1} 个）未出现在 tech 的 processes 中：每个 func 过程都必须被拆分`,
              `Upstream func process "${name}" (#${index + 1}) is missing from the tech processes: every func process must be broken down`),
            snapshot: `missing=${name}`,
          })
        }
      }
      return issues
    },
  },
  {
    // E107 (single movement) / E109 (<3) / E103 (>6) errors. The A101 advice
    // band (5-6 movements) lives in tech/movement-split-advice below —
    // FunctionRule carries one severity, so error and advice cannot share a rule.
    id: 'tech/movement-count',
    severity: 'error',
    suggestion: '每个功能过程的数据移动数量须在 3-6 个之间（4 个以内最佳，5-6 个会收到拆分建议，超过 6 个直接拒绝）：过程太小（1-2 个）说明边界没切开，应并入相邻过程或从 func 阶段重新划分；太大则按读写阶段拆成多个过程。',
    check(artifact) {
      const issues = []
      for (const [index, proc] of getProcesses(artifact).entries()) {
        const count = getMovements(proc).length
        const name = isObject(proc) ? String(proc.name) : `#${index + 1}`
        if (count === 1) {
          issues.push({
            jsonPath: `$.processes[${index}].subProcesses`,
            message: say(artifact,
              `功能过程 "${name}" 只包含 1 个数据移动：一个过程至少要有触发、处理、反馈的完整往返`,
              `Process "${name}" has only 1 data movement: a process needs at least a trigger, handling, and a response`),
            snapshot: `movements=${count}`,
          })
        } else if (count === 2) {
          issues.push({
            jsonPath: `$.processes[${index}].subProcesses`,
            message: say(artifact,
              `功能过程 "${name}" 只有 2 个数据移动：至少需要 3 个`,
              `Process "${name}" has only 2 data movements: at least 3 are required`),
            snapshot: `movements=${count}`,
          })
        } else if (count > 6) {
          issues.push({
            jsonPath: `$.processes[${index}].subProcesses`,
            message: say(artifact,
              `功能过程 "${name}" 的数据移动达 ${count} 个（超过 6 个）：按读写阶段拆分为多个功能过程`,
              `Process "${name}" has ${count} data movements (more than 6): split it by read/write phases into separate processes`),
            snapshot: `movements=${count}`,
          })
        }
      }
      return issues
    },
  },
  {
    // A101 migrated: 5-6 movements trigger a split advice (non-blocking).
    id: 'tech/movement-split-advice',
    severity: 'info',
    suggestion: '功能过程的数据移动有 5-6 个（建议拆分）：如果其中包含可独立的业务步骤（如先查询后维护），按读写阶段拆成两个功能过程；确属单一业务动作可保留。',
    check(artifact) {
      const issues = []
      for (const [index, proc] of getProcesses(artifact).entries()) {
        const count = getMovements(proc).length
        if (count > 4 && count <= 6) {
          issues.push({
            jsonPath: `$.processes[${index}].subProcesses`,
            message: say(artifact,
              `功能过程 "${String(isObject(proc) ? proc.name : index + 1)}" 的数据移动有 ${count} 个（超过 4 个，建议拆分）`,
              `Process "${String(isObject(proc) ? proc.name : index + 1)}" has ${count} data movements (more than 4; consider splitting)`),
            snapshot: `movements=${count}`,
          })
        }
      }
      return issues
    },
  },
  {
    // E101 migrated: the first movement of every process must be an Entry.
    id: 'tech/first-movement-entry',
    severity: 'error',
    suggestion: '功能过程的第一个数据移动必须是 E（Entry）：过程由外部事件触发，先有输入才有后续处理；把触发事件对应的输入子过程放到首位。',
    check(artifact) {
      const issues = []
      for (const [index, proc] of getProcesses(artifact).entries()) {
        const movements = getMovements(proc)
        const first = movements[0]
        const type = isObject(first) ? first.dataMovementType : undefined
        if (type !== 'E') {
          issues.push({
            jsonPath: `$.processes[${index}].subProcesses[0].dataMovementType`,
            message: say(artifact,
              `功能过程 "${String(isObject(proc) ? proc.name : index + 1)}" 的第一个数据移动必须是 E，实际为 ${String(type)}`,
              `The first data movement of process "${String(isObject(proc) ? proc.name : index + 1)}" must be E, got ${String(type)}`),
            snapshot: `first=${String(type)}`,
          })
        }
      }
      return issues
    },
  },
  {
    // E105 migrated: E, W, X must not repeat adjacently (only R may repeat).
    id: 'tech/no-consecutive-ewx',
    severity: 'error',
    suggestion: 'E/W/X 类型的数据移动不能连续出现相同类型（只有 R 可以连续）：连续的同类移动要么合并为一个子过程，要么在中间补上读取/处理步骤。',
    check(artifact) {
      const issues = []
      for (const [index, proc] of getProcesses(artifact).entries()) {
        const movements = getMovements(proc)
        const name = isObject(proc) ? String(proc.name) : `#${index + 1}`
        for (let i = 1; i < movements.length; i++) {
          const type = isObject(movements[i]) ? movements[i].dataMovementType : undefined
          const prev = isObject(movements[i - 1]) ? movements[i - 1].dataMovementType : undefined
          if ((type === 'E' || type === 'W' || type === 'X') && type === prev) {
            issues.push({
              jsonPath: `$.processes[${index}].subProcesses[${i}].dataMovementType`,
              message: say(artifact,
                `功能过程 "${name}" 第 ${i + 1} 个数据移动与第 ${i} 个同为 ${String(type)}：E/W/X 不能连续重复`,
                `Process "${name}" has the same type ${String(type)} at movements ${i} and ${i + 1}: E/W/X must not repeat adjacently`),
              snapshot: `${String(prev)}${String(type)}`,
            })
          }
        }
      }
      return issues
    },
  },
  {
    // E108 migrated: every non-first Entry must immediately follow an Exit.
    id: 'tech/entry-after-exit',
    severity: 'error',
    suggestion: '功能过程中非首个的 E（Entry）之前必须是 X（Exit）：新一轮输入意味着上一轮交互已经给出输出，先补上输出的子过程。',
    check(artifact) {
      const issues = []
      for (const [index, proc] of getProcesses(artifact).entries()) {
        const movements = getMovements(proc)
        const name = isObject(proc) ? String(proc.name) : `#${index + 1}`
        for (let i = 1; i < movements.length; i++) {
          const type = isObject(movements[i]) ? movements[i].dataMovementType : undefined
          const prev = isObject(movements[i - 1]) ? movements[i - 1].dataMovementType : undefined
          if (type === 'E' && prev !== 'X') {
            issues.push({
              jsonPath: `$.processes[${index}].subProcesses[${i}].dataMovementType`,
              message: say(artifact,
                `功能过程 "${name}" 第 ${i + 1} 个数据移动为 E，但其前一个移动是 ${String(prev)} 而非 X：非首个 E 之前必须是 X`,
                `Process "${name}" has an E at movement ${i + 1} preceded by ${String(prev)}, not X: every non-first E must follow an Exit`),
              snapshot: `${String(prev)}E`,
            })
          }
        }
      }
      return issues
    },
  },
  {
    // W103 migrated: identical movement combinations within one process.
    id: 'tech/movement-duplicate',
    severity: 'warning',
    suggestion: '同一功能过程内出现了类型+数据组+数据属性完全相同的数据移动：删除重复项，或区分两次移动的业务含义（如读取时机不同）后改写描述与数据属性。',
    check(artifact) {
      const issues = []
      for (const [index, proc] of getProcesses(artifact).entries()) {
        const seen = new Map()
        const name = isObject(proc) ? String(proc.name) : `#${index + 1}`
        for (const [i, mv] of getMovements(proc).entries()) {
          if (!isObject(mv)) continue
          const props = Array.isArray(mv.dataProperties) ? mv.dataProperties.map(String) : []
          const key = `${String(mv.dataMovementType)}|${String(mv.dataGroup)}|${props.join(',')}`
          if (seen.has(key)) {
            issues.push({
              jsonPath: `$.processes[${index}].subProcesses[${i}]`,
              message: say(artifact,
                `功能过程 "${name}" 第 ${i + 1} 个数据移动与第 ${seen.get(key) + 1} 个重复（类型/数据组/数据属性完全相同）`,
                `Process "${name}" repeats the identical movement (type/data group/properties) at ${seen.get(key) + 1} and ${i + 1}`),
              snapshot: key,
            })
          } else {
            seen.set(key, i)
          }
        }
      }
      return issues
    },
  },
  {
    // W101 migrated: technical words in subprocess descriptions.
    id: 'tech/subprocess-desc-keywords',
    severity: 'warning',
    suggestion: '子过程描述含技术实现字眼（计算/转化/转换/拆分/日志/解析/编码/缓存/临时/筛选/排序）：描述应写清什么数据在功能用户与系统之间移动，实现方式留给详细设计。',
    check(artifact) {
      const issues = []
      for (const [index, proc] of getProcesses(artifact).entries()) {
        const name = isObject(proc) ? String(proc.name) : `#${index + 1}`
        for (const [i, mv] of getMovements(proc).entries()) {
          const desc = isObject(mv) && typeof mv.description === 'string' ? mv.description : ''
          const hit = DESC_KEYWORDS.find(k => desc.includes(k))
          if (hit !== undefined) {
            issues.push({
              jsonPath: `$.processes[${index}].subProcesses[${i}].description`,
              message: say(artifact,
                `功能过程 "${name}" 第 ${i + 1} 个子过程描述建议不包含"${hit}"`,
                `Subprocess ${i + 1} of process "${name}" should not contain the technical word "${hit}"`),
              snapshot: hit,
            })
          }
        }
      }
      return issues
    },
  },
  {
    // W102 migrated: a movement should carry at least two data properties.
    id: 'tech/data-properties-count',
    severity: 'warning',
    suggestion: '数据移动的 dataProperties 至少列出 2 个数据项：只写 1 个通常说明数据组刻画不完整，补齐该移动真正携带的业务字段。',
    check(artifact) {
      const issues = []
      for (const [index, proc] of getProcesses(artifact).entries()) {
        const name = isObject(proc) ? String(proc.name) : `#${index + 1}`
        for (const [i, mv] of getMovements(proc).entries()) {
          const props = isObject(mv) && Array.isArray(mv.dataProperties) ? mv.dataProperties : []
          if (props.length < 2) {
            issues.push({
              jsonPath: `$.processes[${index}].subProcesses[${i}].dataProperties`,
              message: say(artifact,
                `功能过程 "${name}" 第 ${i + 1} 个数据移动只携带 ${props.length} 个数据属性（建议至少 2 个）`,
                `Movement ${i + 1} of process "${name}" carries only ${props.length} data propert${props.length === 1 ? 'y' : 'ies'} (at least 2 recommended)`),
              snapshot: `dataProperties.length=${props.length}`,
            })
          }
        }
      }
      return issues
    },
  },
  {
    // CFP budget error bounds migrated (E101/E200): total CFPs vs the
    // desiredCfps budget, with the error ratios exposed as pack params. The
    // W100/W200 warning bands live in tech/cfp-budget-advice below —
    // FunctionRule carries one severity, so error and warning cannot share a rule.
    id: 'tech/cfp-total-vs-budget',
    severity: 'error',
    suggestion: '全部子过程的 CFP 总数须落在预算区间 [desiredCfps×downFactor, desiredCfps×upFactor] 内（容差系数见生效参数 cfpTotal）：不足说明拆分粒度太粗（继续从素材细化数据移动），超出说明拆分过细（合并同类子过程）。',
    check(artifact, context) {
      if (!isObject(artifact)) return []
      const desired = artifact.desiredCfps
      if (typeof desired !== 'number' || !Number.isInteger(desired) || desired < 1) return []
      let total = 0
      for (const proc of getProcesses(artifact)) {
        for (const mv of getMovements(proc)) {
          if (isObject(mv) && typeof mv.cfp === 'number') total += mv.cfp
        }
      }
      const factors = budgetFactors(context)
      const minRatio = factors.down
      const maxRatio = factors.up
      const floor = desired * minRatio
      const ceil = desired * maxRatio
      if (total < floor) {
        return [{
          jsonPath: '$.processes',
          message: say(artifact,
            `CFP 总数不足：实际 ${total}，低于预算下限 ${desired}×${minRatio}=${floor}（desiredCfps=${desired}）`,
            `Total CFPs too low: got ${total}, below the budget floor ${desired}×${minRatio}=${floor} (desiredCfps=${desired})`),
          snapshot: `totalCfps=${total}`,
        }]
      }
      if (total > ceil) {
        return [{
          jsonPath: '$.processes',
          message: say(artifact,
            `CFP 总数超出：实际 ${total}，高于预算上限 ${desired}×${maxRatio}=${ceil}（desiredCfps=${desired}）`,
            `Total CFPs too high: got ${total}, above the budget ceiling ${desired}×${maxRatio}=${ceil} (desiredCfps=${desired})`),
          snapshot: `totalCfps=${total}`,
        }]
      }
      return []
    },
  },
  {
    // W100/W200 migrated: inside the error bounds but off the budget by more
    // than the tolerance bands fixed at [min, 1) and (1.2, max].
    id: 'tech/cfp-budget-advice',
    severity: 'warning',
    suggestion: 'CFP 总数偏离预算但在容差区间内（容差系数见生效参数 cfpTotal）：低于预算对照素材补齐数据移动，高于预算检查是否拆分过细（合并同类子过程）。',
    check(artifact, context) {
      if (!isObject(artifact)) return []
      const desired = artifact.desiredCfps
      if (typeof desired !== 'number' || !Number.isInteger(desired) || desired < 1) return []
      let total = 0
      for (const proc of getProcesses(artifact)) {
        for (const mv of getMovements(proc)) {
          if (isObject(mv) && typeof mv.cfp === 'number') total += mv.cfp
        }
      }
      const factors = budgetFactors(context)
      if (total < desired * factors.down || total > desired * factors.up) return []
      if (total === desired) return []
      return [{
        jsonPath: '$.processes',
        message: say(artifact,
          `CFP 总数偏离预算：实际 ${total}，期望 ${desired}（容差区间 [${factors.down}×${desired}, ${factors.up}×${desired}] 内，仅提示）`,
          `Total CFPs deviate from the budget: got ${total}, expected ${desired} (within tolerance [${factors.down}×${desired}, ${factors.up}×${desired}]; advisory only)`),
        snapshot: `totalCfps=${total}`,
      }]
    },
  },
]
