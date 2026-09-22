/**
 * Pure, host-agnostic data helpers behind the F4 quick-picker (`quickSearch.ts`) — the actual feature
 * `MonacoEditor.vue`'s `mdi-tag-search` toolbar button calls (`@duet3d/monacotokens`'s
 * `duet.searchGcode` action), NOT plain find/replace (`search.ts`'s `gcodeSearch()`, already shipped).
 * Two modes: search G/M-codes by code or description, or search the machine's live object-model paths
 * plus locally declared `var`/`global` names — the action switches between them based on whether the
 * cursor sits inside a `{...}` expression (or other expression-carrying context).
 */

import { EditorView } from "@codemirror/view";
import { lexLine } from "dwc-gcode-core";
import { COMMANDS } from "dwc-gcode-core/dictionary/commands";

/** One row of either quick-search list. `detail` is the right-hand description column, present for
 *  G/M-codes and omitted for object-model paths (matching `@duet3d/monacotokens`'s own two overlay
 *  variants — one has a description column, the other is bare paths). */
export interface QuickSearchEntry {
	/** What gets inserted into the document when this entry is accepted. */
	insertText: string;
	/** Left-hand, bold column. */
	label: string;
	/** Right-hand, dimmed column — omitted for object-model paths. */
	detail?: string;
}

/** Every G/M-code in `dwc-gcode-core`'s dictionary, as quick-search entries — the real, cited
 *  dictionary this package already uses for completion/diagnostics, not `@duet3d/monacotokens`'s own
 *  separate `gcodeData` table. */
export function gcodeQuickSearchEntries(): ReadonlyArray<QuickSearchEntry> {
	return Object.values(COMMANDS).map((spec) => ({ insertText: spec.code, label: spec.code, detail: spec.summary }));
}

/**
 * Detect whether the cursor sits inside an RRF expression context — ported faithfully from
 * `@duet3d/monacotokens`'s `providers.ts` `isInsideExpression` (same algorithm, `beforeCursor`-only,
 * verified against its real compiled source rather than re-derived): inside a balanced-but-still-open
 * `{...}` span, OR after an `=` on a `set|var|global` line, OR after `if|elif|while`, OR after
 * `echo|abort` (both take a bare expression, no braces required). `dwc-gcode-core`'s own `lexLine`
 * doesn't currently expose an equivalent "is this position expression territory" query directly (its
 * `kind: "expression"` param spans only cover already-braced values, not a bare `if`/`set` condition),
 * so this is ported rather than derived from it — a real, working, already-shipped algorithm.
 */
export function isInsideExpression(beforeCursor: string): boolean {
	let depth = 0;
	let inString = false;
	for (let i = 0; i < beforeCursor.length; i++) {
		const ch = beforeCursor[i];
		if (inString) {
			if (ch === "\"") inString = false;
			continue;
		}
		if (ch === "\"") inString = true;
		else if (ch === "{") depth++;
		else if (ch === "}" && depth > 0) depth--;
	}
	if (depth > 0) return true;
	if (/^\s*(if|elif|while)\s/.test(beforeCursor)) return true;
	if (/^\s*(set|var|global)\s+[A-Za-z_.][A-Za-z0-9_.]*\s*=/.test(beforeCursor)) return true;
	if (/^\s*(echo|abort)\s+/.test(beforeCursor)) return true;
	return false;
}

/**
 * Flatten an object-model snapshot into dotted paths, `[0]` standing in for every array (one
 * representative element, not one path per item — the machine's real model can have many tools/axes,
 * and this keeps the list from exploding on a big machine). Ported faithfully from
 * `@duet3d/monacotokens`'s `providers.ts` `flattenObjectModel` — already generic over `unknown` there
 * (no DWC/`@duet3d/objectmodel` types involved), which is exactly why this package can port it without
 * taking on a machine-object-model dependency itself: a host passes its own live model in as plain
 * `unknown`, this package never needs to know its shape.
 */
export function flattenObjectModel(root: unknown): ReadonlyArray<string> {
	if (root === null || typeof root !== "object") return [];
	const paths: Array<string> = [];
	const visited = new WeakSet<object>();
	function walk(value: unknown, prefix: string): void {
		if (value === null || typeof value !== "object" || visited.has(value)) return;
		visited.add(value);
		if (Array.isArray(value)) {
			if (value.length > 0) walk(value[0], `${prefix}[0]`);
			return;
		}
		for (const key of Object.keys(value)) {
			if (key.startsWith("_")) continue;
			const child = (value as Record<string, unknown>)[key];
			const path = prefix.length > 0 ? `${prefix}.${key}` : key;
			paths.push(path);
			if (child !== null && typeof child === "object") walk(child, path);
		}
	}
	walk(root, "");
	return paths;
}

/**
 * Locally declared `var`/`global` names in the current document, as `var.<name>`/`global.<name>`
 * entries ready to merge into the object-model path list — mirrors `@duet3d/monacotokens`'s own
 * `getLocalVariables`. Deliberately NOT a continuously-debounced background scanner the way that
 * package's version is (`attachLocalVariableScanner`, a 250ms-debounced rescan on every keystroke):
 * this package's own established rule is no background cost for a manual, on-demand action (the same
 * reasoning `diagnostics.ts` gives for never auto-linting) — scanned fresh, once, when the quick-picker
 * opens. Uses `lexLine`'s own `meta` field to confirm a line really is a `var`/`global` declaration by
 * RRF's real recognition rule (case-sensitive, properly terminated - see `metaKeywordOf`'s own doc
 * comment) before extracting the declared name, rather than a bare regex that could also match inside
 * a comment or string.
 */
export function localVariableNames(doc: { lines: number; line(n: number): { text: string } }): ReadonlyArray<string> {
	const declRegex = /^\s*(?:var|global)\s+([A-Za-z_]\w*)/;
	const names: Array<string> = [];
	for (let n = 1; n <= doc.lines; n++) {
		const text = doc.line(n).text;
		const lexed = lexLine(text);
		if (lexed.meta !== "var" && lexed.meta !== "global") continue;
		const m = declRegex.exec(text);
		if (m !== null) names.push(`${lexed.meta}.${m[1]}`);
	}
	return names;
}

/**
 * Object-model paths + local variable names, deduplicated and sorted — mirrors
 * `@duet3d/monacotokens`'s own `showObjectModelSearch`'s `allPaths` Set. `objectModel` is optional and
 * generic (`unknown`): omit it to offer only local `var`/`global` names, e.g. before a host has wired
 * up its live machine model.
 */
export function expressionQuickSearchEntries(view: EditorView, objectModel?: unknown): ReadonlyArray<QuickSearchEntry> {
	const all = new Set<string>();
	if (objectModel !== undefined) for (const p of flattenObjectModel(objectModel)) all.add(p);
	for (const n of localVariableNames(view.state.doc)) all.add(n);
	return Array.from(all).sort().map((path) => ({ insertText: path, label: path }));
}
