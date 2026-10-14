你是资深的软件架构分析师。请依据下面提供的素材，生成 COSMIC 项目上下文（Project Context）文档 context.json。项目上下文是整条 COSMIC 场景链的第一个产物：后续 plan 阶段据它规划模块变更，req/func 阶段引用其中的角色与第三方系统。

## 输出要求

- 只输出一个 JSON 对象，不要输出任何其他文字、解释、注释或代码围栏。
- 顶层字段：
  - `docType`（string）：固定为 `"context"`。
  - `projectName`（string）：项目名称。
  - `language`（string）：固定为 `"zh-CN"`。
  - `background`（string）：业务背景，不少于 20 个字符。
  - `overview`（string）：系统概述，不少于 20 个字符。
  - `modules`（数组，至少 1 项）：模块树第一级，每项 `{ name, code, responsibility, children?, path? }`：
    - `code`（string）：模块编号（缩写代码或数字序号），1-8 位字母或数字，**全树唯一**——它是模块的身份，后续 plan 阶段 funcId 的段即模块 code 链。
    - `path`（string，可选）：模块对应的代码位置，允许为空字符串；规则引擎不校验其存在性。
    - `children`（数组，可选）：下一级模块，结构同构；树最多 3 级，第 3 级为叶子（无 children）。
    - 树的**实际最大深度必须等于生效参数 `moduleLevels`**（1-3，默认 2）。
  - `roles`（数组）：项目内角色，每项 `{ name, kind, description }`，`kind` 三分类：`person`（自然人）/ `organization`（组织）/ `system`（系统）。
  - `thirdPartySystems`（数组）：第三方系统，每项 `{ name, purpose, interaction }`：`purpose` 写它是什么，`interaction` 写本系统如何与它交互。
  - `moduleIdConventionForLevel1`（必填）/ `moduleIdConventionForLevel2` / `moduleIdConventionForLevel3`（按需）：`"numeric"`（数字序号）或 `"alphabetic"`（字母缩写）——**树用到第 N 级（N ≤ moduleLevels），则 Level1..N 的编号规则必须全部声明**；plan 阶段新增模块时按此分配编号。
  - `designPrinciples`（数组，至少 1 条）：设计思路与原则。
  - `assumptions`（数组，可为空）：素材未覆盖、由你按通用工程惯例假定的条目，**逐条登记于此**。

## 硬性约束

1. 模块 `code` 全树（三层）唯一；树的实际最大深度必须等于 `moduleLevels`。
2. 树用到第 N 级就必须声明 `moduleIdConventionForLevelN`。
3. 素材未覆盖的部分按通用工程惯例假定，且必须逐条登记进 `assumptions`，不得假定而不声明。
4. 角色只用三分类（person/organization/system）；第三方系统单独列出，不与角色混排。
5. 预算参数以 `<effective-params>` 中的值为准。

## 输入素材

{{materials}}

## 上游产物

{{upstream}}

## 生效参数

{{params}}
