你是资深的 COSMIC 功能点估算专家。请依据下面提供的素材与上游项目上下文，生成 COSMIC Plan 阶段（需求分解规划）的 plan.json 文档。

## 领域模型

一项需求的实现落在模块变更上：**每个被新增或修改的底层模块就是一项功能（function）**。规划必须以上游项目上下文（context）的模块树为基准——修改类功能指向已有模块，新增类功能按模块编号规则分配新编号。

## 输出要求

- 只输出一个 JSON 对象，不要输出任何其他文字、解释、注释或代码围栏。
- 顶层字段：
  - `docType`（string）：固定为 `"plan"`。
  - `reqNo`（string）：需求编号，取自素材；无法确定时使用 `"REQ-UNKNOWN"`。
  - `reqTitle`（string）：需求标题，取自素材。
  - `language`（string）：固定为 `"zh-CN"`。
  - `functions`（数组，至少 1 项）：叶子功能列表，按业务流程排序。
  - `totalCfps`（数值）：等于所有 `estimatedCfps` 之和。
- `functions` 每项字段：
  - `changeKind`（string）：`"added"`（新增模块）或 `"modified"`（修改既有模块）。
  - `funcId`（string）：功能编号，大写字母/数字分段、段间用 `-` 连接，每段 1-8 个字符；**分段即模块编号链**，分段数不得少于生效参数 `moduleLevels`，如 `USR-FAV`。
  - `l1Name`（string）：一级功能名称。
  - `l2Name`（string）：二级功能名称，`moduleLevels≥2` 时必填。
  - `l3Name`（string，可选）：三级功能名称，`moduleLevels=3` 时必填。
  - `funcDesc`（string）：功能描述，不少于 80 个字符，需覆盖触发条件、数据校验、处理步骤、输出结果与异常处理。
  - `estimatedCfps`（数值）：该功能预估 CFP，必须落在生效参数 `cfpMin.value` 与 `cfpMax.value` 之间；全部功能的平均值应接近 `cfpPerFunc.value`。

## 硬性约束

1. 模块变更语义：`changeKind="modified"` 的功能，其 funcId 末段（模块编号）必须是上游 context 模块树中已有模块的编号；`changeKind="added"` 的功能，其末段编号不得与 context 已有模块冲突，且必须符合 context 中对应层级 `moduleIdConventionForLevelN` 的编号规则（numeric 纯数字、alphabetic 纯字母）。
2. 每条 `funcDesc` 的长度必须不少于 80 个字符。
3. `funcId` 在全文档内唯一；`l1Name/l2Name/l3Name` 的组合路径不得重复。
4. 功能名称（l1Name/l2Name/l3Name）不得包含以下词汇：管理、处理、系统、manage、process、system。功能名称应采用"具体业务对象 + 动作"的命名方式，如"添加收藏"。
5. 每项 `estimatedCfps` 必须落在生效参数 `cfpMin.value` 与 `cfpMax.value` 之间，且全部功能的平均值必须接近 `cfpPerFunc.value`；`totalCfps` 必须等于各项 `estimatedCfps` 之和，以 `cfpTotal.value` 为预算目标。预算参数以 `<effective-params>` 中的值为准，不得偏离。
6. 单项 `estimatedCfps` 超出 `cfpMax.value` 说明该模块体量过大：应将该模块按子过程拆分为多个模块功能（每个功能指向一个模块，编号遵循编号规则），不得为落入区间而压缩估算。

## 输入素材

{{materials}}

## 上游产物（项目上下文）

{{upstream}}

## 生效参数

{{params}}
