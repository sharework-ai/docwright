# 设计：pack 能力发现机制（capability discovery）

Status: IMPLEMENTED (2026-10-11)。
Date: 2026-10-11
关联: docs/designs/docwright-mvp.md（功能说明书）第 3.1 节、TODOS.md D1-discovery

## 问题

装一个新 pack（例如"预算分析报告"）后，agent 无从得知它的存在：

- `doc_generate` / `doc_validate` 的工具描述是写死的静态字符串，`pack` 参数只举了 cosmic-plan 一个例子；新 pack 对模型不可见。
- pack 本身没有自描述字段（manifest 只有 name/version/consumes/languages），即使想枚举也没有"这个 pack 生成什么文档"的一句话。
- 模型也不知道何时该用 doc_generate 而不是自己手写文档。
- 唯一发现路径是失败驱动：猜错 pack 名 → 报错列出可用 pack。安全网存在，但不该是主路径。

dsh 提供的模型可见通道（已核实）：工具 description（每轮可见，`core/tools/src/schema.ts:487`）、system prompt 分节（`ctx.systemPrompt.section`，order 接受任意 number，第三方插件可插）、调用期错误契约（已实现）。

## 目标 / 非目标

目标：装新 pack（重启会话后）模型能自主发现并正确调用；工具定义面不随 pack 集合变化。

非目标：会话内热加载 pack（维持决策 #9：apply 期加载，变更需重启）；pack 在线市场与分发（OQ4）；MCP 包装（OQ6）。

## 设计（拉式发现，已采纳）

核心思路：**工具描述只放一句静态邀请；pack 细节按需经发现工具查询**。动态的东西待在数据里（注册表），静态的东西待在代码里（文案）。

1. **manifest 增加 `description` 必填字段**：一句话说明该 pack 生成什么文档、面向什么场景，语言由 pack 作者自定、原样返回。加载期强制非空（misconfiguration fails loud）。对现有 pack 是破坏性契约变更，内置 cosmic-plan 同步补齐。
2. **新增 `doc_packs` 工具（零参数）**：返回已装载 pack 注册表 `[{ name, version, description, languages, consumes }]`。MVP 不含 schema 摘要/素材提示（上下文成本，留开放问题）。
3. **三处静态邀请文案**（祈使句，互相引用形成闭环）：
   - `doc_packs`："List installed document packs: name, description, supported languages, and consumed upstream types. Call this before doc_generate to pick the right pack."
   - `doc_generate` 描述加："**Call `doc_packs` first** to see which packs are installed, then pass its name as `pack`."
   - `doc_validate` 描述与 `pack` 参数描述同样指向 `doc_packs`。
4. **错误契约补强**：unknown pack 报错在现有"列出可用 pack"基础上加一句 "discover packs via doc_packs"。跳过发现的模型在这一步自愈。

## 风险与缓解

- 模型无视邀请直接调 doc_generate：三处祈使句 + 失败自愈路径（报错列 pack）。最坏情况多一轮往返，不死锁。
- pack description 质量参差：发现结果好坏取决于作者一句话写得清不清；加载期只强制非空，质量靠 pack 作者契约（README 指南补一条"description 写清文档类型与用途"）。

## 验收标准（草案）

1. `doc_packs` 返回全部已装载 pack（含 packsDir 自定义目录），字段齐全。
2. 缺 `description` 的 pack 加载期报错，错误信息含 pack 名与修复提示。
3. 两个既有工具的描述为静态文案，快照测试锁定（不随 pack 集合变化）。
4. unknown pack 报错含 doc_packs 提示与可用清单。
5. 新增 pack 后重启会话，模型可在无人工提示下经 doc_packs → doc_generate 完成生成（手动 e2e 验证）。

## 开放问题

1. doc_packs 是否携带 schema 顶层结构摘要或素材要求提示（帮助模型备料）——等真实使用反馈再定。（原问题 2 工具命名已实现期核对定案，注册无冲突，见决策记录。）

## 附录：已否决与延后（已定案，不再重开）

> 重新提议备选前先读否决原则；触及原则的变体视为已答。

### 已否决：推式动态描述（注册期把 pack 清单拼进工具描述）

- 否决原则：**pack 清单不得进入每轮必付的模型上下文**——工具描述每轮可见，动态枚举使其随 pack 数量线性膨胀，工具 schema、测试与契约也随 pack 集合漂移。
- 拉式发现与 skill 系统的渐进披露（progressive disclosure）同构：静态邀请每轮付费一次，pack 细节按需付费一次。

### 已否决：模型自报能力 / 按需注册工具

- 否决原则：**能力发现不得依赖宿主动态工具机制**——超出 dsh 插件契约。

### 延后（观察项，非否决）：system prompt 分节强调"写文档找我"

- 邀请已随工具描述每轮可见，暂不重复注入；若真实使用发现模型经常想不到调用，再补一段静态分节（order 取工具指引区，如 1610）。

## 决策记录

- 2026-10-11 用户提出拉式机制（"插件说：凡是要写文档都来看看我能做啥"），与推式方案对比后采纳拉式；双方一致点：pack 需要自描述字段、失败路径需自愈。
- 2026-10-11 实现期核对：`doc_packs` 命名与 dsh-tools 注册规范无冲突（工具名走常规注册路径）。
