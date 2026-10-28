# 参数对象模型 —— 界面管理的设计地基

参数体系的机制语义（门控细节、漂移策略、Mind the gap、topic 确认）以 `params-and-chain-contract.md` 为准；本文是它的对象模型补充：**参数的层级归属、属性全集、全生命周期行为矩阵、全量清单**，为"插件级 / pack 级参数的界面管理"产品设计提供事实基础。§1–§8 为现状描述，每条均有代码依据（`src/params.ts`、`src/config.ts`、`src/pack-loader.ts`、`src/tools.ts`、各 `packs/*/manifest.json`）；§9 为缓解差距的提案（设计阶段输入，非现状）。

## 1. 参数的四个层级

| 层级 | 拥有者 | 载体 | 作用范围 | 修改影响半径 |
|---|---|---|---|---|
| 插件 Config | 部署运维 | `cordis.yml` / 宿主配置 | 全部工具调用 | 即时生效；不触碰已生成产物与回执（`provider`/`model` 例外：进入 prompt，影响后续 `promptHash`） |
| pack manifest `params` | pack 作者 | `manifest.json`（随 `version` 门控） | 声明即白名单 + 默认值 + 门控/校验属性 | 改 default：影响后续生成，不追溯已产物；结构性增删应升 `version`，否则旧回执照常复用 |
| 调用参数 | 用户 · agent | `doc_generate` 的 `params` 入参 | 单次调用 | 受确认门与 `paramDriftPolicy` 约束；写进本次回执沿链继承 |
| 引擎派生 | 引擎（不可配置） | 运行时注入（`topicNo`） | 本调用 + 沿回执继承 | 只能改其来源（`topicNoPattern` 的声明值），不能关闭派生本身 |

## 2. ParamSpec 属性全集（pack 级声明）

| 属性 | 约束 | 语义 | 装载期校验（fail loud） |
|---|---|---|---|
| `type` | `number \| string \| boolean \| object` | 值类型；`object` 必须是平面对象（非数组） | 必填，四值枚举 |
| `description` | 非空字符串 | 唯一说明文案；`doc_packs` 与确认表逐字展示 | 必填 |
| `default` | 与 `type` 匹配 | 缺省值（现役值） | 非 required 时必须匹配 type；number 型须落在 [min,max]；enum 型必须是枚举成员 |
| `required` | boolean | 声明契约性（见下） | 仅 boolean |
| `confirm` | boolean | 立门属性：未经理确认不得以该值执行 | 仅 boolean |
| `overridable` | boolean | prompt 中渲染"素材内容可调整此参数"提示；**不放松任何校验** | 仅 boolean；**必须同时 `confirm: true`**（可调基线必过确认门）；被声明式规则数值边界引用（ParamRef）即报错（硬边界参数不可调） |
| `min` / `max` | number 型专用 | 值域闭区间 | min ≤ max，须为有限数；object/string 型声明即报错 |
| `enum` | 非 string/number 外禁用 | 取值白名单 | 非空数组、成员类型匹配、default 必须是成员 |

**`required` 的两种组合**（语义完全不同，界面必须区分呈现）：

- **纯 required**（无 `default`，如 `cfpTotal`、`targetIndex`）：值必须来自调用方显式传参或上游回执继承；两者皆无 → 响亮报错（`missing required pack param`），缺失项进确认表的 `missingRequired`。
- **required + default**（如 context 的 `topicNoPattern`）：链级必备契约参数——默认值即现役值，永远可解析、永不因自身缺值而立门；required 标记表达"该参数是链契约的一部分，不可缺位"。

**值校验三路统一**：显式值、上游回执继承值、声明 default 在解析时走同一个 `assertValueMatches`（type / enum / min-max 全查；回执值违规同样报错，错误文案标注 `(receipt-recorded)`）。未知参数名一律拒绝（白名单原则，错误列出可用名）。

**当前内置 pack 未使用 `overridable` 与 `enum`**——机制完整可用、场景暂未用。界面做属性编辑器时需支持，优先级可低。

## 3. 一次调用内的解析与确认

解析顺序（`resolveEffectiveParams`）：**显式覆盖 > 上游回执基（`paramsBase`，多上游按数组顺序浅合并、后者覆盖）> 声明 default > 纯 required 缺失报错 > 可选无 default 留空**。

门控判定（`params-and-chain-contract.md` 为准，此处只列触发条件）：显式非寻址改参、confirm 参数未经上游确认、topic 首次进入链（topic 行）；required 且非 confirm 的**寻址参数**（如 `targetIndex`）是调用路由，永不立门。档位 `none/standard/strict` 决定门立不立，过门（转呈用户）永远是调用方义务。

## 4. 生命周期矩阵（环节 × 参数类）

参数类（列）：

- **P1 普通带默认**：`moduleLevels`、`cfpPerSubProc`、`funcDescMaxLength`、`functionalUserRoles`（装载期不变量下 P1 永不 `overridable`——可调属性必带 `confirm`，即属 P4）
- **P2 纯 required**：`cfpTotal`（plan）、`targetIndex`（req/func/tech）
- **P3 required+default 链契约**：`topicNoPattern`（context）
- **P4 confirm 预算组**：`cfpPerFunc` / `cfpMin` / `cfpMax`（各 pack confirm）、下游 `cfpTotal` 声明（confirm 无 default）
- **P5 引擎派生**：`topicNo`
- **P6 寻址参数**：`targetIndex`（= P2 的子集，required 且非 confirm）

| 环节 | P1 普通带默认 | P2 纯 required | P3 链契约 | P4 confirm | P5 派生 | P6 寻址 |
|---|---|---|---|---|---|---|
| 装载期校验 | default 匹配 type/值域 | 结构校验 | 同 P1 | 同 P1 | 无声明要求（下游 pack 需声明以接纳继承值） | 同 P2 |
| 值解析 | default 兜底 | 显式或继承，缺失报错 | default 即现役值 | 同 P2（下游 cfpTotal 靠继承） | 引擎从 topic 名提取注入（仅 topic 级 pack；显式与继承值优先） | 同 P2 |
| prompt 注入 | 全量进 `<effective-params>`；object 型只投影 `value` | 同左 | 同左 | 同左（端点 min/max 不进 prompt——Mind the gap） | 同左（被动出现，context 无消费语义） | 同左 |
| 门控确认 | 不立门 | 缺失进 `missingRequired`；显式传值即立门 | 不自立门 | 未经理确认即立门；上游记录后豁免 | topic 首次进链时随 topic 行立门 | **永不立门** |
| 规则校验消费 | 值域/带校验的容差来源 | 预算对账基准 | 编号规则的提取约定 | 带端点校验（issue 文案携带端点） | funcId 编号规则、产物命名 | 三点锚定（index/funcId 对齐） |
| 回执记录 | 全量 effective 进 `receipt.params` | 同左 | 同左 | 同左（记录即下游"已确认"凭据） | 同左 | 同左 |
| 链继承 | 经 `paramsBase` 覆盖同名 default | 继承即免报错 | 继承的 pattern 供下游推导 | 继承即豁免下游门 | 继承值优先于重新推导 | 继承不豁免寻址（每次仍必填） |
| 复用预检 | 显式改值 → 跳过复用 | 同左 | 同左 | 同左 | （派生值随 topic 定，等价寻址） | **不跳过复用** |
| 漂移处理 | `paramDriftPolicy`（regenerate 拒绝 / revalidate 确定性重验上游） | 同左 | 同左 | 同左 | — | 不参与漂移判定 |
| seal 重验 | 按回执 params 重放；显式 params 覆盖用于 what-if | 同左 | 同左 | 同左 | 同左 | 同左 |

## 5. 内置 pack 全量参数清单

**cosmic-context v0.2.0**（workspace / reuse / 无上游）

| 参数 | type | default | required | confirm | 说明 |
|---|---|---|---|---|---|
| topicNoPattern | string | `^([A-Za-z][A-Za-z0-9]*[-_ ]?[0-9]+)` | ✓ | — | 链契约（P3）：从 topic 名提取编号，沿链继承 |
| moduleLevels | number | 2 (1–3) | — | — | 模块树深度，产物规则校验，与 plan 共享 |

**cosmic-plan v0.6.0**（topic / reuse / consumes context / `materialsRoot: input`）

| 参数 | type | default | required | confirm | 说明 |
|---|---|---|---|---|---|
| cfpTotal | object | — | ✓ | ✓ | 总预算 {value, downFactor, upFactor}；用户给定，门控常客 |
| cfpPerFunc | object | {value:30, min:15, max:45} | — | ✓ | 单功能均值目标（value 进 prompt，端点校验） |
| cfpMin / cfpMax | object | {10,5–20} / {70,40–100} | — | ✓ | 单功能下/上限 |
| cfpPerSubProc | number | 2.5 (1–10) | — | — | 数据移动均值，向下游传递 |
| moduleLevels | number | 2 (1–3) | — | — | 与 context 共享（继承） |
| topicNoPattern / topicNo | string | 同 context / — | — | — | 继承 + 派生（P3/P5） |

**cosmic-req v0.6.0 / cosmic-func v0.5.0 / cosmic-tech v0.5.0**（topic / reuse / 逐上游链式）

共同参数：`cfpTotal`（confirm，继承）、`cfpPerFunc`/`cfpMin`/`cfpMax`（confirm，继承）、`cfpPerSubProc`、`topicNoPattern`/`topicNo`、`targetIndex`（**number，required，min 1——寻址参数**）。req 专属：`functionalUserRoles`（string 逗号清单）、`funcDescMaxLength`（number 100–2000，default 500）、`cfpsPerRule`（number 10–100，default 30）。

**cosmic-context-sync v0.1.0**（workspace / 不复用）：仅 `moduleLevels`。

## 6. 插件 Config 全量清单

| 键 | 默认 | 作用 |
|---|---|---|
| provider / model | —（首次生成前必填） | LLM 路由；进 prompt（影响 promptHash） |
| confirmPolicy | `standard` | 门控档位，调用可逐次覆盖 |
| upstreamVersionPolicy | `strict` | 上游版本错配：strict 拒绝 / warn 放行并附警告 |
| materialsRoot / outputRoot | `references` / `output` | 素材/产物根目录（pack 可用 `materialsRoot` 覆盖，如 plan=input） |
| workspaceRoot | cwd | 无会话工作区时的根 |
| packsDir | — | 额外 pack 目录（同名覆盖内置） |
| defaultLanguage | 首个 pack 首语言 | 输出语言缺省 |
| maxIterations / maxRoundsCeiling | 5 / 10 | 修复轮数上限 / 硬顶（tool arg > pack default > config，clamp 到 ceiling） |
| promptTokenBudget | 60000 | 单轮 prompt 预算，超限响亮报错 |
| oscillation.{mode,stagnantRounds,decliningRounds,maxRepeats,epsilon,defaultScore} | auto/3/3/3/0/{10,3,1} | 收敛终止调参（green 恒为 0 错误，终止只提前退出） |

## 7. 面向界面管理的客观事实（设计输入，非设计）

**读取面现状**：`doc_packs` 暴露每参数 `{name, type, description, default?, required, confirm, overridable}`——**不含 `min`/`max`/`enum`**；`receipt.params` 提供每次调用的 as-run 值（含派生 topicNo）。界面若要编辑约束（min/max/enum）需先扩展暴露面。

**修改影响半径**（界面每类写操作对应的事实）：

| 写操作 | 生效 | 追溯 |
|---|---|---|
| 改 Config | 立即、全局 | 不动已产物；provider/model 影响后续 promptHash |
| 改 manifest default | 下次生成起 | 已产物不变；不升版本则旧回执照常复用 |
| 改 manifest 结构（增删参数/改 type/门属性） | 下次生成起 | **应升 packVersion**——版本门使旧回执不可复用，强制按新契约重生成 |
| 调用级传值 | 单次 | 沿回执继承；受漂移策略约束 |
| 改回执 | **没有这个操作**——回执只能经 `doc_validate` 绿色 seal 重签（内容改变 hash 才重签），参数记录不单独可改 |

**界面必须遵守的不变量**：白名单（不能创建未声明参数的值）；值校验三路统一（界面上改 default 也要过 min-max/enum 校验）；Mind the gap（object 参数只有 `value` 是生成目标，端点是校验容差——界面上两者必须视觉区分）；`overridable ⇒ confirm`（可调基线必过门，装载期不变量，界面同受约束；被规则边界引用的参数不可 `overridable`）；纯 required 缺值只能问人；确认权属于用户（agent 转呈受"不得自答"约束，**界面由本人操作，天然满足**——这是 UI 相对 agent 通道的本质优势）；结构性 manifest 改动必须伴随版本升级。

**现状没有任何运行时写 manifest / Config 的工具**——一切修改走文件编辑 + 部署。界面管理是全新的写入面，上述不变量目前全部由装载期/调用期校验兜底，界面侧需要同等强度的前置校验（或复用同一校验函数）。

## 8. 已知差距（设计阶段输入）

1. `doc_packs` 不暴露 min/max/enum——参数编辑器缺约束元数据。
2. 参数无分组/场景标签——跨 pack 共享参数（moduleLevels、cfp* 族）在 UI 上按 pack 平铺会重复呈现（关联 scenario-chains PROPOSAL 的 `scenario` 标签）。
3. 同链重复调用 plan 会重立 cfpTotal 门（显式 params 每次都门控）——"会话内已确认记忆"是潜在 UI 便利点，当前契约无此状态。
4. 派生参数 topicNo 不可关闭，且会被动出现在 prompt 的参数块中（语义无作用，噪音可忽略）。
5. 确认表的 `source` 枚举（explicit/upstream/default/unset）不含出处维度——"素材明示的显式值"与"模型断言的显式值"同表同权，机制层无法回答"这个值从哪来"。实测一例：同一会话中，素材明文给出 `cfpTotal=70`（req.md："the expected CFPs is 70"）与素材无预算、模型自创 `cfpTotal=40`（另一 topic），在确认表中均为 `explicit`，无任何区分（`previewParams` 的 source 判定只有四档，`params` 入参是无出处的平面对象）。
6. `overridable` 的许可只进内层生成/修复 prompt（一句话提示），内层模型对参数的"调整"只物化在产物内容里——回执 `params` 与规则数值边界仍用调用级解析值，"声称的值"与"产物体现的值"可静默分叉（无门、无记录）。且被规则用作数值边界的参数一旦被调整，必然撞规则进修复循环。

## 9. 缓解提案（设计阶段输入，非现状）

两条提案分别收窄差距 5（外层显式值无出处）与差距 6（内层调整不可见）。均为机制变更方向，采纳前需按 `params-and-chain-contract.md` 的契约评审并同步其条文。

### 提案 A：素材参数抽取步骤（extract-params）——显式值必须有出处

**结论**：在链头生成之前增加一个独立的抽取步骤：按 pack 声明的抽取 schema 从素材中提取参数值，每个抽取值必须携带可机检的素材引文；素材中没有明示的值一律输出"未找到"，禁止自创与假设。"未找到"是一等结果而非错误——required 参数未找到时由前置检查在花费生成成本之前拦截，回归"纯 required 缺值只能问人"的不变量，而不是被模型代答。

**理由**：

- 现状下"读素材 → 提值 → 写进工具入参"是模型的一次不可见推理，确认表只能看到结果。独立成步后，抽取产物是一个可落盘的 workspace JSON（值 + 逐字引文 + 位置），可被回执引用、可从日志重建，与"模型可见 ⟺ 日志可重建"同构。
- "不得自创和假设"不能只靠 prompt 承诺，必须可机检：引擎校验引文逐字出现在素材文本中（quote ⊆ material），无引文即视为未找到。对"素材暗示但未明示"的值宁可报未找到，不可代人以推断；哪些参数可抽取由 pack 作者在 manifest 中逐参数声明。
- 解析序加一档：显式 > 上游回执 > **抽取值** > 声明 default；确认表 `source` 增加对应档位并新增引文列。门控不新增门种：confirm 参数照旧链头立门，抽取值在表中以引文自证。
- 链路位置：抽取发生在链头（plan 之前）、扇出之前，一次抽取保护整条链；形态上宜作为独立工具/链头步骤（契合"Plugins, not loop changes"），按（素材 hash × 抽取 schema）可缓存。
- 场景价值（COSMIC 链）：素材写了 "expected CFPs is 70" → 抽取出 70 并带引文；素材没写 → 报未找到，plan 前置检查拦截，请用户给出或明确认可模型建议值——用户无意漏掉重要信息不再被无声假定。

**代价与边界**：链头多一次 LLM 调用；manifest 增加抽取声明面；只治外层显式值的出处，不覆盖差距 6 的内层调整；重生成时抽取值变化是否计入 drift，待契约评审定。

### 提案 B：`overridable ⇒ confirm` 装载期不变量——可调参数的基线必须过人

**结论**：装载期校验增加一条组合约束：声明 `overridable: true` 的参数必须同时 `confirm: true`，违者 fail loud。`confirmPolicy: none` 的调用（headless/CI）除外——该档位从不起门，此不变量在无人通道上不提供保证。

**理由**：

- 门控现状是"confirm 参数未经上游确认即立门"：链头首调必门（无论值来自 default 还是显式传参），记录后沿链继承豁免。因此该不变量保证：任何可被内层调整的参数，其基线值至少一次呈现在用户面前并被确认——"采用的值不是声称的值"从完全不可见收敛为仅剩内层偏移量不可见。
- 配套原则（由"不放松任何校验"推出）：被规则引擎用作数值边界的参数（`resolveBound` 消费，如 `moduleLevels` 类）**不得**声明 `overridable`——内层对该类参数的调整必然撞规则进修复循环，许可与校验自相扭结。`overridable` 只对"生成目标型"参数（值是软目标而非硬边界，如角色清单、均值目标）有意义。
- 若采纳，需同步修订 §2 的装载期校验列、§4 的 P1/P4 分界与 §7 的不变量清单（一处修订，三处引用）。

**残留缺口（提案 B 不解决，列为开放方向）**：内层偏移发生在门后、生成中，回执与产物均不记录 as-run 值。完全闭合需让产物 JSON 或回执携带"实际生成所用值"，由引擎对照 effective 值记差——涉及 schema 与回执契约变更，另行设计。

### 三条值来源路径的收束

| 路径 | 现状 | 提案后 |
|---|---|---|
| 外层显式传参（模型写入工具入参） | source=explicit，出处不可见 | 提案 A：有引文出处，未找到即拦截 |
| 回执链继承 | source=upstream，链上有据 | 不变 |
| 内层生成调整 | 不可见、不可审计 | 提案 B：基线过门；as-run 值记录为开放方向 |
