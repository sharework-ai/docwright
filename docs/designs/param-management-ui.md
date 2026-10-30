# 参数维护界面（param-management-ui）

Status: IMPLEMENTED（v1 全量落地 2026-10-29：读面 RPC + 写通道 + dsh web 客户端三视图 + 真实宿主 browse 验收；实施修正见下）

参数体系的机制语义与对象模型见 `params-and-chain-contract.md`、`param-object-model.md`（四层级、属性全集、生命周期矩阵、不变量、写操作影响半径）；本文只管界面：**在 dsh web 里读参数、改参数**，而不是让用户去读文件。

## 问题

参数的修改面目前只有文件编辑：Config 在 cordis.yml，pack 参数在 manifest.json。用户要回答"现在生效的参数是什么"、"把确认档位改成 strict"只能读文件或重启。插件会装很多 pack（内置 6 个起步，packsDir 还会装第三方的），每个 pack 又有自己的参数——用户需要的是**区分插件参数与 pack 参数、把 pack 参数统一展现与维护**的地方。`param-object-model.md` §7 的盘点是出发点：读取面 `doc_packs` 已暴露参数元数据（缺 min/max/enum），**运行时没有任何写 manifest/Config 的通道**——界面管理是全新写入面，不变量必须由界面侧同等强度地前置执行。

## 机制调研（dsh-market 实证，四件套）

dsh-market（~/projects/lab/dsh-market）是 dsh web 内嵌 UI 插件的完整先例，其机制可直接复用：

1. **客户端注入**：package.json 声明 `dsh.client: { platform: 'web', inject: [...] }` + `exports['./client']`；宿主 `ctx.clientModules` 扫描组合 boot 图，浏览器侧 `window.__ModuleLoader__.load({id, factory})` 加载。注入 `@deepseek-ai/dsh-client-ui-settings`（Settings 区块）、`ui-slots`（槽位注册：声明即授权，冲突加载期报错）、`ui-primitives`/`ui-theme`（控件与圆角/材质规范，见宿主 docs/ui-radius.md）、`dsh-client-locale`。
2. **服务端 HTTP 面**：cordis 插件经 `ctx.effect()` 在宿主 webServer 上挂**精确路由**（disposer 收线，进程内零常驻）。鉴权复用宿主 `connection.requestRejection`（Host/Origin 栅栏 + 浏览器登录）与 trusted-hosts 白名单；mutating 路由强制 same-origin + 有界 JSON body。**docwright 现在是纯工具插件，需要新增这个服务端 HTTP 面。**
3. **写通道（调研后修订）**：宿主有原生 **`settings` 服务**（dsh-market `installMarketSettings` 实证）：服务端 `ctx.inject(['settings'])` → `settings.register(namespace, schema, { base })` 返回 scope（`.get()`/`.watch()`），宿主持久化并热生效；客户端 Plugins 页按 `settings.plugin.item` 槽位派发**插件自绘卡片**（"a plugin that ships a browser half owns its own card"），表单用宿主 `SettingsForm`/`settings*Field` 原语。**Config 编辑走这条宿主命名空间通道（替代原拟的 cordis.patch.yml 手写层）**——零文件写、watch 即时生效、与宿主配置页同构。引擎侧配一层 live 解析（cordis.yml < settings 命名空间 < 调用参数）。`cordis.patch.yml` 降级为 fallback 参考（宿主无 settings 服务时）。**pack manifest default 编辑无宿主通道**——仍走自定义 POST + 服务端不变量复跑。
4. **产品原则**（dsh-market AGENTS.md 全文适用）：自然（从意图出发，不要求用户先懂 pack/manifest/patch 模型）、好理解（说人话、报错三件事：发生了什么/为什么/怎么办）、面向普通用户（默认值就是产品；常态安静罕见打扰；能撤销就别问；每个动作有即时反应和明确落点；系统复杂度由系统吸收）。

## 参数纳入判据（什么才进维护界面）

界面维护的是**"声明的缺省行为"**——即有 `default` 的 ParamSpec 与 Config 键。会话中的值（显式传参/链继承/素材抽取）有自己的通道（确认门、抽取、回执），不进维护面：

| 参数类 | 例 | 判定 | 理由 |
|---|---|---|---|
| 插件 Config | confirmPolicy、maxIterations、provider/model | **编辑** | 部署级现役行为，维护界面的核心价值 |
| 声明且有 default | cfpPerFunc、cfpPerSubProc、topicNoPattern、funcDescMaxLength | **展现 + 编辑** | 有现役值可维护；改的是声明的缺省行为，影响后续生成、不追溯已产物 |
| 声明但无 default | cfpTotal、targetIndex | **不展现** | 界面上没有可维护的现役值：cfpTotal 的值来自素材抽取或对话确认（会话行为），targetIndex 是调用路由——都留给各自的通道 |
| 引擎派生 | topicNo | **不展现** | 不可配置，展现即噪音（同差距 4：语义无作用） |
| 调用级 / 回执 as-run | params 入参、receipt.params、*.receipt.json | **不展现** | 单次调用语义走对话 + 确认门；回执唯一写通道是 doc_validate seal——审计数据不进维护面 |

## manifest 信息充分性盘点

现有 ParamSpec（type/default/required/confirm/overridable/extractable/enum/min/max/description）**基本够统一展现**：类型、值域、枚举、门属性齐全；单位与人话语义由 description 承担（现有 pack 写得好）——不加结构化 unit/label 字段。

**一个真缺口：object 参数的内部形状无 schema**（`cfpPerFunc = {value, min, max}` 哪个是目标、哪个是容差，声明面不知道）。机制层其实已硬约定：prompt 投影只取 `value`（Mind the gap，`src/prompt.ts` generationParams）。解法**不给 ParamSpec 加 object schema**（声明负担大于收益），而是 UI 与 prompt 同一投影语义：**object 参数只编辑 `value`**（控件按 value 的现役类型推断：数值/文本），区间端点（min/max/downFactor/upFactor）只读展示。

**修正一处既有差距的解法**：`doc_packs` **不补** min/max/enum 暴露——那是规则层与界面层消费的元数据，模型不需要（暴露反而成 prompt 噪音）。界面走**专用 RPC 直出引擎内完整 ParamSpec**；param-object-model.md 差距 1 的关闭方式是"界面专用读面"，非"扩大模型面"。

## 统一展现（区分插件参数与 pack 参数）

三层结构，服务端把链图算完给界面（复杂度由系统吸收，UI 不猜）：

1. **插件参数区块（"Docwright 设置"）**：Config 键按用途分组——常用（confirmPolicy、defaultLanguage、maxIterations）、LLM 路由（provider/model）、路径（materialsRoot/outputRoot/workspaceRoot/packsDir，标注"部署级，慎改"）、高级（promptTokenBudget、oscillation.*，默认折叠）。每键标注来源（cordis.yml 声明 / patch 层覆盖 / 内置默认）。
2. **参数视图（默认视图，唯一编辑入口）**：跨 pack 同名声明**聚成一行**（cfp* 族在 plan/req/func/tech 四份声明 → 一行）。服务端按 consumes 反图确定性计算每参数的**生效源**：
   - **链头 default 是现役源**（下游解析时上游回执必有该键，自己的 default 轮不到）→ 编辑路由到链头 manifest，行内标注"改这里沿链生效"；
   - **下游同名 default 被遮蔽** → 显示"由链头 X 管理"，不给一个改了没反应的输入框（反馈与确定性）；
   - **无链关系的独立声明** → 各自可编辑；
   - 同名不同 spec 合法（机制不强制一致）→ 聚合行并列展示各 pack spec 差异，编辑前明确落在哪个 pack。
3. **pack 视图（切换）**：按 pack 平铺（pack 名/版本/description/参数表/paramDriftPolicy 等行为开关），供 pack 作者、排障与"配置某个 pack"的编辑视角使用。**编辑权跟生效源走，不跟视图走**：source 声明在两个视图都渲染编辑钮（写的是同一个 manifest 字段）；shadowed 声明一律只读且值以删除线弱化 + 明确标注"由 X 管理——此处声明不生效"——那值在链上永不生效（回执继承盖过它），原样展示会让它看起来像现役值。参数视图的组卡片把组级不变量只渲染一次（组头：参数名 + flags + 悬停说明；值行：生效源 pack + 人性化投影"目标 60（容差带 30–90）" + 编辑；组尾一句话列出其余声明 pack），shadowed 逐卡片重复的渲染（N 份相同文本 + 误导性死值）已废弃。改链头 default 不级联改写下游 manifest——下游声明是 pack 作者的独立事实（同名不同 spec 合法），解析层本就不读它。

### 控件映射（type → 控件）

| ParamSpec.type | 控件 | 约束呈现 |
|---|---|---|
| number | 数字输入框 | min/max 即时校验（越界红字 + 修复提示）；enum 声明时退化为下拉 |
| string | 单行文本输入框 | enum 声明时退化为下拉 |
| boolean | 开关（toggle） | — |
| enum（伴随上述类型） | 下拉选择 | 成员来自声明 |
| object | 按 `value` 现役类型选控件（数值→数字框、文本→文本框），端点只读 JSON 展示 | 编辑值过同一 spec 校验；Mind the gap 视觉区分：value 是"生成目标"，端点是"校验容差"（分组/注记区分，不做同名输入框） |

控件全部用注入的 `ui-primitives`，几何遵守宿主 ui-radius 规范（Settings 卡片 R20 材质、输入 R12）。

### 说明呈现（description）

每个参数的 `description` 是**装载期必填非空**字段（缺了 pack 加载即报错），是界面说明的唯一事实源——界面不另写文案。展示形态遵循渐进披露：**参数名 + 控件是行内主流程，参数名旁一枚 `?` 图标，悬停展示完整 description**（含关联规则引用如 "rule plan/cfp-avg-band"，原样展示）；说明文字不占行内版面。pack description 是 pack 作者内容，逐字展示、不做翻译（UI 框架文案才走 locale 双语）。

**Config 键的说明现状缺口**：说明只住在 `config.ts` 的 JSDoc（不进运行时），RPC 拿不到。补法与宿主惯例对齐（宿主 config-catalog 文档即从 Config schema 生成）：**给 Config schema 每键补描述**（文本取自现有 JSDoc，单一事实源随 schema 走），读面 RPC 直出——不在 UI 里硬编码文案。

## 范围（v1）

### 读面（新 RPC，零副作用）

`GET /api/docwright/params`（宿主栅栏之后）：

- 每个 pack 的**完整 ParamSpec**（含 min/max/enum，仅展现有 default 的参数）+ consumes 图 + 服务端算好的每参数生效源/遮蔽关系（聚合视图的数据源）。
- Config 生效值，每键标注来源（cordis.yml / patch 层 / 内置默认）。


### 写面（v1 两类）

1. **Config 编辑** → 写 `cordis.patch.yml` 的 docwright 段。保存即 HMR 生效（~1s）；patch 行 badge 可一键还原（删行）。provider/model 影响后续 promptHash，就地说明（不追溯已产物）。
2. **pack 参数 default 编辑** → 写 `manifest.json` 的 `params.<name>.default`，仅限判据表中"编辑"类（有 default、非派生、非寻址、生效源即该 pack）。**结构只读**：增删参数、改 type、改门属性不进 UI——结构性改动必须伴随版本升级，属 pack 作者职责，界面指路"编辑 manifest 文件并升版"。改 default 不升版、不追溯已产物（旧回执照常复用）。

### 不变量前置校验（写请求被拒绝，不是等下次加载炸）

保存 default 的请求在服务端复跑与解析层同一套校验（复用 `assertValueMatches`）：type/enum/min-max；manifest 保存前整体复跑装载期校验（含 `overridable ⇒ confirm`、`extractable ⇒ confirm`、bound-ref 禁 `overridable`、default 落 [min,max]）——写坏的 manifest 根本不落盘。

### 非目标（v1）

- 会话级参数不进界面（显式 params 走对话 + 确认门；确认权属用户的本质优势不因此改变）。
- 派生参数（topicNo）、寻址参数（targetIndex）不展现。
- 无 default 声明参数（cfpTotal、targetIndex）、派生 topicNo 不展现。
- 回执不可编辑（唯一通道是 doc_validate seal）。
- pack 结构编辑、多 pack 批量操作、导入导出——不做。
- extraction 文件不从界面写（引文必须对素材机检，界面上没有素材上下文）。
- `doc_packs` 保持模型面精简，不补 min/max/enum（差距 1 由界面专用 RPC 关闭）。

## 宿主契约（0.2.1-rc.2 实测确认）

本界面赖以工作的 dsh web 宿主契约，逐条实测验证过；实施新席位或升级宿主时以此为准。

### Boot 与加载

- **Loader id = 包名**：宿主按包名组合 boot 图，并从 bundle 文件头嗅探 `window.__ModuleLoader__.load({ id: "<包名>"`。client.js 的 loader id 必须精确等于 package.json `name`（构建脚本从 package.json 读取，不手写）；不符的症状是整个 client half 加载失败（"could not load <pkg>"），宿主照常运行。
- **客户端注入声明**：`package.json` 的 `dsh.client: { platform: 'web', inject: [...] }` + `exports['./client']`；`inject` 是 factory 到达顺序边（依赖包先物化）。外部模块只有 loader module table 里存在的才能 require（react / react-dom / `@deepseek-ai/dsh-client-ui-primitives` 为平台 seed）；require 表外模块 = 运行时必炸。
- **遏制模式**：宿主 client bootstrap 里一个插件 factory 抛错会拖垮整个 shell——apply() 必须 try/catch 包裹全部注册，失败代价是本插件本会话缺席，绝非应用白屏。

### 槽位席位

- **0.2.1 拒绝第三方 `settings.section` 注册**（ui-slots"声明即授权"：槽位必须已在注册方的声明表中，违者加载期抛 "slot is not declared"）。
- **第三方正席**：`settings.plugins.tab`（设置 → 内置插件 section 内的 tab，`id`/`order`/`label`）与 `plugins.bundle.config`（插件详情页配置卡片，`key` = 包名；`view: 'summary'` 时返回 null——列表行不渲染卡片）。
- **探测式注册**：席位一律经 `ctx.slots.inject(槽位名, () => register(...))`——inject 等待槽位存在，未声明该槽位的宿主永不运行注册（无版本号判断、无报错）。
- **宿主原语按 0.2.1 形状传参**：`Tooltip` 的 `label` 是纯字符串（直接作为文本渲染）——传 `{ content }` 对象即 React #31（object 不是合法 child），且宿主会把**整个 slot entry 拆除直到刷新**（"slot entry crashed"）。第三方包自带的原语类型声明可能来自旧版本（dsh-market 针对 0.1.0-rc.6），ambient 声明须对照当前宿主源码，不照抄。slot entry 崩溃的恢复手段是 Ctrl+R（宿主按 entry 拆除，不自动重挂）。

### HTTP 面

- **exact 路由越过宿主栅栏**：`webServer.register({ kind: 'exact' })` 精确匹配优先于宿主 `/api` 前缀栅栏——插件路由收不到宿主的 Host/Origin/登录检查，必须自接：每请求惰性读 `connection.requestRejection`。
- **栅栏调用契约**：`gate.call(connection, request)` 必须以服务为 `this`（宿主实现依赖之）；gate 抛错 = 未放行，fail-closed 403（dsh-market #603 同款）。`connection` 服务在宿主异步 init 后才存在，挂载时读不到属正常，惰性解析。
- **mutating 路由**：强制 same-origin（Origin 必须匹配 Host）+ 有界 JSON body；错误以 `{ error: "问题 + 原因 + 怎么办" }` 应答。

### 写通道

- **settings 表单服务只投影 volatile**：`ctx.settings.describe()` 经 `volatileForm` 过滤——只有 schema `.volatile()` 标注的字段进表单；且 volatile 字段的运行时值是 live 引用（`Volatile<T>`），采用即感染所有 config 读取。要 plain config 的 entry 级编辑，用 **`ctx.configEditor.edit(entry, change)`**：宿主文件锁下合并写入 profile patch（cordis.patch.yml）+ Loader 重组，插件以新 config 重挂载。
- **profile entry 定位**：`configEditor.entries()` 逐 entry 按 `options.name === 包名` 匹配。

### schemastery meta 形状（读面 RPC 的解析依据）

- 子节点在 `schema.dict`（object 型），`meta.description` / `meta.default` 承载描述与默认；union 的成员值在 **`node.list[].value`**——`toJSON()` 投影里的 `uid`/`refs` 是序列化伪装，运行时实体没有。
- `.description()` 进 meta 即宿主 config-catalog 文档的同一事实源；`.volatile()` 不用（见上）。

### 引擎侧

- **pack Map 原地热替换**：pack manifest default 编辑后重载全部 pack root，**原地清空重填同一个 Map 实例**（工具 deps 与 RPC payload 共享该实例）——下一次 doc_generate 即用新 spec，无需重启；进行中的调用持旧 Pack 对象，按其开始时的 spec 完成，一致性更好。
- **pack 写盘前置校验**：提议 manifest 必须先过与装载期同一套 `assertManifest`（导出自 pack-loader），坏 manifest 永不落盘；写盘原子（tmp+rename）；重载失败响错并指明回滚路径。

## 开放问题

1. **入口位置**：Settings 内一个 "Docwright" 区块（v1 建议）vs 独立侧边栏行。多场景共存后再议侧边栏。
2. **default 编辑后是否顺手升版**：默认不（升版使全部旧回执失效，是 pack 作者的显式动作）；若用户改了 default 又想强制重生成，界面提示可用 force 生成或手动升版。
3. ~~profile 目录定位~~ **已消解**：宿主 settings 通道不需要定位 patch 文件；pack manifest 写仍需 packsDir 定位（pack.dir 已在 Pack 对象上）。
4. **客户端构建线**：dsh-market 用 rolldown 打 client.js；docwright 现为 tsdown Node 包。需补 client 构建（tsdown.client 配置 + `dsh.client` 字段 + `exports['./client']`），对齐宿主注入格式（`__ModuleLoader__.load`）。

## 实施切分

- **S1 服务端**：params 只读 RPC（完整 ParamSpec + consumes 图 + 生效源计算 + Config 来源标注 + 抽取/回执现状）；宿主栅栏接入；路由鉴权与 same-origin。
- **S2 客户端**：Settings "Docwright" 区块——插件参数卡片（分组 + 来源标注 + patch badge）+ pack 参数聚合视图（生效源标注）+ pack 平铺视图；四类控件映射。
- **S3 写通道**：Config patch 写 + default 编辑 + 服务端不变量复跑 + 错误三件事文案。
- **S4 验收**：headless browse 实测（改 confirmPolicy → HMR 生效；改链头 default → 下次生成生效且下游行显示遮蔽；坏值被拒；控件四类型各过一遍）；单测覆盖生效源计算、校验复跑与路由鉴权。
