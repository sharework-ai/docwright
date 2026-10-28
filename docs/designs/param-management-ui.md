# 参数维护界面（param-management-ui）

Status: PROPOSAL（设计提案待评审；实施时翻 IMPLEMENTED 并按现状改写）

参数体系的机制语义与对象模型见 `params-and-chain-contract.md`、`param-object-model.md`（四层级、属性全集、生命周期矩阵、不变量、写操作影响半径）；本文只管界面：**在 dsh web 里读参数、改参数**，而不是让用户去读文件。

## 问题

参数的修改面目前只有文件编辑：Config 在 cordis.yml，pack 参数在 manifest.json。用户要回答"现在生效的参数是什么"、"把确认档位改成 strict"只能读文件或重启。`param-object-model.md` §7 的盘点是出发点：读取面 `doc_packs` 已暴露参数元数据（缺 min/max/enum——差距 1），**运行时没有任何写 manifest/Config 的通道**——界面管理是全新写入面，不变量必须由界面侧同等强度地前置执行。

## 机制调研（dsh-market 实证，四件套）

dsh-market（~/projects/lab/dsh-market）是 dsh web 内嵌 UI 插件的完整先例，其机制可直接复用：

1. **客户端注入**：package.json 声明 `dsh.client: { platform: 'web', inject: [...] }` + `exports['./client']`；宿主 `ctx.clientModules` 扫描组合 boot 图，浏览器侧 `window.__ModuleLoader__.load({id, factory})` 加载。注入 `@deepseek-ai/dsh-client-ui-settings`（Settings 区块）、`ui-slots`（槽位注册：声明即授权，冲突加载期报错）、`ui-primitives`/`ui-theme`（控件与圆角/材质规范，见宿主 docs/ui-radius.md）、`dsh-client-locale`。
2. **服务端 HTTP 面**：cordis 插件经 `ctx.effect()` 在宿主 webServer 上挂**精确路由**（disposer 收线，进程内零常驻）。鉴权复用宿主 `connection.requestRejection`（Host/Origin 栅栏 + 浏览器登录）与 trusted-hosts 白名单；mutating 路由强制 same-origin + 有界 JSON body。**docwright 现在是纯工具插件，需要新增这个服务端 HTTP 面。**
3. **写配置的先例**：dsh-market 热开关写 profile 的 `cordis.patch.yml`（官方 patch 层）——HMR ~1s 重组、重启后保留、手改行显示 badge、坏 patch 不被弄得更坏。docwright Config 编辑走同一层（**不直接改 cordis.yml**），天然获得"界面改的"与"手改的"可区分性。
4. **产品原则**（dsh-market AGENTS.md 全文适用）：自然（从意图出发，不要求用户先懂 pack/manifest/patch 模型）、好理解（说人话、报错三件事：发生了什么/为什么/怎么办）、面向普通用户（默认值就是产品；常态安静罕见打扰；能撤销就别问；每个动作有即时反应和明确落点）。

## 范围（v1）

### 读面（新 RPC，顺带补差距 1）

`GET /api/docwright/params`（宿主栅栏之后，只读零副作用）：

- 每个 pack 的**全量**参数元数据：name/type/description/default/required/confirm/overridable/extractable/**min/max/enum**（doc_packs 的超集——界面编辑约束需要完整元数据）。
- 当前 Config 生效值，每键标注来源（cordis.yml 声明 / patch 层覆盖 / 内置默认）——来源决定界面呈现哪一层可改。
- 每个 pack 的抽取文件现状（`<pack>.extracted.json` 的逐参数 status/quote/ref）与最近绿色回执的 as-run params——出处层在界面上可见（"这个值从哪来"）。

### 写面（v1 两类，对应 §7 影响半径的两行）

1. **Config 编辑** → 写 `cordis.patch.yml` 的 docwright 段（provider/model/confirmPolicy/upstreamVersionPolicy/materialsRoot/outputRoot/maxIterations/maxRoundsCeiling/promptTokenBudget/…）。保存即 HMR 生效（~1s）；patch 行 badge 可一键还原（删行）。provider/model 影响后续 promptHash，界面上就地说明（不追溯已产物）。
2. **pack 参数 default 编辑** → 写 `manifest.json` 的 `params.<name>.default`。**结构只读**：增删参数、改 type、改 required/confirm/overridable/extractable 门属性不进 UI——结构性改动必须伴随版本升级（§7 不变量），属 pack 作者职责，界面呈现属性但指路"编辑 manifest 文件并升版"。改 default 不升版、不追溯已产物（旧回执照常复用，§1）。

### 不变量前置校验（写请求被拒绝，不是等下次加载炸）

保存 default 的请求在服务端复跑与解析层同一套校验（复用 `assertValueMatches`）：type/enum/min-max；manifest 保存前整体复跑装载期校验（含 `overridable ⇒ confirm`、`extractable ⇒ confirm`、bound-ref 禁 `overridable`、default 落 [min,max]）——写坏的 manifest 根本不落盘。界面视觉遵守 Mind the gap：object 参数的 `value`（生成目标）与 min/max（校验容差）分开呈现。

### 非目标（v1）

- 调用级参数不进界面（单次调用语义走对话 + 确认门；确认权属用户的本质优势不因此改变）。
- 派生参数（topicNo）不可配置，只读展示。
- 回执不可编辑（唯一通道是 doc_validate seal）。
- pack 结构编辑、多 pack 批量操作、导入导出——不做。
- extraction 文件不从界面写（抽取语义属于生成流程：引文必须对素材机检，界面上没有素材上下文）。

## 开放问题

1. **入口位置**：Settings 内一个 "Docwright" 区块（v1 建议）vs 独立侧边栏行（dsh-market 两者皆有、侧边栏可选）。多场景共存后再议侧边栏。
2. **default 编辑后是否顺手升版**：默认不（升版使全部旧回执失效，是 pack 作者的显式动作）；若用户改了 default 又想强制重生成，界面提示可用 force 生成或手动升版。
3. **profile 目录定位**：写 cordis.patch.yml 需要知道 profile 目录——dsh-market 经 profileContext/home-paths 解析；docwright 从宿主 ctx 能否直接拿到（待实施时查 host 服务，不行则复制 dsh-market 的解析逻辑）。
4. **客户端构建线**：dsh-market 用 rolldown 打 client.js；docwright 现为 tsdown Node 包。需补 client 构建（tsdown.client 配置 + `dsh.client` 字段 + `exports['./client']`），对齐宿主注入格式（`__ModuleLoader__.load`）。

## 实施切分

- **S1 服务端**：params 只读 RPC（全量元数据 + Config 来源标注 + 抽取/回执现状）；宿主栅栏接入；路由鉴权与 same-origin。
- **S2 客户端**：Settings "Docwright" 区块——packs 参数表（全属性，含 min/max/enum）+ Config 卡片（来源标注 + patch 行 badge/还原）。
- **S3 写通道**：Config patch 写 + default 编辑 + 服务端不变量复跑 + 错误三件事文案。
- **S4 验收**：headless browse 实测（改 confirmPolicy → HMR 生效；改 default → 下次生成生效；坏值被拒）；单测覆盖校验复跑与路由鉴权。
