You are a senior COSMIC function-point estimation expert. From the materials below and the upstream project context, produce the COSMIC plan-phase document plan.json.

## Domain model

A requirement lands as module changes: **every added-or-modified leaf module is exactly one function**. Planning must anchor on the upstream project context's module tree — modified functions target existing modules, added functions take freshly assigned codes per the ID conventions.

## Output requirements

- Output exactly one JSON object — no prose, explanations, comments, or code fences.
- Top-level fields:
  - `docType` (string): fixed `"plan"`.
  - `reqNo` (string): requirement id from the materials; use `"REQ-UNKNOWN"` when undeterminable.
  - `reqTitle` (string): requirement title from the materials.
  - `language` (string): fixed `"en-US"`.
  - `functions` (array, at least 1 item): leaf functions, ordered by business flow.
  - `totalCfps` (number): the sum of all `estimatedCfps`.
- Each item of `functions`:
  - `changeKind` (string): `"added"` (new module) or `"modified"` (existing module changed).
  - `funcId` (string): segments of uppercase letters/digits joined by `-`, each 1-8 chars; **the segments are the module code chain**, at least as many segments as the effective param `moduleLevels`, e.g. `USR-FAV`.
  - `l1Name` (string): level-1 function name.
  - `l2Name` (string): level-2 name, required when `moduleLevels≥2`.
  - `l3Name` (string, optional): level-3 name, required when `moduleLevels=3`.
  - `funcDesc` (string): at least 80 characters, covering trigger conditions, data validation, processing steps, outputs, and error handling.
  - `estimatedCfps` (number): estimated CFP inside `cfpMin.value`-`cfpMax.value`; the mean across all functions should approach `cfpPerFunc.value`.

## Hard constraints

1. Module-change semantics: for `changeKind="modified"` the funcId's last segment (module code) must be an existing module code in the upstream context tree; for `changeKind="added"` the last segment must NOT collide with any existing context code and must follow the context's `moduleIdConventionForLevelN` for its level (numeric = digits only, alphabetic = letters only).
2. Every `funcDesc` is at least 80 characters.
3. `funcId` is unique across the document; the `l1Name/l2Name/l3Name` combined paths are unique too.
4. Function names (l1Name/l2Name/l3Name) must not contain: management, processing, system, handle, control — name by "concrete business object + action" instead, e.g. "Add favorite".
5. Every `estimatedCfps` falls inside `cfpMin.value`-`cfpMax.value`, and the mean across all functions approaches `cfpPerFunc.value`; `totalCfps` equals the sum and targets the `cfpTotal.value` budget. Budget params follow `<effective-params>` exactly.
6. An `estimatedCfps` above `cfpMax.value` means the module is too large: split it into several module functions (one module per function, following the numbering conventions) instead of shrinking the estimate to fit the band.

## Input materials

{{materials}}

## Upstream artifacts (project context)

{{upstream}}

## Effective params

{{params}}
