# hanzeep 功能说明书（MVP）

Status: CURRENT — 本文描述插件现状，与代码不一致时以代码为准。
Repo: sharework-ai/dsh-plugin-hanzeep
Updated: 2026-10-11

> 本文前身是 2026-08-27 /office-hours + /autoplan 产出的设计决策文档（含 44 条决策审计、评审报告）。现已重写为 current-state 功能说明书；遵循"规格零历史"纪律，正文不含设计推演——原决策过程记录只在 git 历史中（`git log -- docs/designs/hanzeep-mvp.md`），进行中的设计提案见 docs/designs/ 下各 PROPOSED 文档。

## 1. 产品定位

hanzeep 是 deepseek-harness（dsh）的文档生成插件：AI 生成结构化 JSON 文档 → 强制校验 → 不合格打回重写，直到全绿；每份文档自带机器可读的验证回执，任何人可离线复验。

解决的问题：AI 大量生成文档时质量不可控、结果不可验证。

读者可能会问：让 LLM 输出 JSON 并在校验失败时自动重试，不是已经有现成轮子了吗？确实有——instructor、BAML、Guardrails AI 这类结构化输出框架都内置"schema 校验 + 重试"。但它们只判断**结构对不对**（字段齐不齐、类型对不对），判断不了**内容合不合格**——"功能描述要写满 80 字""名称不许用'管理/系统'这类泛化词""估算值总和要落在业务区间"这类标准因文档类型而异，框架无从知晓。

hanzeep 的差异化就在"内容合格性"这一层，由三件事组成：

1. **领域规则包（pack）**：每类文档的合格标准（schema + 领域规则 + prompt + 模板）声明在可插拔的数据包里，换文档类型不换代码；
2. **可复验回执（receipt）**：校验结果作为机器可读文件随文档落盘，任何人可事后复验——"全绿"从一次过程变成一件产物；
3. **闭环修复**：校验不过自动把问题清单喂回模型重写，直到全绿或明确失败。

与结构化输出框架相比，差异不在"会不会重试"，而在**合格标准可插拔（pack）、校验结论可复验（receipt）**。安装与上手（quickstart、工具示例）见仓库根 README。

## 2. 核心概念

| 概念 | 是什么 | 由谁提供 |
|---|---|---|
| **插件（hanzeep）** | 引擎：闭环、校验执行、回执、路径安全、dsh 工具注册。不含任何文档领域知识 | 本仓库 TypeScript 代码 |
| **pack（场景包）** | 内容：一类文档的 schema、规则、生成 prompt、渲染模板、golden 样例。纯 JSON 数据 + 至多一个 JS 规则文件 | `packs/<name>/` 目录，任何人可编写 |
| **闭环（repair loop）** | 生成 → 校验 → 把 Issue 喂回模型重写 → 直到全绿或迭代耗尽 | 插件 |
| **验证回执（receipt）** | 全绿状态的机器可读快照（产物哈希、规则集快照、逐规则结果），随产物落盘，可离线复验 | 插件生成；pack 提供被快照的规则 |

一句话分工：**换文档类型 = 新写一个 pack 目录，插件零改动；改闭环/校验/回执行为 = 改插件。**

## 3. 插件功能（机制层）

插件导出 `name: 'hanzeep'`、`inject: ['tools', 'llm']`、`Config`；`apply()` 时加载全部 pack 并注册三个工具（`doc_packs` / `doc_generate` / `doc_validate`）。pack 加载失败（坏 manifest、坏规则、Config 默认语言不被支持）在 apply 期直接报错，不会带病进入会话。

### 3.0 工具 `doc_packs` — 能力发现（拉式）

零参数工具，返回已装载 pack 注册表 `[{ name, version, description, languages, consumes }]`。`doc_generate`/`doc_validate` 的描述与 `pack` 参数描述内置静态邀请（先调 `doc_packs`）；未知 pack 报错同时给出 `doc_packs` 提示与可用清单——模型跳过发现时由此自愈。工具描述不随 pack 集合变化（拉式渐进披露，见 docs/designs/capability-discovery.md）。

### 3.1 工具 `doc_generate` — 闭环生成

| 参数 | 类型 | 语义 |
|---|---|---|
| `pack` | string，必填 | pack 名；未知名称报错并列出全部可用 pack |
| `materials` | string[]，必填 | 素材引用，≥1 条。两种形态：相对 materialsRoot（默认 `<workspace>/references/`）的文件路径；或以 `#!inline` 开头的内联文本（显式标记，无启发式判断） |
| `language` | string? | 输出语言。优先级：tool 参数 > Config `defaultLanguage` > pack 的第一个语言；不被该 pack 支持即调用期报错 |
| `upstream` | string[]? | 上游产物路径（workspace 相对）。仅当 pack 声明了 `consumes` 时必填，见 3.5 |
| `artifactName` | string? | 输出基础名，仅允许 `[A-Za-z0-9._-]` 的纯 basename（拒绝路径形状与 `..`）；默认 `<pack>-<时间戳>` |
| `maxRounds` | number? | 当次闭环轮数上限（用户意图经模型转述）；被 Config `maxRoundsCeiling` 硬钳制，任何层不可穿透 |
| `params` | object? | pack 声明参数（`manifest.params`，doc_packs 可见清单）的覆盖值；未知名称/类型/枚举/越界 fail loud 并列出可用参数 |

前置条件：Config 必须配置 `provider` + `model`（宿主 LLM 编排中的路由名），缺失即调用期报错。

行为：素材读取与首 prompt token 预检 → 闭环（3.2）→ 落盘三个文件（产物 JSON、sidecar 回执、Markdown 渲染），全部 tmp+rename 原子写、产物先于回执落盘（崩溃只会留下可读草稿，不会留下孤儿回执）。

返回 `{ artifactPath, markdownPath, receipt }`（回执内联全量，agent 无需二次读文件）；warn 策略下追加 `upstreamWarnings`。全绿时产物是正式产物；**迭代耗尽时工具抛错（fail loud），但草稿 + 红回执（`isValid: false` + 全部未解决 Issue）保留在磁盘上**，供人工救援，绝不静默采用最后一轮。

### 3.2 闭环修复循环（核心机制）

每一轮：

1. **预算预检**：prompt + 当前产物的估算 token（CJK 字符 ≈1 token/字，其余 ≈4 字符/token）超过 `promptTokenBudget` 即抛错，提示拆分素材或调大预算。
2. **模型调用**：经 `ctx.llm` 单一入口按 provider/model 路由流式调用；传输失败自动重试一次；取消（AbortError）原样透传。调用失败映射为 `internal/llm-error` Issue → 本轮即耗尽，保留已有草稿。
3. **解析**：剥离代码围栏后提取第一个完整 JSON 对象；解析失败映射为 `internal/invalid-output` Issue——与校验失败走同一条修复路径，不单独重试。
4. **校验**：ajv schema 校验（`allErrors`）+ 声明式规则 + JS 函数规则，全部映射为统一 Issue 格式：`{ ruleId, severity: error|warning|info, jsonPath, message, snapshot?(≤80 字截断), suggestion? }`。ajv 违规归并为 `schema/<keyword>` 规则族；修复 prompt、回执、报告只消费这一种格式（统一错误格式是闭环的粘合剂）。
5. **判定**：**全绿 = 0 条 ERROR**（warning/info 不拦截）。全绿即成功返回；否则组装修复 prompt 进入下一轮。

**修复 prompt 组装**：原生成 prompt + 当前产物 JSON + 按 jsonPath 分组、逐条携带 severity/message/suggestion 的 Issue 清单 + 指令"只修复列出的问题，输出完整 JSON，不要改动未列出的部分"。

**收敛检测与提前终止**（详见 docs/designs/convergence-detection.md）：提前终止只决定"何时放弃"，全绿判定始终是 0 ERROR。三层策略由 `oscillation.mode` 选择（默认 `auto`）：

1. **pack 评分**：`functions.js` 导出 `score(artifact, issues)`（0-100 百分制，越高越好；越界/崩溃 fail loud）时启用。连续 K 轮未超过历史最优分（默认 K=3，容忍单轮回撤）→ 终止 reason `stagnation`；连续 D 轮严格下降（默认 D=3）→ reason `decline`。
2. **内置默认评分**（pack 未导出 score 时自动启用）：`clamp(100 − 10×error − 3×warning − 1×info, 0, 100)`，权重可配。
3. **指纹兜底**（`mode: "fingerprint"`）：连续 3 轮 Issue 指纹完全相同 → reason `fingerprint-repeat`。

**迭代上限**：生效轮数 = clamp(`maxRounds` 参数 ?? pack `manifest.maxRounds` ?? Config `maxIterations`（默认 5）, `maxRoundsCeiling`（默认 10，宿主运维持有，任何层不可穿透））。耗尽 → reason `max-iterations`，按失败返回（见 3.1）；模型调用失败 → reason `llm-error`。终止原因与每轮评分（score 模式）写入回执，收敛过程可审计。生成 prompt 的 `{{params}}` 槽位渲染生效参数（模型看得见旋钮），生效参数以 as-run 记入回执。

### 3.3 验证回执（receipt）

sidecar 文件 `<产物名>.receipt.json` 与产物同目录；同时内联在工具返回值里。字段：

| 字段 | 说明 |
|---|---|
| `formatVersion` | 回执格式版本（当前 1） |
| `pack` / `packVersion` | 生成时使用的 pack 名与版本 |
| `language` | 生成语言 |
| `artifactHash` | 产物 canonical JSON（键排序、无空白）的 sha256 |
| `schemaHash` | pack schema 的 sha256 |
| `rulesetSnapshot` | **声明式规则全文**（按语言）+ `functions.js` 源码哈希——pack 升级后历史回执仍可解释当时依据 |
| `upstreamHashes` | 链式锚点：每个上游的 pack/packVersion/artifactHash |
| `iterations` / `rounds` | 闭环轮数；每轮 `{round, errorCount, warningCount}` 及评分（score 模式，0-100）与 `promptHash`（该轮生成 prompt 的 sha256） |
| `rules` | 逐规则 rollup：`{ruleId, severity, status: pass\|fail, count}`；schema 违规归并为 `schema/*` 族 |
| `isValid` | 全绿与否 |
| `terminationReason` | 红回执的终止原因（`stagnation` / `decline` / `fingerprint-repeat` / `max-iterations` / `llm-error`）；绿回执无此字段 |
| `params` | 生效的 pack 参数 as-run（未覆盖即声明默认）；`doc_validate` 默认按它复验 |
| `generatedAt` / `model` | ISO 时间戳；模型标识（复验轮为 `revalidate`） |

**防篡改语义**：`doc_generate` 与 `doc_validate` 共用同一个回执构造器（两种回执永不漂移）。回执是 tamper-evident 而非 tamper-proof——无签名，误改必红，蓄意伪造产物+回执不可防。

### 3.4 工具 `doc_validate` — 确定性复验（零 LLM）

参数：`artifactPath`（workspace 相对路径）、`pack`、`language?`、`params?`、`upstream?`（链式 pack 复验用，同生成时的 workspace 相对路径数组）。对既有产物用**当前安装的 pack 规则**重跑校验，返回 `{ artifactPath, receipt, hashMatches, packVersionStale }`。校验默认使用回执记录的 as-run 参数（**按当时的标准复验**）；显式传 `params` 可做 what-if 校验。传入 `upstream` 时走与 `doc_generate` 相同的六项上游校验，解析后的产物注入函数规则 context（跨产物规则得以复验），回执同步记录 `upstreamHashes` 锚点。

- `hashMatches`：`true` 产物与 sidecar 回执哈希一致；`false` 生成后被改动过（篡改可见）；`null` 无 sidecar（如手工拷入的样例）。
- `packVersionStale`：`true` 回执由**另一个 pack 版本**写入——绿回执证明的是旧规则，应重新生成（无版本记录的回执也算 stale）；`false` 版本一致；`null` 无回执。
- `language` 显式传参时必须与回执记录一致，否则报错；缺省时按"参数 > 回执记录 > Config 默认 > pack 首语言"取。

### 3.5 链式消费（`consumes`）

pack 的 `manifest.consumes` 声明其消费的上游产物类型（根 pack 为 `[]`）。`doc_generate` 对每个 `upstream` 引用强制校验，任一不过即报错：

1. 文件可读且为合法 JSON；
2. 存在 sidecar 回执（没有就要求先用 doc_generate 生成）；
3. 回执是**绿**的（红草稿永远不得流入下游）；
4. 回执内 `artifactHash` 与当前文件内容一致（上游被改过即拒绝）;
5. 回执的 pack 类型在消费方的 `consumes` 列表中；
6. 该上游 pack 已安装，且版本 staleness 按 `upstreamVersionPolicy` 处理：`strict`（默认）拒绝版本不符的上游，`warn` 放行但在返回值中附 `upstreamWarnings`。

### 3.6 pack 装载（apply 期，fail loud）

装载范围 = 插件内置 `packs/` + Config `packsDir`（同名 pack 后者覆盖前者）。加载期强制校验（任何一条不过，整个插件启动失败）：manifest 字段完整；声明的每种语言都有 `rules/<lang>.json` + `prompts/<lang>.md` + `templates/<lang>.hbs` 三件套；声明式规则逐条校验（severity 枚举、kind 枚举、kind 载荷、pattern 可编译、suggestion 非空）；prompt 必须含 `{{materials}}` 槽位（否则素材会被静默丢弃）；`functions.js` 若存在必须可导入且导出 `rules` 数组；golden.json 必须存在；Config 设了 `defaultLanguage` 时所有 pack 都必须支持它；pack 集合为空报错。

Schema 的 ajv 编译在首次构建该 (pack, language) 的 DocService 时发生（schema.json JSON 语法错误仍是加载期报错）；编译产物按 (pack, language) 缓存，整个插件生命周期只编译一次。空模板渲染出的空 Markdown 也报错。

### 3.7 配置（cordis.yml，no hardcoded tunables）

```yaml
- id: hanzeep
  config:
    packsDir: ""            # 额外 pack 目录；同名覆盖内置
    workspaceRoot: ""       # 无会话 workspace 时的兜底根（默认 cwd）
    materialsRoot: ""       # 素材根（默认 <workspace>/references）
    outputRoot: ""          # 产物根（默认 <workspace>/output）
    defaultLanguage: "zh-CN"
    maxIterations: 5        # 闭环轮数全局默认
    maxRoundsCeiling: 10    # 轮数绝对上限（宿主运维持有，任何覆盖不可穿透）
    promptTokenBudget: 60000
    upstreamVersionPolicy: "strict"  # 链式上游版本不符：strict 拒绝 / warn 放行并告警
    oscillation:            # 收敛检测（提前终止策略，详见 docs/designs/convergence-detection.md）
      mode: auto            # auto | score | fingerprint
      stagnantRounds: 3
      decliningRounds: 3
      maxRepeats: 3
      epsilon: 0
      defaultScore: { error: 10, warning: 3, info: 1 }
    provider: "deepseek-official"    # 宿主 LLM 路由名（必填才能 doc_generate）
    model: "deepseek-chat"
```

workspace root 决策链：会话 workspace（如 dsh web UI 选择的目录）> `workspaceRoot` > 进程 cwd。`materialsRoot`/`outputRoot` 可相对（拼接到 workspace root）可绝对，但**必须落在 workspace root 内**，越界报错。Linux 宿主上，传给任何路径参数的 Windows 盘符路径（`D:\x\y`）先经 `wslpath` 归一化为 WSL 挂载点（带正则兜底）。注意：`provider` 路由名不存在时不报响错而是空流——doc_generate 第一轮报 llm-error 时先核对适配器注册的路由名。

### 3.8 路径与信任模型（安全边界）

- **三重路径包含**：素材路径做词法 + realpath 双重校验（工作区内软链指向外部也拒绝）；`artifactPath`/`upstream` 与两个 root 同样被限制在 workspace root 内。目的是把密钥挡在 prompt 之外。
- **素材是受信输入**：素材内容可引导生成结果（二阶注入）；MVP 接受此边界并文档化，nonce 定界符待真实反馈再立项。
- 回执防误改不防恶意（见 3.3）。

## 4. Pack 契约（内容层，作者视角）

### 4.1 目录结构

```
packs/<name>/
├── manifest.json      # name / version / description / consumes / languages / maxRounds? / params?
├── schema.json        # JSON Schema（draft-07 或 2020-12），定义"文档长什么样"
├── rules/<lang>.json  # 声明式规则，定义"什么算合格"（简单族）
├── rules/functions.js # JS 函数规则（可选），跨字段规则（唯一性、求和、区间）
├── prompts/<lang>.md  # 按语言的生成 prompt，定义"怎么生成"
├── templates/<lang>.hbs # 按语言的 Handlebars 模板，定义"怎么渲染成 Markdown"
└── samples/golden.json  # 全绿母本，变异测试的输入
```

`languages` 里声明的每个语言标签，三件套（rules/prompt/template）缺一不可（加载期强制）。`manifest.description`（一句话，说明该 pack 生成什么文档）必填、加载期强制——`doc_packs` 把它原样返回给模型。`manifest.maxRounds`（可选）是该 pack 的轮数默认。`manifest.params`（可选）声明可调参数：**声明即白名单**——每项 `{ type, default, description, enum?, min?, max? }`，default 必填且须满足自身约束；未声明的名称谁都不能调（加载期校验声明合法，调用期校验取值）。多语言只影响表达层——文档结构与 schema 语言无关。

### 4.2 声明式规则（四族）

每条规则：`{ id, severity: error|warning|info, given, field, kind, ..., suggestion }`。`given` 支持 `$`（根对象）与 `$.<arrayField>[*]`（数组逐项），其余路径加载期报错。minLength/maxLength 的数值边界可写 `{ "param": "<声明的数字参数>" }` 引用 pack 参数（按次解析，未声明的引用加载期报错）。

| kind | 载荷 | 语义 |
|---|---|---|
| `minLength` | `min` | 字符串长度下限 |
| `maxLength` | `max` | 字符串长度上限 |
| `forbiddenKeywords` | `keywords[]` | 命中任一关键字即违规 |
| `pattern` | `pattern`, `mustMatch` | 正则须匹配（或不匹配） |

### 4.3 函数规则（`rules/functions.js`）

导出 `rules` 数组，每条 `{ id, severity(默认 error), suggestion, check(artifact, context?) }`；`check` 返回 `RuleIssue[]`（`{ jsonPath, message, snapshot? }`，空数组即通过），拿到整个产物，负责声明式四族表达不了的跨字段断言。第二参 `context`（可选，旧单参规则零改动兼容）携带本次调用产物之外的信息：`upstream`（解析后的上游产物数组）、`materials`（素材原文）、`params`（生效参数）——链式 pack 用它做跨产物校验（如 req 对 plan 的三点对齐）与部署白名单（如功能用户角色）。规则运行时崩溃会带上规则 id 报错（不静默跳过）。另可导出 `score(artifact, issues) => 0-100`（收敛检测的 pack 层评分，越高越好；缺省自动启用内置严重度评分）。设计依据见 docs/designs/function-rule-context.md。

### 4.4 作者硬契约

1. **每条规则（声明式与函数）必须带 `suggestion`**——修复 prompt 的质量不随 pack 作者漂移（加载期强制）。
2. **golden.json 必须全绿**；每条规则族至少配一种"故意损坏"的变异测试，断言 checker 全部抓住——抓不住损坏样本的 checker 是摆设（内置 pack 由测试套件强制，外部 pack 为约定契约）。
3. `version` 是破坏性变更的逃生门：改规则语义必须升版本，旧产物回执会被 `packVersionStale` / 链式校验识别为过期。

### 4.5 现有 pack：cosmic-plan（v0.1.0）

COSMIC 功能点估算的 Plan 阶段文档（从 cosmic-claude 迁移），`consumes: []`，双语 zh-CN/en-US。schema 定义 `functions[]`（funcId / l1-l3Name / funcDesc / estimatedCfps）+ totalCfps 等字段。规则 10 条：声明式 6 条（funcDesc ≥80 字 [error] / ≤2000 字 [warning]、funcId 格式正则、三级功能名禁用"管理/处理/系统/manage/process/system"等泛化词）；函数规则 4 条（funcId 唯一、层级路径唯一、单功能 CFP 建议区间 20-50 [warning]、CFP 总和 20-1000 且 totalCfps 等于求和）。

### 4.6 现有 pack：cosmic-req（v0.1.0）

COSMIC 需求分析文档（从 cosmic-claude Req 阶段迁移），per-function 粒度：`index` 定位上游 plan `functions` 数组的 1-based 位置，`funcId`/`desiredCfps`（=estimatedCfps）从对应 function 复制。`consumes: ["cosmic-plan"]`，双语 zh-CN/en-US。参数三个：`cfpsPerFunc`（业务规则配比分母，默认 30）、`functionalUserRoles`（功能用户角色白名单，逗号分隔 string，默认 6 个样例角色）、`funcDescMaxLength`（功能描述上限，默认 500；schema 硬顶 2000）。规则 8 条：声明式 5 条（funcDesc ≥10 [error] / ≤参数上限 [warning]、funcId 格式、role 格式 `^[a-z][a-z0-9-]*$`、业务规则描述 ≥10 [error]）；函数规则 3 条（**E301** role ∈ 部署白名单、**E302** 规则数 ∈ [ceil(cfps/perFunc), floor(ceil×1.5)]、**E303 泛化** index/funcId/desiredCfps 与上游 plan 三点对齐——全部 error 阻断，与原系统"审计意见只降分不阻断"不同，差异与理由见 docs/designs/function-rule-context.md）。

## 5. 插件 / pack 职责边界（总表）

| 关注点 | 插件实现 | pack 实现 |
|---|---|---|
| 文档结构 | — | `schema.json` |
| 合格标准 | 规则执行引擎（schema + 四族声明式 + 函数规则） | 规则本身（`rules/*.json`、`functions.js`） |
| 生成方式 | prompt 组装、素材/上游注入、模型调用 | `prompts/<lang>.md` |
| 闭环行为 | 迭代、预算、振荡检测、错误映射、终止语义 | — |
| Markdown 渲染 | Handlebars 编译与空渲染检查 | `templates/<lang>.hbs` |
| 多语言 | 语言解析链、按语言编译缓存 | 每语言的三件套资产 |
| 回执 | 生成、哈希、复验、staleness | 提供被快照的规则内容 |
| 链式消费 | 上游六项校验、版本策略 | `manifest.consumes` 声明 |
| 安全 | 路径包含、名称消毒、素材非空 | — |
| 配置 | Config schema 与全部默认值 | — |
| 领域概念（COSMIC、CFP） | **禁止进入插件** | 规则与 prompt 中自由使用 |
| 能力发现 | `doc_packs` 工具、三处静态邀请文案、manifest.description 加载期校验 | `description` 的一句话内容 |
| 参数旋钮 | 解析/校验/钳制、`{{params}}` 渲染、回执 as-run、复验按当时参数 | `manifest.params` 声明与默认值、`manifest.maxRounds` 领域默认 |

## 6. 质量门与验收基线

- Vitest；每文件 100% 行/函数/语句覆盖门。
- 变异测试（mutation tests）证明护栏非摆设：golden 样本按规则族故意损坏，checker 必须全抓住。
- 闭环行为用确定性策略测试：注入损坏 JSON + LLM seam 按脚本返回，断言循环与回执；真实模型端到端属 e2e（有 API key 才跑）。
- 预发布宿主冒烟（`scripts/host-smoke.ts`，`pnpm run smoke:host`）：npm tarball → 真实 dsh 宿主 boot → 三工具注册断言，无模型调用、无 API key。

## 7. 当前限制与路线（未实现，按优先级参考 TODOS.md）

- 真实 LLM 闭环已验证：多轮修复轨迹、内置权重对账（score = 100 − 10×error 精确吻合）、跨 dsh 版本回执复验均通过（数据见 docs/testing/e2e-real-llm.md）。停滞/阴跌阈值在 glm-5.3 级强模型下不可触达（模型优先 pack 规则），仍由确定性测试覆盖。
- 闭环每轮数据（含各轮 promptHash）进回执；回执整体作为 doc_generate 工具结果内容逐字进入 session log，审计流由该通道承载。独立 doc-gen-round session 事件类型延后：dsh 未提供插件事件类型写侧 `ignorable` 标记的入口，未经标记的未知类型会使会话在 stock 宿主下不可重载。
- 草稿续修（从红回执草稿断点继续修）工具、MCP 包装（宿主无关分发）、pack npm 分发、cosmic Req/Func/Tech 后续阶段 pack——均未启动。
- 同名产物的并发写入无跨文件锁（单文件原子，artifact/receipt 对可能交错，last-writer-wins）。
