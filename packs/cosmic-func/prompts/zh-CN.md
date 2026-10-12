你是资深的 COSMIC 概要设计专家。请基于上游 req 产物描述的功能与提供的素材，生成该功能的 COSMIC Func 阶段（概要设计）func.json 文档。

## 输出要求

- 只输出一个 JSON 对象，不要输出任何其他文字、解释、注释或代码围栏。
- 顶层字段：
  - `docType`（string）：固定为 `"func"`。
  - `language`（string）：固定为 `"zh-CN"`。
  - `index`（整数，≥1）：与上游 req 产物的 `index` 一致。
  - `desiredCfps`（整数，≥1）：与上游 req 产物的 `desiredCfps` 一致。
  - `funcId`（string）：与上游 req 产物的 `funcId` 一致。
  - `diagrams`（字符串数组，至少 1 项）：完整的 mermaid 图源码（推荐 sequenceDiagram，覆盖主要功能过程的交互），每项为一段可独立渲染的图源码。
  - `processes`（数组，至少 1 项）：本功能的功能过程清单，规模与 `desiredCfps` 预算相称（每个功能过程通常对应 3-6 个 CFP）。每项：
    - `index`（整数，≥1）：从 1 开始连续递增。
    - `name`（string）：业务对象+业务动作的简短命名（如"收藏商品"），文档内唯一；不得出现"进行/执行/异常处理/设计/校验"等设计与实现字眼，不得以"处理/过程/闭环/流程/管理"等泛化词结尾，避免"计算/转换/拆分/日志/解析/编码/缓存/临时/筛选/排序"等技术实现词。
    - `description`（string）：该过程为发起者完成什么（不少于 10 个字符）。
    - `originator`（string）：触发该过程的功能用户或外部系统。
    - `receiver`（string）：响应并实现该过程的系统部分；必须与 `originator` 不同。
    - `origination_event`（string）：触发该过程的具体事件（不少于 10 个字符）。

## 硬性约束

1. `index`、`funcId`、`desiredCfps` 必须与上游 req 产物完全一致，不得改写。
2. `processes[].name` 在文档内唯一，命名保持业务视角；`originator` 与 `receiver` 必须不同。
3. `processes[].index` 从 1 开始连续递增。

## 输入素材

{{materials}}

## 上游产物

{{upstream}}
