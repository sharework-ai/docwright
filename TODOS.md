# TODOS — docwright

Source: functional spec at docs/designs/docwright-mvp.md. 本文件记录真正待办与已完成的压缩账目（一个事实一个家；实施细节见 git 与 Implementation tracker）。

## Open

- [ ] **E2E-real-llm** — 真实 LLM 闭环端到端。**已观测（2026-10-12）**：多轮修复路径实证（60→100 轨迹，权重 10/error 精确对账，两轮 promptHash 各异，跨 dsh 版本回执复验 hashMatches=true）；但 glm-5.3-flash 下三种违规素材均一轮全绿（模型把 pack 规则置于素材之上，护栏按设计工作），stagnation/decline 阈值（K=D=3）在真实 LLM 下不可触达，仍由确定性单测覆盖（runbook Calibration 节）。**剩余**：换更弱模型或"规则无法满足"的 pack 观测真实停滞——价值有限，可长期挂起（原脚本已被 tmp 清理，按此描述重写）

## Deferred

- **dsh 上游：插件事件类型写侧 `ignorable` 旋钮** — `Session.append` 无法给 log-only 事件打 `ignorable: true`，插件自定义事件类型会使会话在 stock 宿主下不可重载（读侧已容忍，写侧缺口；依据 dsh 架构决策 2026-08-30）。补上后可再评估独立 `doc-gen/round` 专项事件（当前审计流由回执 promptHash + 工具结果 content 承载，见 Done T2-core）
- receipts CI badge、社区基础设施（issue 模板等）— 等第一个真实用户
- pack npm 分发机制（设计 OQ4）、MCP 包装（OQ6，宿主无关分发）
- 草稿续修（resume from draft）工具 — DX-M4：红回执草稿从断点继续修
- prompt 注入 nonce 定界符 + Markdown 表格转义 — 信任模型已文档化，等真实用户反馈
- 同名产物并发写入锁 — writeAtomic 已保证单文件原子，需要时加 per-artifactName 串行化

## Done（压缩账目）

- **2026-10-12 rename-docwright**：产品定名 docwright（wright = 工匠，playwright 词形；write/right 双关 = 生成 + 校验）。plugin name / Config id / 类型名 DocwrightConfig / 错误消息前缀 / 环境变量 DOCWRIGHT_* / README / 说明书全文替换，设计文档改名 docwright-mvp.md；npm 包名定 @sharework-ai/dsh-docwright（cordis.patch.yml 的 name 值以 @ 开头须加 YAML 引号——冒烟实测抓出，裸值解析即炸）；GitHub 仓库 sharework-ai/docwright。253 tests + typecheck + build + 冒烟 PASS，分支 feat/rename-docwright。
- **2026-10-12 cosmic-func/tech packs**：COSMIC 四阶段链补全（plan→req→func→tech，每跳三点锚定 index/funcId/desiredCfps）。cosmic-func：7 规则（3 声明式 + 4 函数，E001/E002/A001/W001 迁移）；cosmic-tech：13 规则（1 声明式 + 11 函数，tech_auditor 全家族迁移）。引擎零改动——嵌套作用域（subProcesses）规则由函数规则整产物视角覆盖。迁移决策：severity 映射 ERROR→error/WARNING→warning/ADVICE→info；FunctionRule 单 severity 契约迫使两处分拆（movement-count/movement-split-advice、cfp-total-vs-budget/cfp-budget-advice）；cfpMinRatio/cfpMaxRatio 参数化预算错误边界；golden 双语零 issue（9 过程 × 4 移动 = 36 CFP，落在 [35,42] 干净带）。schema 偏差：metadata/revised 删除（无人工编辑 UX）。253 tests 全绿 + 覆盖门 + typecheck + build + 冒烟 PASS。
- **2026-10-12 cosmic-req pack**：第二个 pack 落地（per-function 粒度，consumes cosmic-plan；3 参数 5 声明式 3 函数规则，E301/E302/E303 全 error 阻断）。核心扩展：函数规则 `check(artifact, context?)` 注入 upstream/materials/params（链式跨产物校验的引擎缺口），doc_validate 增可选 upstream 参数（链式复验 + 锚点入回执）；顺带修复根作用域 pattern 规则不编译正则的引擎缺陷。218 tests 全绿 + 覆盖门 + typecheck + 冒烟；真实 LLM 链式闭环验证（plan→req，upstreamHashes 锚定，三点对齐精确）。设计 docs/designs/function-rule-context.md。
- **2026-10-12 host-smoke**：`scripts/host-smoke.ts`（`pnpm run smoke:host`）——pack tarball → 沙箱 DSH_HOME 新 profile → `dsh plugin add`（base+docwright 组合，无需 headless/模型/key）→ `runProfile` 进程内 boot → 断言三工具注册。要点：`--profile` 须在 `plugin` 之后；跨仓跑 dsh 源码需重生进程设 `TSX_TSCONFIG_PATH` 指 dsh tsconfig（vendored lib 可滞后）；runbook 步骤 2 已同步修正。
- **2026-10-12 T2-core**：每轮 promptHash 进回执 rounds（sha256 该轮实际发送 prompt，llm-error 轮同样记录）——回执整体作为 doc_generate 工具结果 content 逐字进 session log，审计流由既有通道承载，未引自定义事件类型（dsh 写侧缺口见 Deferred）。200 tests 全绿 + 覆盖门 + typecheck，分支 feat/t2-round-audit。
- **2026-10-11 D1-D3**：能力发现（doc_packs + manifest.description）/ 收敛检测三层（pack 评分百分制 > 内置严重度评分 > 指纹兜底，终止 reason 进回执）/ 参数最小桥（params/maxRounds + 声明白名单 + maxRoundsCeiling 硬钳制 + as-run 复验）。设计 docs/designs/*（均已 IMPLEMENTED），提交 8fcbd4d / 3ad941c / de7bcde，明细见下方 tracker。
- **2026-08-27/28 Sprint 3-5**：闭环核心（llm-error 映射+单次重试 / 振荡终止 / token 预检 / 路径包含 / 回执 language+规则集快照 / 6 项 GAP 测试 / 引擎 bake-off 微型引擎胜出）；DX 面（确定性 quickstart / 工具返回 shape / Config 键名与合并语义 / version+formatVersion / 全绿语义+错误契约）；Sprint 4 /review 链式绿回执+防篡改+staleness 等 44+3 项；Sprint 5 分发层 3 缺陷修复（bundle patch / tarball / types）+ 宿主冒烟 10/10。

## Implementation tracker（D1 → D2 → D3 全部完成 2026-10-11；后续实施从这里续）

实施约定：每个 D 独立分支 `feat/d<N>-<slug>`；完成 = 测试全绿 + 覆盖门 100% + 功能说明书（current-state）与本文同步 + 设计文档 Status 翻 IMPLEMENTED + `--no-ff` 合并 master + push。commit 前缀 `[feat]`。基线：2026-10-11 master 141 tests 全绿（D3 完成后 198；T2-core 后 200）。

### D1-discovery — DONE (2026-10-11, feat/d1-discovery)
- [x] 1. `src/pack.ts`：PackManifest 增必填 `description`
- [x] 2. `src/pack-loader.ts`：assertManifest 校验 description 非空（fail loud，错误含修复提示）
- [x] 3. `packs/cosmic-plan/manifest.json`：补 description
- [x] 4. `src/tools.ts`：新增 `doc_packs` 工具（零参数，返回 name/version/description/languages/consumes）；doc_generate/doc_validate 描述与 pack 参数描述加静态邀请；resolvePack 错误信息加 "discover packs via doc_packs"
- [x] 5. `src/index.ts`：注册 doc_packs
- [x] 6. 测试：manifest 缺 description 报错；doc_packs 列表/渲染；既有 manifest 夹具补字段；未知 pack 错误含提示（144 tests 全绿，覆盖门 100 行/函/语句 + 89% 分支，typecheck 过）
- [x] 7. 同步：README（Tools/pack 契约）、功能说明书（3.0 doc_packs + 4.1 + 边界表）、本文件勾选、设计文档 Status→IMPLEMENTED

### D2-convergence — DONE (2026-10-11, feat/d2-convergence)
- [x] `src/convergence.ts`（新）：createScoring 策略矩阵（auto/score/fingerprint）+ defaultScore（clamp 0-100）+ wrapScore（崩溃/越界 fail loud）
- [x] `src/loop.ts`：终止逻辑重写——best-so-far 停滞 K、严格阴跌 D、指纹兜底 maxRepeats=3；LoopExhausted 增 reason（stagnation/decline/fingerprint-repeat/max-iterations/llm-error）；rounds/events 增 score
- [x] `src/pack.ts` + `src/pack-loader.ts`：ScoreFn 类型 + functions.js 可选 `score` 导出（非函数加载期报错）
- [x] `src/config.ts`：OscillationConfig + schema（mode/stagnantRounds/decliningRounds/maxRepeats/epsilon/defaultScore，含默认值）
- [x] `src/receipt.ts`：ReceiptRound.score + Receipt.terminationReason（红回执专属）
- [x] `src/doc-service.ts`：createScoring 接线 + reason 写入回执
- [x] 测试：convergence.spec（策略矩阵/默认评分/fail loud/loader score/回执集成）+ loop.spec 4 个 score 模式用例 + 旧振荡断言更新为 N=3（162 tests 全绿，覆盖门 100 行/函/语句 + 90% 分支，typecheck 过）
- [x] 同步：功能说明书 3.2/3.3/3.7/4.3、README config/契约、设计文档 Status→IMPLEMENTED

### D3-params — DONE (2026-10-11, feat/d3-params)
- [x] `src/pack.ts`：ParamRef/isParamRef/ParamSpec 类型；DeclarativeRule 数值边界可引用参数；manifest 增 maxRounds?/params?
- [x] `src/pack-loader.ts`：assertParamSpec（type/default/description/enum/min/max 全量校验）+ maxRounds 正整数校验 + 规则参数引用校验（未声明/非数字 fail loud）
- [x] `src/params.ts`（新）：resolveEffectiveParams（默认→base（回执 as-run）→调用覆盖；未知名称/违规值 fail loud 带可用清单）
- [x] `src/rule-engine.ts`：数值边界按调用解析参数引用（防御性缺失 fail loud）
- [x] `src/prompt.ts`：{{params}} 槽位渲染 `<effective-params>`
- [x] `src/loop.ts`：LoopOptions.params 透传（修复预算预检 prompt 与实际 prompt 分叉的 bug）
- [x] `src/doc-service.ts`：轮数链 clamp(arg ?? pack ?? config, maxRoundsCeiling) + params 贯通 + 回执 as-run params
- [x] `src/tools.ts`：doc_generate 增 maxRounds/params（json 参数 + normalizeParams）；doc_validate 增 params（默认按回执复验）；doc_packs 列出参数旋钮
- [x] `src/config.ts`：maxRoundsCeiling（默认 10）
- [x] 测试：params.spec 35 例（解析矩阵/14 种声明违规/loader 引用校验/引擎边界/prompt 渲染/轮数链与 ceiling/回执 as-run 复验/doc_packs 列表）（198 tests 全绿，覆盖门 100 行/函/语句 + 91.7% 分支，typecheck 过）
- [x] 同步：功能说明书 3.1/3.2/3.3/3.4/3.7/4.1/4.2/5、README 全节、设计文档 Status→IMPLEMENTED
