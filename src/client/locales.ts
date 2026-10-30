/** UI copy, zh + en. Pack/param descriptions are author content and render verbatim; only chrome lives here. */

export type Translate = (key: string) => string

export const en = {
  nav: 'Docwright params',
  title: 'Docwright parameters',
  intro: 'Declared defaults and plugin configuration. Session values (confirmations, extractions) live in the conversation, not here.',
  viewGroups: 'Parameters',
  viewPacks: 'Packs',
  viewConfig: 'Plugin settings',
  loading: 'Loading parameters…',
  loadFailed: 'Could not load the parameters.',
  retry: 'Retry',
  empty: 'No parameters with declared defaults.',
  sources: 'effective source',
  governedBy: 'managed by',
  scopeWorkspace: 'workspace',
  scopeTopic: 'topic',
  consumed: 'consumes',
  driftPolicy: 'param drift',
  min: 'min',
  max: 'max',
  choices: 'choices',
  confirmed: 'needs confirmation',
  extractable: 'extractable from materials',
  overridable: 'adjustable by materials',
  edit: 'Edit',
  cancel: 'Cancel',
  save: 'Save',
  saving: 'Saving…',
  saved: 'Saved. New generations use the new value; existing artifacts are unchanged.',
  saveConfig: 'Save settings',
  configHint: 'Changes apply live and persist across restarts. provider/model affect the prompt hash of future generations only.',
  reset: 'Reset',
  inherited: 'default',
  configured: 'configured',
  unset: 'not set',
  invalidJson: 'Not valid JSON.',
  rangeTemplate: 'Must be between {min} and {max}.',
  invalidNumber: 'Not a valid number.',
  notEditable: 'No declared default — nothing to maintain here. Values come from the conversation (confirmation gate or extraction).',
  advanced: 'Advanced',
  packsEditNote: 'Edit where the value governs: rows marked [managed by ...] are shadowed declarations - they never take effect on the chain; edit the source row instead.',
  bandValue: 'target {value}, tolerance band {min}-{max}',
  factorValue: 'target {value}, tolerance x{down}-x{up}',
  shadowedNote: 'Also declared by {packs} (governed by the source; per-pack spec details in the Packs view).',
  shadowedByNote: 'managed by {pack} - never takes effect',
  // Server error codes (src/coded-error.ts): what happened / why / what to do.
  'err.gateRejected': 'The request was rejected by the host (HTTP {status}): not logged in, or the origin check failed. Refresh the page and sign in again.',
  'err.crossSiteWrite': 'Write refused: the request origin does not match the deployment host (cross-site request). Operate inside the dsh web UI instead of from other sites.',
  'err.bodyTooLarge': 'The request body exceeds the {max}-byte limit; nothing was written. Reduce the request size.',
  'err.invalidJsonBody': 'The request body is not valid JSON; nothing was written.',
  'err.invalidPatchBody': 'Malformed request: expected {"patch": {...}} (an object of Config keys); nothing was written.',
  'err.invalidParamBody': 'Malformed request: non-empty pack and param names are required; nothing was written.',
  'err.valueRequired': 'Missing value (the new default). The UI edits defaults; it does not remove them.',
  'err.noProfileEntry': 'The host config editor lists no profile entry for docwright; the save was refused. Configure docwright via cordis.yml or the profile patch.',
  'err.unknownPack': 'Unknown pack "{pack}". Available: {available}. Nothing was written.',
  'err.paramNotEditable': 'Pack "{pack}" param {param} declares no default — the UI maintains declared defaults only. Structural changes are a pack-author manifest edit with a version bump. Nothing was written.',
  'err.manifestCorrupt': 'The pack "{pack}" manifest.json is not valid JSON; nothing was written. Fix the file first.',
  'err.paramVanished': 'params.{param} no longer exists in the manifest (the file may have been edited concurrently); nothing was written. Refresh and retry.',
  'err.manifestInvalid': 'The proposed manifest failed the load-time validation; nothing was written. Fix the value per the detail below.',
  'err.reloadFailed': 'The manifest was written, but reloading the packs failed. Fix or revert {path}; until a reload succeeds the running tools keep the previous spec.',
}

export const zh: Record<string, string> = {
  nav: 'Docwright 参数',
  title: 'Docwright 参数',
  intro: '这里维护声明的默认值与插件配置。会话中的值（确认、素材抽取）在对话里，不在这里。',
  viewGroups: '参数',
  viewPacks: '包',
  viewConfig: '插件设置',
  loading: '正在载入参数…',
  loadFailed: '参数载入失败。',
  retry: '重试',
  empty: '没有声明任何带默认值的参数。',
  sources: '生效源',
  governedBy: '由以下管理',
  scopeWorkspace: '工作区级',
  scopeTopic: '话题级',
  consumed: '消费上游',
  driftPolicy: '参数漂移策略',
  min: '下限',
  max: '上限',
  choices: '可选项',
  confirmed: '需确认',
  extractable: '可从素材抽取',
  overridable: '可被素材调整',
  edit: '编辑',
  cancel: '取消',
  save: '保存',
  saving: '保存中…',
  saved: '已保存。新生成使用新值；已有产物不变。',
  saveConfig: '保存设置',
  configHint: '改动实时生效并在重启后保留。provider / model 只影响之后生成的 prompt 哈希，不追溯已有产物。',
  reset: '还原',
  inherited: '默认',
  configured: '已配置',
  unset: '未设置',
  invalidJson: '不是合法 JSON。',
  rangeTemplate: '必须在 {min} 到 {max} 之间。',
  invalidNumber: '不是合法数字。',
  notEditable: '没有声明默认值——这里没有可维护的现役值。它的值来自对话（确认门或素材抽取）。',
  advanced: '高级',
  packsEditNote: '在生效处编辑：标有「由 … 管理」的行是被遮蔽的声明——在链上永不生效，请改生效源行。',
  bandValue: '目标 {value}（容差带 {min}–{max}）',
  factorValue: '目标 {value}（容差 ×{down}–×{up}）',
  shadowedNote: '其余声明：{packs}（由生效源管理；spec 详情见 Pack 视图）。',
  shadowedByNote: '由 {pack} 管理——此处声明不生效',
  // 服务端错误码（src/coded-error.ts）：发生了什么 / 为什么 / 怎么办。
  'err.gateRejected': '请求被宿主拒绝（HTTP {status}）：未登录或来源校验未通过。刷新页面重新登录后再试。',
  'err.crossSiteWrite': '写入被拒绝：请求来源与部署主机不一致（跨站请求）。请在 dsh web 界面内操作，不要从其他站点发起。',
  'err.bodyTooLarge': '请求体超过 {max} 字节上限，未写入任何内容。请缩小请求内容。',
  'err.invalidJsonBody': '请求体不是合法 JSON，未写入任何内容。',
  'err.invalidPatchBody': '请求格式错误：应为 {"patch": {...}}（Config 键的对象），未写入任何内容。',
  'err.invalidParamBody': '请求格式错误：需要非空的 pack 与 param 名称，未写入任何内容。',
  'err.valueRequired': '缺少 value（新的默认值）。界面只支持修改默认值，不支持删除。',
  'err.noProfileEntry': '宿主配置编辑器没有列出 docwright 的 profile entry，无法保存。请通过 cordis.yml 或 profile patch 配置 docwright。',
  'err.unknownPack': '找不到 pack「{pack}」。可用：{available}。未写入任何内容。',
  'err.paramNotEditable': 'pack「{pack}」的参数 {param} 没有声明默认值——界面只维护已声明的默认值。结构性改动请由 pack 作者编辑 manifest 并升版。未写入任何内容。',
  'err.manifestCorrupt': 'pack「{pack}」的 manifest.json 不是合法 JSON，未写入任何内容。请先修复该文件。',
  'err.paramVanished': 'manifest 中已不存在参数 {param}（文件可能被同时编辑过），未写入任何内容。请刷新后重试。',
  'err.manifestInvalid': '提议的 manifest 未通过装载期校验，未写入任何内容。请按下方详情修正数值。',
  'err.reloadFailed': 'manifest 已写入，但重新装载 pack 失败。请修复或还原 {path}；在装载成功前，运行中的工具仍持旧 spec。',
}

export function translate(dict: Record<string, unknown>): Translate {
  return (key: string) => {
    const value = dict[key]
    return typeof value === 'string' ? value : key
  }
}

/** Fill a {key}-templated locale string. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`))
}

/** A save/load failure as the UI renders it: the localized catalog entry for
 * known codes, the raw server sentence otherwise, plus the raw detail line. */
export function renderError(error: { message: string; code?: string; params?: Readonly<Record<string, string | number>>; detail?: string }, lang: 'zh' | 'en'): { text: string; detail?: string } {
  const dict: Record<string, string | undefined> = lang === 'zh' ? zh : en
  const template = error.code === undefined ? undefined : dict[`err.${error.code}`]
  const text = typeof template === 'string' ? fill(template, { ...(error.params ?? {}) }) : error.message
  return { text, ...(error.detail === undefined ? {} : { detail: error.detail }) }
}
