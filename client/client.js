window.__ModuleLoader__.load({ id: "@sharework-ai/dsh-docwright", factory: (require) => {

		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		//#endregion
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		_deepseek_ai_dsh_client_ui_primitives = __toESM(_deepseek_ai_dsh_client_ui_primitives, 1);
		//#region src/description.ts
		/** Resolve for a surface: the requested locale first, `en` as the fallback. */
		function resolveLocalized(text, locale) {
			if (text === void 0) return "";
			if (typeof text === "string") return text;
			if (locale !== "en" && typeof text[locale] === "string") return text[locale];
			return text.en;
		}
		//#endregion
		//#region src/client/api.ts
		var ApiError = class extends Error {
			code;
			params;
			detail;
			constructor(message, coded = {}) {
				super(message);
				this.name = "ApiError";
				if (coded.code !== void 0) this.code = coded.code;
				if (coded.params !== void 0) this.params = coded.params;
				if (coded.detail !== void 0) this.detail = coded.detail;
			}
		};
		async function parse(response) {
			let body;
			try {
				body = await response.json();
			} catch {
				throw new ApiError(`docwright: the server answered HTTP ${response.status} with a non-JSON body; is the docwright plugin loaded?`);
			}
			if (!response.ok) {
				const envelope = body;
				const message = typeof envelope.error === "string" && envelope.error.length > 0 ? envelope.error : `docwright request failed with HTTP ${response.status}`;
				const coded = {};
				if (typeof envelope.code === "string") coded.code = envelope.code;
				if (typeof envelope.params === "object" && envelope.params !== null) coded.params = envelope.params;
				if (typeof envelope.detail === "string") coded.detail = envelope.detail;
				throw new ApiError(message, coded);
			}
			return body;
		}
		/** Fetch the params catalog (packs, aggregation groups, config provenance). */
		async function fetchParams() {
			return parse(await fetch("/api/docwright/params", { headers: { accept: "application/json" } }));
		}
		/** Merge a Config patch through the host settings service (server-proxied). */
		async function saveConfigPatch(patch) {
			await parse(await fetch("/api/docwright/config", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ patch })
			}));
		}
		/** Set one pack param default in its manifest (server re-validates at load strength). */
		async function savePackParam(pack, param, value) {
			await parse(await fetch("/api/docwright/pack-param", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					pack,
					param,
					value
				})
			}));
		}
		//#endregion
		//#region src/client/locales.ts
		const en = {
			nav: "Docwright params",
			title: "Docwright parameters",
			intro: "Declared defaults and plugin configuration. Session values (confirmations, extractions) live in the conversation, not here.",
			viewGroups: "Parameters",
			viewPacks: "Packs",
			viewConfig: "Plugin settings",
			loading: "Loading parameters…",
			loadFailed: "Could not load the parameters.",
			retry: "Retry",
			empty: "No parameters with declared defaults.",
			sources: "effective source",
			governedBy: "managed by",
			scopeWorkspace: "workspace",
			scopeTopic: "topic",
			consumed: "consumes",
			driftPolicy: "param drift",
			min: "min",
			max: "max",
			choices: "choices",
			confirmed: "needs confirmation",
			extractable: "extractable from materials",
			overridable: "adjustable by materials",
			edit: "Edit",
			cancel: "Cancel",
			save: "Save",
			saving: "Saving…",
			saved: "Saved. New generations use the new value; existing artifacts are unchanged.",
			saveConfig: "Save settings",
			configHint: "Changes apply live and persist across restarts. provider/model affect the prompt hash of future generations only.",
			reset: "Reset",
			inherited: "default",
			configured: "configured",
			unset: "not set",
			invalidJson: "Not valid JSON.",
			rangeTemplate: "Must be between {min} and {max}.",
			invalidNumber: "Not a valid number.",
			notEditable: "No declared default — nothing to maintain here. Values come from the conversation (confirmation gate or extraction).",
			advanced: "Advanced",
			packsEditNote: "Edit where the value governs: rows marked [managed by ...] are shadowed declarations - they never take effect on the chain; edit the source row instead.",
			bandValue: "target {value}, tolerance band {min}-{max}",
			factorValue: "target {value}, tolerance x{down}-x{up}",
			shadowedNote: "Also declared by {packs} (governed by the source; per-pack spec details in the Packs view).",
			shadowedByNote: "managed by {pack} - never takes effect",
			"err.gateRejected": "The request was rejected by the host (HTTP {status}): not logged in, or the origin check failed. Refresh the page and sign in again.",
			"err.crossSiteWrite": "Write refused: the request origin does not match the deployment host (cross-site request). Operate inside the dsh web UI instead of from other sites.",
			"err.bodyTooLarge": "The request body exceeds the {max}-byte limit; nothing was written. Reduce the request size.",
			"err.invalidJsonBody": "The request body is not valid JSON; nothing was written.",
			"err.invalidPatchBody": "Malformed request: expected {\"patch\": {...}} (an object of Config keys); nothing was written.",
			"err.invalidParamBody": "Malformed request: non-empty pack and param names are required; nothing was written.",
			"err.valueRequired": "Missing value (the new default). The UI edits defaults; it does not remove them.",
			"err.noProfileEntry": "The host config editor lists no profile entry for docwright; the save was refused. Configure docwright via cordis.yml or the profile patch.",
			"err.unknownPack": "Unknown pack \"{pack}\". Available: {available}. Nothing was written.",
			"err.paramNotEditable": "Pack \"{pack}\" param {param} declares no default — the UI maintains declared defaults only. Structural changes are a pack-author manifest edit with a version bump. Nothing was written.",
			"err.manifestCorrupt": "The pack \"{pack}\" manifest.json is not valid JSON; nothing was written. Fix the file first.",
			"err.paramVanished": "params.{param} no longer exists in the manifest (the file may have been edited concurrently); nothing was written. Refresh and retry.",
			"err.manifestInvalid": "The proposed manifest failed the load-time validation; nothing was written. Fix the value per the detail below.",
			"err.reloadFailed": "The manifest was written, but reloading the packs failed. Fix or revert {path}; until a reload succeeds the running tools keep the previous spec.",
			"err.patternParamInvalid": "The new value for {param} is not a valid regex (it drives a validation rule); nothing was written. Fix the expression, or set the empty string to disable the check."
		};
		const zh = {
			nav: "Docwright 参数",
			title: "Docwright 参数",
			intro: "这里维护声明的默认值与插件配置。会话中的值（确认、素材抽取）在对话里，不在这里。",
			viewGroups: "参数",
			viewPacks: "包",
			viewConfig: "插件设置",
			loading: "正在载入参数…",
			loadFailed: "参数载入失败。",
			retry: "重试",
			empty: "没有声明任何带默认值的参数。",
			sources: "生效源",
			governedBy: "由以下管理",
			scopeWorkspace: "工作区级",
			scopeTopic: "话题级",
			consumed: "消费上游",
			driftPolicy: "参数漂移策略",
			min: "下限",
			max: "上限",
			choices: "可选项",
			confirmed: "需确认",
			extractable: "可从素材抽取",
			overridable: "可被素材调整",
			edit: "编辑",
			cancel: "取消",
			save: "保存",
			saving: "保存中…",
			saved: "已保存。新生成使用新值；已有产物不变。",
			saveConfig: "保存设置",
			configHint: "改动实时生效并在重启后保留。provider / model 只影响之后生成的 prompt 哈希，不追溯已有产物。",
			reset: "还原",
			inherited: "默认",
			configured: "已配置",
			unset: "未设置",
			invalidJson: "不是合法 JSON。",
			rangeTemplate: "必须在 {min} 到 {max} 之间。",
			invalidNumber: "不是合法数字。",
			notEditable: "没有声明默认值——这里没有可维护的现役值。它的值来自对话（确认门或素材抽取）。",
			advanced: "高级",
			packsEditNote: "在生效处编辑：标有「由 … 管理」的行是被遮蔽的声明——在链上永不生效，请改生效源行。",
			bandValue: "目标 {value}（容差带 {min}–{max}）",
			factorValue: "目标 {value}（容差 ×{down}–×{up}）",
			shadowedNote: "其余声明：{packs}（由生效源管理；spec 详情见 Pack 视图）。",
			shadowedByNote: "由 {pack} 管理——此处声明不生效",
			"err.gateRejected": "请求被宿主拒绝（HTTP {status}）：未登录或来源校验未通过。刷新页面重新登录后再试。",
			"err.crossSiteWrite": "写入被拒绝：请求来源与部署主机不一致（跨站请求）。请在 dsh web 界面内操作，不要从其他站点发起。",
			"err.bodyTooLarge": "请求体超过 {max} 字节上限，未写入任何内容。请缩小请求内容。",
			"err.invalidJsonBody": "请求体不是合法 JSON，未写入任何内容。",
			"err.invalidPatchBody": "请求格式错误：应为 {\"patch\": {...}}（Config 键的对象），未写入任何内容。",
			"err.invalidParamBody": "请求格式错误：需要非空的 pack 与 param 名称，未写入任何内容。",
			"err.valueRequired": "缺少 value（新的默认值）。界面只支持修改默认值，不支持删除。",
			"err.noProfileEntry": "宿主配置编辑器没有列出 docwright 的 profile entry，无法保存。请通过 cordis.yml 或 profile patch 配置 docwright。",
			"err.unknownPack": "找不到 pack「{pack}」。可用：{available}。未写入任何内容。",
			"err.paramNotEditable": "pack「{pack}」的参数 {param} 没有声明默认值——界面只维护已声明的默认值。结构性改动请由 pack 作者编辑 manifest 并升版。未写入任何内容。",
			"err.manifestCorrupt": "pack「{pack}」的 manifest.json 不是合法 JSON，未写入任何内容。请先修复该文件。",
			"err.paramVanished": "manifest 中已不存在参数 {param}（文件可能被同时编辑过），未写入任何内容。请刷新后重试。",
			"err.manifestInvalid": "提议的 manifest 未通过装载期校验，未写入任何内容。请按下方详情修正数值。",
			"err.reloadFailed": "manifest 已写入，但重新装载 pack 失败。请修复或还原 {path}；在装载成功前，运行中的工具仍持旧 spec。",
			"err.patternParamInvalid": "参数 {param} 的新值不是合法正则表达式（它驱动一条校验规则），未写入任何内容。请修正表达式，或置空字符串以停用该检查。"
		};
		function translate(dict) {
			return (key) => {
				const value = dict[key];
				return typeof value === "string" ? value : key;
			};
		}
		/** Fill a {key}-templated locale string. */
		function fill(template, vars) {
			return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
		}
		/** A save/load failure as the UI renders it: the localized catalog entry for
		* known codes, the raw server sentence otherwise, plus the raw detail line. */
		function renderError(error, lang) {
			const dict = lang === "zh" ? zh : en;
			const template = error.code === void 0 ? void 0 : dict[`err.${error.code}`];
			return {
				text: typeof template === "string" ? fill(template, { ...error.params ?? {} }) : error.message,
				...error.detail === void 0 ? {} : { detail: error.detail }
			};
		}
		//#endregion
		//#region src/client/ParamsSection.tsx
		/**
		* The Docwright params section: three views over one catalog fetch —
		* shared-param groups (the aggregation with effective-source resolution),
		* per-pack flat view, and the plugin Config form. Controls map from the
		* ParamSpec type (number → numeric input, enum → select, boolean → switch,
		* object → JSON-per-value with endpoints read-only); every parameter shows
		* its author's description inline beneath the name, resolved to the active
		* locale by the host's `locale.resolveText` (LocalizedText from the RPC,
		* en-fallback semantics of src/description.ts). Writes go through the
		* plugin's own routes (src/http.ts), never the conversation; their error
		* envelopes render through the locale catalog (locales.ts renderError).
		*
		* Typography follows the host conversation body, not ad-hoc sizes: one
		* family and size for all running text (`--dsw-font-family` +
		* `--dsh-content-font-size`, 24px+delta line height, so the user's font-size
		* preference applies here too); hierarchy comes from weight and the host's
		* label grays (`--dsw-alias-label-secondary`), never from font size. Only
		* identifiers and values (param names, enum members, JSON) sit in the host
		* code face (`--dsh-font-family-code`).
		*/
		const NS$1 = "docwright-params";
		/** The conversation body's family and size — the one measure for all running
		* text in this section. */
		const baseText = {
			fontFamily: "var(--dsw-font-family, inherit)",
			fontSize: "var(--dsh-content-font-size, 14px)",
			lineHeight: "calc(24px + var(--dsh-content-font-delta, 0px))"
		};
		/** Host code face for identifiers and values only (names, enums, JSON). */
		const codeFont = "var(--dsh-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)";
		/** The host's first muted gray (real theme token; the old --dsw-alias-text-*
		* names never existed upstream and always fell through to full-strength). */
		const secondary = "var(--dsw-alias-label-secondary, inherit)";
		const row = {
			display: "flex",
			alignItems: "center",
			gap: "8px",
			padding: "6px 0"
		};
		const rowHead = {
			display: "flex",
			alignItems: "baseline",
			gap: "8px",
			flexWrap: "wrap",
			minWidth: 0
		};
		const nameStyle = {
			fontWeight: 600,
			fontFamily: codeFont
		};
		const desc = {
			color: secondary,
			whiteSpace: "pre-wrap",
			wordBreak: "break-word"
		};
		const valueStyle = { fontFamily: codeFont };
		const muted = { color: secondary };
		const group = {
			border: "0.5px solid var(--dsw-alias-border-l4, transparent)",
			borderRadius: "var(--dsw-radius-xl, 20px)",
			background: "var(--dsw-alias-bg-layer-2, transparent)",
			padding: "12px 16px",
			marginBottom: "12px"
		};
		const card = {
			...group,
			overflow: "hidden"
		};
		/** The pack card's full-width header band: a quiet blue wash that separates
		* "which pack am I looking at" from the parameter rows below it. */
		const packHead = {
			display: "flex",
			alignItems: "baseline",
			gap: "8px",
			flexWrap: "wrap",
			minWidth: 0,
			margin: "-12px -16px 10px",
			padding: "10px 16px",
			background: "color-mix(in srgb, var(--dsw-static-blue-500, rgb(59, 130, 246)) 7%, transparent)"
		};
		const sourceLine = {
			display: "flex",
			alignItems: "center",
			gap: "8px",
			marginTop: "4px"
		};
		const inputStyle = { width: "160px" };
		const actions = {
			display: "flex",
			gap: "8px",
			alignItems: "center",
			marginTop: "8px"
		};
		/** The author's description, inline beneath the parameter name — the primary
		* explanation stays in view instead of hiding behind a hover. Locale
		* resolution: the host's resolveText when available, its semantics locally
		* otherwise (src/description.ts). */
		function DescriptionLine(props) {
			return (0, react.createElement)("div", {
				className: `${NS$1}-desc`,
				style: {
					...desc,
					marginTop: "2px"
				}
			}, props.resolveText(props.text ?? ""));
		}
		/** One failing write/load as text + optional raw detail line. */
		function ErrorLine(props) {
			const rendered = renderError(props.error, props.lang);
			return (0, react.createElement)("span", { style: {
				color: "var(--dsw-alias-state-error-primary, crimson)",
				whiteSpace: "pre-wrap"
			} }, rendered.text, rendered.detail !== void 0 ? (0, react.createElement)("span", { style: {
				...muted,
				whiteSpace: "pre-wrap"
			} }, `\n${rendered.detail}`) : null);
		}
		/**
		* Human projection of a declared default: value-band objects read as
		* "target 60 (band 30-90)" instead of raw JSON; anything else that is not a
		* plain scalar falls back to JSON.
		*/
		function displayDefault(d, t) {
			if (typeof d.default !== "object" || d.default === null) return String(d.default);
			const o = d.default;
			if (typeof o.value === "number" && typeof o.min === "number" && typeof o.max === "number") return fill(t("bandValue"), {
				value: o.value,
				min: o.min,
				max: o.max
			});
			if (typeof o.value === "number" && typeof o.downFactor === "number" && typeof o.upFactor === "number") return fill(t("factorValue"), {
				value: o.value,
				down: o.downFactor,
				up: o.upFactor
			});
			return JSON.stringify(d.default);
		}
		/** Value-semantics flags, rendered as quiet pills. The confirm gate flag is
		* deliberately absent: it says nothing about maintaining the default (and is
		* not editable here), so it only confused readers. */
		function FlagPills(props) {
			const { d, t } = props;
			const flags = [];
			if (d.extractable) flags.push(t("extractable"));
			if (d.overridable) flags.push(t("overridable"));
			return flags.length === 0 ? null : (0, react.createElement)("div", { style: {
				display: "flex",
				gap: "4px",
				flexWrap: "wrap"
			} }, flags.map((f) => (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Pill, { key: f }, f)));
		}
		/** Constraint summary under the value: declared range and choices. Object
		* bands carry no note — the human projection ("target 60, band 30-90")
		* already says what value and endpoints mean, uniformly for every band. */
		function ConstraintLine(props) {
			const { d, t } = props;
			const bits = [];
			if (d.enumValues !== void 0) bits.push(`${t("choices")}: ${d.enumValues.join(" / ")}`);
			if (d.min !== void 0) bits.push(`${t("min")} ${d.min}`);
			if (d.max !== void 0) bits.push(`${t("max")} ${d.max}`);
			return bits.length === 0 ? null : (0, react.createElement)("div", { style: muted }, bits.join(" · "));
		}
		/** Validate one proposed default against the declaration (client-side mirror of the server gate). */
		function validateDraft(d, text) {
			if (d.type === "object") try {
				const parsed = JSON.parse(text);
				if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return "invalidJson";
				return;
			} catch {
				return "invalidJson";
			}
			if (d.enumValues !== void 0) return void 0;
			if (d.type === "number") {
				const n = Number(text);
				if (text.trim() === "" || !Number.isFinite(n)) return "invalidNumber";
				if (d.min !== void 0 && n < d.min || d.max !== void 0 && n > d.max) return "outOfRange";
				return;
			}
		}
		/**
		* One declaration's value line, editability decided by ROLE (not by view):
		* a source declaration is editable whereever it is shown (the parameter
		* view's governing row and the owning pack's row in the Packs view write
		* the same manifest field); a shadowed declaration renders its value
		* struck-through and muted — it NEVER takes effect on the chain (the
		* receipt base outranks it) — with an explicit note naming the manager.
		*/
		function ValueRow(props) {
			const { d, t } = props;
			if (d.role === "shadowed") return (0, react.createElement)("div", { style: rowHead }, (0, react.createElement)("span", { style: {
				...valueStyle,
				color: secondary,
				textDecoration: "line-through"
			} }, displayDefault(d, t)), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Pill, {}, fill(t("shadowedByNote"), { pack: d.shadowedBy ?? "" })));
			return (0, react.createElement)(EditSeat, {
				d,
				t,
				lang: props.lang,
				onSaved: props.onSaved
			});
		}
		/** The staged-edit control for a source declaration. */
		function EditSeat(props) {
			const { d, t } = props;
			const [editing, setEditing] = (0, react.useState)(false);
			const [draft, setDraft] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(void 0);
			const start = () => {
				setDraft(d.type === "object" ? JSON.stringify(d.default, null, 2) : String(d.default));
				setError(void 0);
				setEditing(true);
			};
			const save = async () => {
				const problem = validateDraft(d, draft);
				if (problem !== void 0) {
					setError(new Error(problem === "outOfRange" ? fill(t("rangeTemplate"), {
						min: String(d.min ?? ""),
						max: String(d.max ?? "")
					}) : t(problem)));
					return;
				}
				setBusy(true);
				setError(void 0);
				try {
					const value = d.type === "object" ? JSON.parse(draft) : d.type === "number" ? Number(draft) : draft;
					await savePackParam(d.pack, d.name, value);
					setEditing(false);
					props.onSaved?.();
				} catch (saveError) {
					setError(saveError);
				} finally {
					setBusy(false);
				}
			};
			const valueLine = (0, react.createElement)("div", { style: rowHead }, (0, react.createElement)("span", { style: valueStyle }, displayDefault(d, t)), editing ? null : (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				size: "sm",
				variant: "ghost",
				onClick: start
			}, t("edit")));
			if (!editing) return valueLine;
			return (0, react.createElement)("div", null, d.enumValues !== void 0 ? (0, react.createElement)("select", {
				value: String(d.default),
				onChange: (e) => setDraft(e.target.value),
				style: inputStyle
			}, d.enumValues.map((v) => (0, react.createElement)("option", {
				key: String(v),
				value: String(v)
			}, String(v)))) : d.type === "object" ? (0, react.createElement)("textarea", {
				value: draft,
				onChange: (e) => setDraft(e.target.value),
				rows: 4,
				style: {
					...inputStyle,
					width: "100%",
					maxWidth: "480px",
					fontFamily: codeFont
				}
			}) : (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Input, {
				value: draft,
				type: d.type === "number" ? "number" : "text",
				step: "any",
				onChange: (e) => setDraft(e.target.value),
				style: inputStyle
			}), (0, react.createElement)("div", { style: actions }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				size: "sm",
				disabled: busy,
				onClick: () => void save()
			}, busy ? t("saving") : t("save")), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				size: "sm",
				variant: "ghost",
				disabled: busy,
				onClick: () => setEditing(false)
			}, t("cancel")), error !== void 0 ? (0, react.createElement)(ErrorLine, {
				error,
				lang: props.lang
			}) : null));
		}
		/**
		* One aggregated parameter group = ONE card, top to bottom: name + flags,
		* the author's description in the muted gray, the effective source on its
		* own line (what governs is a fact of its own — not a prefix of the value
		* row), the effective value and its edit seat on the next, then declared
		* constraints. The shadowed declarations collapse into a single sentence —
		* their values never take effect (the receipt base outranks them), so
		* rendering them per-card repeated the same text N times and showed
		* misleading never-applied numbers.
		*/
		function ParamGroupCard(props) {
			const { name, declarations, t } = props;
			const governing = declarations.find((d) => d.role === "source") ?? declarations[0];
			const shadowed = declarations.filter((d) => d !== governing);
			return (0, react.createElement)("div", { style: group }, (0, react.createElement)("div", { style: rowHead }, (0, react.createElement)("span", { style: nameStyle }, name), (0, react.createElement)(FlagPills, {
				d: governing,
				t
			})), (0, react.createElement)(DescriptionLine, {
				text: governing.description,
				resolveText: props.resolveText
			}), (0, react.createElement)("div", { style: sourceLine }, (0, react.createElement)("span", { style: muted }, `${t("sources")}:`), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Pill, {}, governing.pack)), (0, react.createElement)(ValueRow, {
				d: governing,
				t,
				lang: props.lang,
				onSaved: props.onSaved
			}), (0, react.createElement)("div", { style: { marginTop: "2px" } }, (0, react.createElement)(ConstraintLine, {
				d: governing,
				t
			})), shadowed.length > 0 ? (0, react.createElement)("div", { style: {
				...muted,
				marginTop: "4px"
			} }, fill(t("shadowedNote"), { packs: shadowed.map((d) => d.pack).join(", ") })) : null);
		}
		/** Aggregated parameter view: one card per parameter name. */
		function GroupsView(props) {
			const { payload, t } = props;
			if (payload.groups.length === 0) return (0, react.createElement)("p", { style: muted }, t("empty"));
			return (0, react.createElement)("div", null, payload.groups.map((g) => (0, react.createElement)(ParamGroupCard, {
				key: g.name,
				name: g.name,
				declarations: g.declarations,
				t,
				lang: props.lang,
				resolveText: props.resolveText,
				onSaved: props.onSaved
			})));
		}
		/** One declaration row inside a pack's card. Source rows carry the edit seat; shadowed rows strike their never-applied value through. */
		function PackDeclRow(props) {
			const { d, t } = props;
			return (0, react.createElement)("div", {
				className: `${NS$1}-row`,
				style: row
			}, (0, react.createElement)("div", { style: {
				display: "flex",
				flexDirection: "column",
				flex: 1,
				minWidth: 0
			} }, (0, react.createElement)("div", { style: rowHead }, (0, react.createElement)("span", { style: nameStyle }, d.name), (0, react.createElement)(FlagPills, {
				d,
				t
			})), (0, react.createElement)(DescriptionLine, {
				text: d.description,
				resolveText: props.resolveText
			}), (0, react.createElement)(ValueRow, {
				d,
				t,
				lang: props.lang,
				onSaved: props.onSaved
			}), (0, react.createElement)("div", { style: { marginTop: "2px" } }, (0, react.createElement)(ConstraintLine, {
				d,
				t
			}))));
		}
		/** Per-pack flat view (pack-author / troubleshooting perspective). Each card
		* opens with a full-width blue-wash header band — pack identity reads as a
		* section of its own, visually distinct from the param rows it contains. */
		function PacksView(props) {
			const { payload, t } = props;
			return (0, react.createElement)("div", null, (0, react.createElement)("p", { style: muted }, t("packsEditNote")), payload.packs.map((p) => (0, react.createElement)("div", {
				key: p.name,
				style: card
			}, (0, react.createElement)("div", { style: packHead }, (0, react.createElement)("span", { style: nameStyle }, p.name), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Pill, {}, `v${p.version}`), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Pill, {}, p.scope === "workspace" ? t("scopeWorkspace") : t("scopeTopic")), p.paramDriftPolicy !== void 0 ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Pill, {}, `${t("driftPolicy")}: ${p.paramDriftPolicy}`) : null), (0, react.createElement)("div", { style: {
				...desc,
				marginBottom: "4px"
			} }, props.resolveText(p.description)), p.consumes.length > 0 ? (0, react.createElement)("div", { style: muted }, `${t("consumed")}: ${p.consumes.join(", ")}`) : null, (0, react.createElement)("div", { style: { marginTop: "6px" } }, p.params.length === 0 ? (0, react.createElement)("p", { style: muted }, t("empty")) : p.params.map((d) => (0, react.createElement)(PackDeclRow, {
				key: d.name,
				d,
				t,
				lang: props.lang,
				resolveText: props.resolveText,
				onSaved: props.onSaved
			}))))));
		}
		/** Config form: top-level keys as rows, oscillation.* folded under Advanced. */
		function ConfigView(props) {
			const { payload, t } = props;
			const entries = payload.config;
			const [drafts, setDrafts] = (0, react.useState)({});
			const [switches, setSwitches] = (0, react.useState)({});
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(void 0);
			const [done, setDone] = (0, react.useState)(false);
			const toplevel = entries.filter((e) => !e.key.includes(".") && e.type !== "object");
			const advanced = entries.filter((e) => e.key.startsWith("oscillation.") && e.type !== "object");
			const draftOf = (e) => drafts[e.key] ?? (e.value === void 0 ? "" : String(e.value));
			const dirty = entries.some((e) => {
				if (e.type === "boolean") return switches[e.key] !== void 0 && switches[e.key] !== e.value;
				if (e.type === "object" || e.key.includes(".")) return false;
				const draft = drafts[e.key];
				return draft !== void 0 && draft !== (e.value === void 0 ? "" : String(e.value));
			});
			const renderRow = (e) => {
				const invalid = (() => {
					if (e.type === "number" && drafts[e.key] !== void 0) {
						const n = Number(drafts[e.key]);
						return drafts[e.key] !== "" && !Number.isFinite(n);
					}
					return false;
				})();
				const control = e.type === "boolean" ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Switch, {
					checked: switches[e.key] ?? e.value === true,
					onChange: (next) => setSwitches((prev) => ({
						...prev,
						[e.key]: next
					})),
					label: e.key
				}) : e.choices !== void 0 ? (0, react.createElement)("select", {
					value: draftOf(e) || String(e.value ?? ""),
					onChange: (ev) => setDrafts((prev) => ({
						...prev,
						[e.key]: ev.target.value
					})),
					style: inputStyle
				}, e.choices.map((c) => (0, react.createElement)("option", {
					key: String(c),
					value: String(c)
				}, String(c)))) : (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Input, {
					value: draftOf(e),
					type: e.type === "number" ? "number" : "text",
					step: "any",
					"aria-invalid": invalid,
					onChange: (ev) => setDrafts((prev) => ({
						...prev,
						[e.key]: ev.target.value
					})),
					style: inputStyle
				});
				return (0, react.createElement)("div", {
					key: e.key,
					className: `${NS$1}-row`,
					style: row
				}, (0, react.createElement)("div", { style: {
					display: "flex",
					flexDirection: "column",
					flex: 1,
					minWidth: 0
				} }, (0, react.createElement)("div", { style: rowHead }, (0, react.createElement)("span", { style: nameStyle }, e.key), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Pill, {}, e.origin === "configured" ? t("configured") : e.value === void 0 ? t("unset") : t("inherited"))), e.description !== void 0 ? (0, react.createElement)(DescriptionLine, {
					text: e.description,
					resolveText: props.resolveText
				}) : null, control, e.origin === "default" && e.default !== void 0 && String(e.default) !== String(e.value ?? "") ? (0, react.createElement)("div", { style: muted }, `${t("inherited")}: ${String(e.default)}`) : null));
			};
			const saveAll = async () => {
				const patch = {};
				for (const e of entries) {
					if (e.type === "object" || e.key.includes(".")) continue;
					if (e.type === "boolean") {
						const next = switches[e.key];
						if (next !== void 0 && next !== e.value) patch[e.key] = next;
						continue;
					}
					const draft = drafts[e.key];
					if (draft === void 0 || draft === (e.value === void 0 ? "" : String(e.value))) continue;
					patch[e.key] = e.type === "number" ? Number(draft) : draft === "" ? void 0 : draft;
				}
				if (Object.keys(patch).length === 0) return;
				setBusy(true);
				setError(void 0);
				try {
					await saveConfigPatch(patch);
					setDone(true);
					setDrafts({});
					setSwitches({});
					props.onSaved();
				} catch (saveError) {
					setError(saveError);
				} finally {
					setBusy(false);
				}
			};
			const [showAdvanced, setShowAdvanced] = (0, react.useState)(false);
			return (0, react.createElement)("div", null, (0, react.createElement)("p", { style: muted }, t("configHint")), toplevel.map((e) => renderRow(e)), advanced.length > 0 ? (0, react.createElement)("div", { style: { marginTop: "8px" } }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				size: "sm",
				variant: "ghost",
				onClick: () => setShowAdvanced((v) => !v)
			}, `${showAdvanced ? "▾" : "▸"} ${t("advanced")}`), showAdvanced ? advanced.map((e) => renderRow(e)) : null) : null, (0, react.createElement)("div", { style: actions }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				size: "sm",
				disabled: !dirty || busy,
				onClick: () => void saveAll()
			}, busy ? t("saving") : t("saveConfig")), done && !dirty ? (0, react.createElement)("span", { style: muted }, t("saved")) : null, error !== void 0 ? (0, react.createElement)(ErrorLine, {
				error,
				lang: props.lang
			}) : null));
		}
		/** The section: one fetch, three views. */
		function ParamsSection(props) {
			const lang = props.lang === "zh" ? "zh" : "en";
			const t = (0, react.useMemo)(() => translate(lang === "zh" ? zh : en), [lang]);
			const [payload, setPayload] = (0, react.useState)(void 0);
			const [error, setError] = (0, react.useState)(void 0);
			const [view, setView] = (0, react.useState)("groups");
			const refresh = (0, react.useCallback)(() => {
				fetchParams().then((p) => {
					setPayload(p);
					setError(void 0);
				}).catch((e) => setError(e));
			}, []);
			(0, react.useEffect)(() => {
				refresh();
			}, [refresh]);
			if (error !== void 0) return (0, react.createElement)("div", { style: baseText }, (0, react.createElement)("p", { style: {
				color: "var(--dsw-alias-state-error-primary, crimson)",
				whiteSpace: "pre-wrap"
			} }, renderError(error, lang).text), (0, react.createElement)("p", { style: muted }, error.message), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				size: "sm",
				onClick: refresh
			}, t("retry")));
			if (payload === void 0) return (0, react.createElement)("p", { style: {
				...baseText,
				...muted
			} }, t("loading"));
			const tabs = [
				{
					value: "groups",
					label: t("viewGroups"),
					id: `${NS$1}-groups`,
					panelId: `${NS$1}-groups-panel`
				},
				{
					value: "packs",
					label: t("viewPacks"),
					id: `${NS$1}-packs`,
					panelId: `${NS$1}-packs-panel`
				},
				{
					value: "config",
					label: t("viewConfig"),
					id: `${NS$1}-config`,
					panelId: `${NS$1}-config-panel`
				}
			];
			return (0, react.createElement)("div", {
				className: `${NS$1}-section`,
				style: baseText
			}, (0, react.createElement)("h3", { style: {
				margin: "0 0 4px",
				...baseText,
				fontWeight: 600
			} }, t("title")), (0, react.createElement)("p", { style: {
				...muted,
				margin: "0 0 8px"
			} }, t("intro")), (0, react.createElement)("div", { style: { margin: "8px 0 12px" } }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.SegmentedTabs, {
				items: [...tabs],
				value: view,
				onChange: (v) => setView(v),
				label: t("title")
			})), view === "groups" ? (0, react.createElement)(GroupsView, {
				payload,
				t,
				lang,
				resolveText: props.resolveText,
				onSaved: refresh
			}) : null, view === "packs" ? (0, react.createElement)(PacksView, {
				payload,
				t,
				lang,
				resolveText: props.resolveText,
				onSaved: refresh
			}) : null, view === "config" ? (0, react.createElement)(ConfigView, {
				payload,
				t,
				lang,
				resolveText: props.resolveText,
				onSaved: refresh
			}) : null);
		}
		//#endregion
		//#region src/client/index.tsx
		/**
		* docwright params UI client half: registers the params maintenance views on
		* the two seats the 0.1.7+ slot contract offers third-party bundles —
		* `settings.plugins.tab` (a tab beside 通用/模型/内置插件 in the Settings
		* dialog) and `plugins.bundle.config` (the configuration card on the
		* bundle's own Plugins page). Both seats are reached through `slots.inject`,
		* which waits for the slot to exist: a host that never declares one never
		* runs its registration (dsh-market's detection pattern — no version
		* strings). The old `settings.section` seat is NOT registered: 0.2.1's
		* declaration table rejects it ("slot is not declared") and the section
		* never renders.
		*
		* Built by tsdown into the __ModuleLoader__ factory bundle at client/client.js;
		* externals resolve through the loader's module table. Containment follows
		* dsh-market's lesson: a throw inside the host's client bootstrap takes the
		* whole app down, so each mounting is wrapped and a failure costs this
		* section for the session, never the shell.
		*/
		const NS = "docwright-params";
		/** The bundle's package name — the key `plugins.bundle.config` is contracted to. */
		const PACKAGE_NAME = "@sharework-ai/dsh-docwright";
		/** Primitives this bundle requires that older hosts may lack. */
		const REQUIRED_PRIMITIVES = [
			"Button",
			"Input",
			"Pill",
			"SegmentedTabs",
			"Switch"
		];
		function missingPrimitives(mod) {
			return REQUIRED_PRIMITIVES.filter((name) => mod[name] === void 0);
		}
		const name = "docwright-params";
		const inject = ["slots", "locale"];
		function apply(ctx) {
			const gaps = missingPrimitives(_deepseek_ai_dsh_client_ui_primitives);
			if (gaps.length > 0) {
				console.warn(`[docwright] host ui-primitives missing ${gaps.join(", ")} — params section disabled (newer dsh web required)`);
				return;
			}
			try {
				mountSection(ctx);
			} catch (error) {
				console.error("[docwright] params section failed to mount; the rest of the app is unaffected.", error);
			}
		}
		function mountSection(ctx) {
			let lang = ctx.locale.getSnapshot().active === "zh" ? "zh" : "en";
			ctx.locale.subscribe(() => {
				lang = ctx.locale.getSnapshot().active === "zh" ? "zh" : "en";
			});
			const label = () => lang === "zh" ? "Docwright 参数" : "Docwright params";
			const resolveText = (value) => {
				if (typeof ctx.locale.resolveText === "function") return ctx.locale.resolveText(value);
				return resolveLocalized(value, lang);
			};
			ctx.slots.inject("settings.plugins.tab", () => {
				const off = ctx.slots.register({
					name: "settings.plugins.tab",
					id: NS,
					order: 60,
					label,
					locale: NS,
					inject: () => ({ lang })
				}, () => (0, react.createElement)(ParamsSection, {
					lang,
					resolveText
				}));
				ctx.effect(() => () => {
					if (typeof off === "function") off();
				}, "docwright: settings tab");
			});
			ctx.slots.inject("plugins.bundle.config", () => {
				const off = ctx.slots.register({
					name: "plugins.bundle.config",
					key: PACKAGE_NAME,
					locale: NS,
					inject: () => ({ lang })
				}, (owner = {}) => owner.view === "summary" ? null : (0, react.createElement)(ParamsSection, {
					lang,
					resolveText
				}));
				ctx.effect(() => () => {
					if (typeof off === "function") off();
				}, "docwright: bundle config card");
			});
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.missingPrimitives = missingPrimitives;
		exports.name = name;
		return module.exports;
	}
});
