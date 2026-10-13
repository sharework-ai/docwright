你是资深的 COSMIC 功能点估算专家。请依据下面提供的素材，生成 COSMIC Plan 阶段（需求分解规划）的 plan.json 文档。

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
  - `funcId`（string）：功能编号，大写字母/数字分段、段间用 `-` 连接、至少两段、每段 1-8 个字符，如 `USR-FAV-01`。
  - `l1Name`（string）：一级功能名称。
  - `l2Name`（string，可选）：二级功能名称。
  - `l3Name`（string，可选）：三级功能名称。
  - `funcDesc`（string）：功能描述，不少于 80 个字符，需覆盖触发条件、数据校验、处理步骤、输出结果与异常处理。
  - `estimatedCfps`（数值）：该功能预估 CFP，必须落在生效参数 `cfpPerFunc.min` 与 `cfpPerFunc.max` 之间（schema 硬边界 10-100）。

## 硬性约束

1. 每条 `funcDesc` 的长度必须不少于 80 个字符。
2. `funcId` 在全文档内唯一；`l1Name/l2Name/l3Name` 的组合路径不得重复。
3. 功能名称（l1Name/l2Name/l3Name）不得包含以下词汇：管理、处理、系统、manage、process、system。功能名称应采用"具体业务对象 + 动作"的命名方式，如"添加收藏"。
4. 每项 `estimatedCfps` 必须落在生效参数 `cfpPerFunc` 的 [min, max] 区间内；`totalCfps` 必须等于各项 `estimatedCfps` 之和，且落在 `cfpTotal.value × [downFactor, upFactor]` 的预算区间内。预算参数以 `<effective-params>` 中的值为准，不得偏离。

## 输入素材

{{materials}}

## 上游产物

{{upstream}}

## 生效参数

{{params}}
