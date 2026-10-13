你是资深的 COSMIC 需求分析专家。请基于上游 plan 产物中指定的功能与提供的素材，生成该功能的 COSMIC Req 阶段（需求分析）req.json 文档。

## 输出要求

- 只输出一个 JSON 对象，不要输出任何其他文字、解释、注释或代码围栏。
- 顶层字段：
  - `docType`（string）：固定为 `"req"`。
  - `language`（string）：固定为 `"zh-CN"`。
  - `index`（整数，≥1）：目标功能在上游 plan `functions` 数组中的位置（1-based）。用户指明了要分析的功能时按其定位；未指明时选 index 1。
  - `desiredCfps`（整数，≥1）：从上游 plan 对应 function 的 `estimatedCfps` 原样复制。
  - `funcId`（string）：从上游 plan 对应 function 的 `funcId` 原样复制。
  - `funcDesc`（string）：功能需求描述——不超过 500 字的自然语言段落，讲清核心功能点与业务价值；可在素材基础上补充完善，但不得虚构素材中不存在的功能；避免列表与过于技术化的语言。
  - `functionalUsers`（数组，至少 1 项）：本功能涉及的系统级功能用户，`role` 必须取自生效参数 `functionalUserRoles` 的白名单。每项：
    - `role`（string）：小写字母开头，仅含小写字母/数字/连字符，如 `customer`。
    - `description`（string）：该功能用户与本功能的关系（不少于 10 个字符）。
    - `userStories`（字符串数组，至少 1 条）：用户故事，格式 `As a <role>, I want <action>, so that <benefit>`，每条不少于 20 个字符。
  - `businessRules`（数组，至少 1 项）：从素材与需求约束中提取的业务规则，数量须落在 CFP 配比区间内（区间为 [ceil(desiredCfps/cfpsPerRule), floor(ceil×1.5)]，`cfpsPerRule` 见生效参数）。每项：
    - `ruleType`（string）：`event`（触发性，如"登录失败 3 次锁定账户"）/ `condition`（条件性，如"密码必须包含字母和数字"）/ `complex`（复合规则，含多个条件与事件）。
    - `description`（string）：规则内容与约束效果（不少于 10 个字符）。

## 硬性约束

1. `index`、`funcId`、`desiredCfps` 必须与上游 plan 中对应 function 完全一致，不得改写。
2. `funcDesc` 不超过 500 字，写成一段连贯的自然语言；`functionalUsers[].role` 必须在白名单内。
3. 业务规则数量必须在配比区间内（不足与超出都会被校验拒绝）。

## 输入素材

{{materials}}

## 上游产物

{{upstream}}

## 生效参数

{{params}}
