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
		//#region src/client/api.ts
		async function parse(response) {
			let body;
			try {
				body = await response.json();
			} catch {
				throw new Error(`docwright: the server answered HTTP ${response.status} with a non-JSON body; is the docwright plugin loaded?`);
			}
			if (!response.ok) {
				const detail = body.error;
				throw new Error(typeof detail === "string" && detail.length > 0 ? detail : `docwright request failed with HTTP ${response.status}`);
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
			objectBandNote: "value is the generation target; the other keys are validation tolerance (read-only).",
			packsEditNote: "Edit where the value governs: rows marked [managed by ...] are shadowed declarations - they never take effect on the chain; edit the source row instead.",
			bandValue: "target {value}, tolerance band {min}-{max}",
			factorValue: "target {value}, tolerance x{down}-x{up}",
			shadowedNote: "Also declared by {packs} (governed by the source; per-pack spec details in the Packs view).",
			shadowedByNote: "managed by {pack} - never takes effect"
		};
		const zh = {
			nav: "Docwright 参数",
			title: "Docwright 参数",
			intro: "这里维护声明的默认值与插件配置。会话中的值（确认、素材抽取）在对话里，不在这里。",
			viewGroups: "参数",
			viewPacks: "Pack",
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
			objectBandNote: "value 是生成目标；其余键是校验容差（只读）。",
			packsEditNote: "在生效处编辑：标有「由 … 管理」的行是被遮蔽的声明——在链上永不生效，请改生效源行。",
			bandValue: "目标 {value}（容差带 {min}–{max}）",
			factorValue: "目标 {value}（容差 ×{down}–×{up}）",
			shadowedNote: "其余声明：{packs}（由生效源管理；spec 详情见 Pack 视图）。",
			shadowedByNote: "由 {pack} 管理——此处声明不生效"
		};
		function translate(dict) {
			return (key) => {
				const value = dict[key];
				return typeof value === "string" ? value : key;
			};
		}
		//#endregion
		//#region src/client/ParamsSection.tsx
		/**
		* The Docwright params section: three views over one catalog fetch —
		* shared-param groups (the aggregation with effective-source resolution),
		* per-pack flat view, and the plugin Config form. Controls map from the
		* ParamSpec type (number → numeric input, enum → select, boolean → switch,
		* object → JSON-per-value with endpoints read-only); every row carries a
		* hover tooltip with the author's description. Writes go through the
		* plugin's own routes (src/http.ts), never the conversation.
		*/
		const NS$1 = "docwright-params";
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
			fontFamily: "var(--dsw-font-mono, monospace)"
		};
		const desc = {
			color: "var(--dsw-alias-text-secondary, inherit)",
			marginTop: "2px",
			whiteSpace: "pre-wrap",
			wordBreak: "break-word"
		};
		const valueStyle = { fontFamily: "var(--dsw-font-mono, monospace)" };
		const muted = { color: "var(--dsw-alias-text-secondary, inherit)" };
		const group = {
			border: "0.5px solid var(--dsw-alias-border-l4, var(--dsw-alias-settings-card-stroke, transparent))",
			borderRadius: "var(--dsw-radius-xl, 20px)",
			background: "var(--dsw-alias-bg-layer-2, var(--dsw-alias-settings-card-fill, transparent))",
			padding: "12px 16px",
			marginBottom: "12px"
		};
		const card = { ...group };
		const hint = {
			cursor: "help",
			color: "var(--dsw-alias-text-secondary, inherit)",
			border: "1px solid currentColor",
			borderRadius: "50%",
			width: "15px",
			height: "15px",
			fontSize: "10px",
			lineHeight: "13px",
			display: "inline-flex",
			alignItems: "center",
			justifyContent: "center",
			flexShrink: 0,
			userSelect: "none"
		};
		const inputStyle = { width: "160px" };
		const actions = {
			display: "flex",
			gap: "8px",
			alignItems: "center",
			marginTop: "8px"
		};
		/** The "?" affordance with the author's description on hover. */
		function DescriptionHint(props) {
			return (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
				label: props.text,
				side: "bottom",
				maxWidth: 360,
				children: (0, react.createElement)("span", {
					className: `${NS$1}-hint`,
					style: hint,
					"aria-label": props.text
				}, "?")
			});
		}
		/** Fill a {key}-templated locale string. */
		function fill(template, vars) {
			return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
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
		/** Constraint summary under the value: range, choices, and the Mind-the-gap note for object bands. */
		function ConstraintLine(props) {
			const { d, t } = props;
			const bits = [];
			if (d.enumValues !== void 0) bits.push(`${t("choices")}: ${d.enumValues.join(" / ")}`);
			if (d.min !== void 0) bits.push(`${t("min")} ${d.min}`);
			if (d.max !== void 0) bits.push(`${t("max")} ${d.max}`);
			if (d.type === "object") bits.push(t("objectBandNote"));
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
				color: "var(--dsw-alias-text-secondary, inherit)",
				textDecoration: "line-through"
			} }, displayDefault(d, t)), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Pill, {}, fill(t("shadowedByNote"), { pack: d.shadowedBy ?? "" })));
			return (0, react.createElement)(EditSeat, {
				d,
				t,
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
					setError(problem === "outOfRange" ? fill(t("rangeTemplate"), {
						min: String(d.min ?? ""),
						max: String(d.max ?? "")
					}) : t(problem));
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
					setError(saveError.message);
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
					fontFamily: "var(--dsw-font-mono, monospace)"
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
			}, t("cancel")), error !== void 0 ? (0, react.createElement)("span", { style: { color: "var(--dsw-alias-text-critical, crimson)" } }, error) : null));
		}
		/**
		* One aggregated parameter group = ONE card: header carries the name and
		* every group-level invariant (flags, hover description, Mind-the-gap
		* note), one governing row carries the effective value and the edit seat,
		* and the shadowed declarations collapse into a single sentence — their
		* values never take effect (the receipt base outranks them), so rendering
		* them per-card repeated the same text N times and showed misleading
		* never-applied numbers.
		*/
		function ParamGroupCard(props) {
			const { name, declarations, t } = props;
			const governing = declarations.find((d) => d.role === "source") ?? declarations[0];
			const shadowed = declarations.filter((d) => d !== governing);
			const governingPack = (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Pill, {}, governing.pack);
			return (0, react.createElement)("div", { style: group }, (0, react.createElement)("div", { style: rowHead }, (0, react.createElement)("span", { style: nameStyle }, name), (0, react.createElement)(FlagPills, {
				d: governing,
				t
			}), (0, react.createElement)(DescriptionHint, { text: governing.description })), (0, react.createElement)("div", { style: {
				display: "flex",
				alignItems: "center",
				gap: "8px",
				marginTop: "4px"
			} }, (0, react.createElement)("span", { style: muted }, `${t("sources")}:`), governingPack, (0, react.createElement)(ValueRow, {
				d: governing,
				t,
				onSaved: props.onSaved
			})), (0, react.createElement)("div", { style: { marginTop: "4px" } }, (0, react.createElement)(ConstraintLine, {
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
			}), (0, react.createElement)(DescriptionHint, { text: d.description })), (0, react.createElement)(ValueRow, {
				d,
				t,
				onSaved: props.onSaved
			}), (0, react.createElement)("div", { style: { marginTop: "4px" } }, (0, react.createElement)(ConstraintLine, {
				d,
				t
			}))));
		}
		/** Per-pack flat view (pack-author / troubleshooting perspective). */
		function PacksView(props) {
			const { payload, t } = props;
			return (0, react.createElement)("div", null, (0, react.createElement)("p", { style: muted }, t("packsEditNote")), payload.packs.map((p) => (0, react.createElement)("div", {
				key: p.name,
				style: card
			}, (0, react.createElement)("div", { style: rowHead }, (0, react.createElement)("span", { style: nameStyle }, p.name), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Pill, {}, `v${p.version}`), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Pill, {}, p.scope === "workspace" ? t("scopeWorkspace") : t("scopeTopic")), p.paramDriftPolicy !== void 0 ? (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Pill, {}, `${t("driftPolicy")}: ${p.paramDriftPolicy}`) : null), (0, react.createElement)("div", { style: desc }, p.description), p.consumes.length > 0 ? (0, react.createElement)("div", { style: muted }, `${t("consumed")}: ${p.consumes.join(", ")}`) : null, (0, react.createElement)("div", { style: { marginTop: "6px" } }, p.params.length === 0 ? (0, react.createElement)("p", { style: muted }, t("empty")) : p.params.map((d) => (0, react.createElement)(PackDeclRow, {
				key: d.name,
				d,
				t,
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
				} }, (0, react.createElement)("div", { style: rowHead }, (0, react.createElement)("span", { style: nameStyle }, e.key), e.description !== void 0 ? (0, react.createElement)(DescriptionHint, { text: e.description }) : null, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Pill, {}, e.origin === "configured" ? t("configured") : e.value === void 0 ? t("unset") : t("inherited"))), control, e.origin === "default" && e.default !== void 0 && String(e.default) !== String(e.value ?? "") ? (0, react.createElement)("div", { style: muted }, `${t("inherited")}: ${String(e.default)}`) : null));
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
					setError(saveError.message);
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
			}, busy ? t("saving") : t("saveConfig")), done && !dirty ? (0, react.createElement)("span", { style: muted }, t("saved")) : null, error !== void 0 ? (0, react.createElement)("span", { style: { color: "var(--dsw-alias-text-critical, crimson)" } }, error) : null));
		}
		/** The section: one fetch, three views. */
		function ParamsSection(props) {
			const t = (0, react.useMemo)(() => translate(props.lang === "zh" ? zh : en), [props.lang]);
			const [payload, setPayload] = (0, react.useState)(void 0);
			const [error, setError] = (0, react.useState)(void 0);
			const [view, setView] = (0, react.useState)("groups");
			const refresh = (0, react.useCallback)(() => {
				fetchParams().then((p) => {
					setPayload(p);
					setError(void 0);
				}).catch((e) => setError(e.message));
			}, []);
			(0, react.useEffect)(() => {
				refresh();
			}, [refresh]);
			if (error !== void 0) return (0, react.createElement)("div", null, (0, react.createElement)("p", { style: { color: "var(--dsw-alias-text-critical, crimson)" } }, t("loadFailed")), (0, react.createElement)("p", { style: muted }, error), (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				size: "sm",
				onClick: refresh
			}, t("retry")));
			if (payload === void 0) return (0, react.createElement)("p", { style: muted }, t("loading"));
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
			return (0, react.createElement)("div", { className: `${NS$1}-section` }, (0, react.createElement)("h3", { style: { margin: "0 0 4px" } }, t("title")), (0, react.createElement)("p", { style: muted }, t("intro")), (0, react.createElement)("div", { style: { margin: "8px 0 12px" } }, (0, react.createElement)(_deepseek_ai_dsh_client_ui_primitives.SegmentedTabs, {
				items: [...tabs],
				value: view,
				onChange: (v) => setView(v),
				label: t("title")
			})), view === "groups" ? (0, react.createElement)(GroupsView, {
				payload,
				t,
				onSaved: refresh
			}) : null, view === "packs" ? (0, react.createElement)(PacksView, {
				payload,
				t,
				onSaved: refresh
			}) : null, view === "config" ? (0, react.createElement)(ConfigView, {
				payload,
				t,
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
			"Switch",
			"Tooltip"
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
			ctx.slots.inject("settings.plugins.tab", () => {
				const off = ctx.slots.register({
					name: "settings.plugins.tab",
					id: NS,
					order: 60,
					label,
					locale: NS,
					inject: () => ({ lang })
				}, () => (0, react.createElement)(ParamsSection, { lang }));
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
				}, (owner = {}) => owner.view === "summary" ? null : (0, react.createElement)(ParamsSection, { lang }));
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
