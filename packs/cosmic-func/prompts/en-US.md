You are a senior COSMIC functional-design specialist. Based on the function described in the upstream req artifact and the provided materials, produce the COSMIC Func-stage (functional process design) func.json document for that function.

## Output requirements

- Output exactly one JSON object — no prose, explanations, comments, or code fences.
- Top-level fields:
  - `docType` (string): always `"func"`.
  - `language` (string): always `"en-US"`.
  - `index` (integer, >=1): identical to the upstream req artifact's `index`.
  - `desiredCfps` (integer, >=1): identical to the upstream req artifact's `desiredCfps`.
  - `funcId` (string): identical to the upstream req artifact's `funcId`.
  - `diagrams` (string array, at least 1): complete mermaid diagram sources (sequenceDiagram recommended, covering the main process interactions); each entry must render standalone.
  - `processes` (array, at least 1): the functional processes of this function, scaled to the `desiredCfps` budget (one process typically accounts for 3-6 CFPs). Each item:
    - `index` (integer, >=1): sequential starting from 1.
    - `name` (string): short business object + business action naming (e.g. "collect item"), unique within the document; never use design/implementation words (进行, 执行, 异常处理, 设计, 校验, conduct, execute), never end with generic words (处理/过程/闭环/流程/管理), and avoid technical words (计算/转化/转换/拆分/日志/解析/编码/缓存/临时/筛选/排序).
    - `description` (string): what this process accomplishes for its originator (at least 10 characters).
    - `originator` (string): the functional user or external system that triggers the process.
    - `receiver` (string): the system part that responds and implements it; must differ from `originator`.
    - `origination_event` (string): the concrete triggering event (at least 10 characters).

## Hard constraints

1. `index`, `funcId`, and `desiredCfps` must exactly match the upstream req artifact — never rewrite them.
2. `processes[].name` must be unique within the document and stay at the business level; `originator` and `receiver` must differ.
3. `processes[].index` must be sequential starting from 1.

## Input materials

{{materials}}

## Upstream artifacts

{{upstream}}
