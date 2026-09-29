/**
 * The F4 code/expression quick-picker — a CM6 `Panel` (the same primitive `search.ts`'s own
 * `gcodeSearch()` wraps via `@codemirror/search`), not a hand-rolled cursor-anchored overlay widget
 * the way `@duet3d/monacotokens`'s `showGcodeSearch`/`showObjectModelSearch` are. A `Panel` docks to
 * the top of the editor (full width) rather than floating near the caret — a deliberate UX difference
 * from Monaco's version, chosen because `Panel` is this package's real, already-shipped CM6-native
 * mechanism for exactly this shape of UI (a text field driving a live-filtered list, dismissed on
 * accept/Escape), where a cursor-anchored overlay would need a second, bespoke positioning system this
 * package doesn't otherwise have. Revisit if cursor-anchoring turns out to matter in practice.
 *
 * Two entry points, matching `@duet3d/monacotokens`'s own `duet.searchGcode` action: `gcodeQuickSearchKeymap`
 * binds `F4` and picks G/M-code search vs. object-model-path search off `isInsideExpression`, exactly
 * like that action's own `run()`.
 */

import { EditorView, keymap, showPanel, type KeyBinding, type Panel, type PanelConstructor } from "@codemirror/view";
import { StateEffect, StateField, type Extension } from "@codemirror/state";
import {
	expressionQuickSearchEntries, gcodeQuickSearchEntries, isInsideExpression, type QuickSearchEntry,
} from "./quickSearchData.js";

const setQuickSearchPanel = StateEffect.define<PanelConstructor | null>();

const quickSearchState = StateField.define<PanelConstructor | null>({
	create: () => null,
	update(value, tr) {
		for (const effect of tr.effects) if (effect.is(setQuickSearchPanel)) value = effect.value;
		return value;
	},
	provide: (f) => showPanel.from(f, (v) => v),
});

function openQuickSearch(view: EditorView, title: string, entries: ReadonlyArray<QuickSearchEntry>): void {
	view.dispatch({
		effects: view.state.field(quickSearchState, false) === undefined
			? [StateEffect.appendConfig.of(quickSearchState), setQuickSearchPanel.of((v) => createPanel(v, title, entries))]
			: setQuickSearchPanel.of((v) => createPanel(v, title, entries)),
	});
}

/** Closes the quick-picker panel if one is open — bound to Escape inside the panel's own input, and
 *  exported so a host could wire its own dismiss affordance too (e.g. a toolbar toggle). */
export function closeQuickSearch(view: EditorView): void {
	if (view.state.field(quickSearchState, false) !== undefined) {
		view.dispatch({ effects: setQuickSearchPanel.of(null) });
	}
}

/** Opens the G/M-code search panel — `@duet3d/monacotokens`'s `showGcodeSearch`. */
export function openGcodeQuickSearch(view: EditorView): void {
	openQuickSearch(view, "Search G/M-code by code or description", gcodeQuickSearchEntries());
}

/** Opens the object-model path search panel — `@duet3d/monacotokens`'s `showObjectModelSearch`.
 *  `objectModel` is a snapshot taken once, right now, matching that function's own "flattened once on
 *  open" behaviour — pass a fresh value each call if the host wants the latest live model. */
export function openExpressionQuickSearch(view: EditorView, objectModel?: unknown): void {
	openQuickSearch(view, "Search object-model path", expressionQuickSearchEntries(view, objectModel));
}

function createPanel(view: EditorView, title: string, entries: ReadonlyArray<QuickSearchEntry>): Panel {
	const dom = document.createElement("div");
	dom.className = "cm-gcodeQuickSearch";

	const input = document.createElement("input");
	input.type = "text";
	input.placeholder = title;
	input.className = "cm-gcodeQuickSearch-input";
	input.setAttribute("aria-label", title);

	const list = document.createElement("div");
	list.className = "cm-gcodeQuickSearch-list";
	list.setAttribute("role", "listbox");

	// The panel had no dismiss control: Escape only worked while the input still had focus, so after a
	// click elsewhere (or on a toolbar button that opened it) there was no way to get rid of it.
	const closeBtn = document.createElement("button");
	closeBtn.type = "button";
	closeBtn.className = "cm-gcodeQuickSearch-close";
	closeBtn.textContent = "✕";
	closeBtn.title = "Close (Esc)";
	closeBtn.setAttribute("aria-label", "Close search");
	// mousedown is cancelled so pressing the button does not first blur the input (which would close
	// the panel through the focusout handler below, then let the click land on nothing).
	closeBtn.addEventListener("mousedown", (e) => e.preventDefault());
	closeBtn.addEventListener("click", () => { closeQuickSearch(view); view.focus(); });

	const bar = document.createElement("div");
	bar.className = "cm-gcodeQuickSearch-bar";
	bar.append(input, closeBtn);

	dom.append(bar, list);

	let filtered: ReadonlyArray<QuickSearchEntry> = entries;
	let selected = 0;
	let rows: Array<HTMLElement> = [];

	function highlight(): void {
		for (let i = 0; i < rows.length; i++) rows[i]!.classList.toggle("cm-gcodeQuickSearch-row-selected", i === selected);
		rows[selected]?.scrollIntoView({ block: "nearest" });
	}

	function render(): void {
		list.textContent = "";
		rows = [];
		for (let i = 0; i < filtered.length; i++) {
			const entry = filtered[i]!;
			const row = document.createElement("div");
			row.className = "cm-gcodeQuickSearch-row";
			row.setAttribute("role", "option");

			const label = document.createElement("span");
			label.className = "cm-gcodeQuickSearch-label";
			label.textContent = entry.label;
			row.appendChild(label);

			if (entry.detail !== undefined) {
				const detail = document.createElement("span");
				detail.className = "cm-gcodeQuickSearch-detail";
				detail.textContent = entry.detail;
				row.appendChild(detail);
			}

			const index = i;
			row.addEventListener("mouseenter", () => { selected = index; highlight(); });
			row.addEventListener("mousedown", (e) => { e.preventDefault(); selected = index; accept(); });
			list.appendChild(row);
			rows.push(row);
		}
		highlight();
	}

	function filter(query: string): void {
		const q = query.trim().toLowerCase();
		filtered = q.length === 0
			? entries
			: entries.filter((e) => e.label.toLowerCase().includes(q) || (e.detail?.toLowerCase().includes(q) ?? false));
		selected = 0;
		render();
	}

	function accept(): void {
		const choice = filtered[selected];
		close();
		if (choice !== undefined) {
			const sel = view.state.selection.main;
			view.dispatch({
				changes: { from: sel.from, to: sel.to, insert: choice.insertText },
				selection: { anchor: sel.from + choice.insertText.length },
			});
		}
		view.focus();
	}

	function close(): void {
		closeQuickSearch(view);
	}

	input.addEventListener("input", () => filter(input.value));
	// A click on the list's scrollbar must not blur the input (and so close the panel under the user).
	list.addEventListener("mousedown", (e) => e.preventDefault());
	// Focus moving anywhere outside the panel (a click in the document, another toolbar button, Tab)
	// dismisses it, the way a menu does. A window switch also blurs the input but leaves the document
	// without focus, so that case is ignored - the panel is still wanted when the user comes back.
	// `gone` guards the browser's blur-on-removal: CM6 removes the panel's DOM inside a view update, and
	// dispatching from there throws ("Calls to EditorView.update are not allowed while an update is in progress").
	let gone = false;
	dom.addEventListener("focusout", (e) => {
		if (gone) return;
		const next = e.relatedTarget as Node | null;
		if (next !== null && dom.contains(next)) return;
		if (next === null && !document.hasFocus()) return;
		closeQuickSearch(view);
	});
	// Keydown is intercepted here (not left to CM6's own keymap) so ArrowUp/Down/Enter/Escape drive
	// this list instead of moving the document cursor or falling through to another binding.
	input.addEventListener("keydown", (e) => {
		e.stopPropagation();
		switch (e.key) {
			case "ArrowDown": e.preventDefault(); selected = Math.min(selected + 1, filtered.length - 1); highlight(); break;
			case "ArrowUp": e.preventDefault(); selected = Math.max(selected - 1, 0); highlight(); break;
			case "Enter": e.preventDefault(); accept(); break;
			case "Escape": case "F4": e.preventDefault(); close(); view.focus(); break;
			default: break;
		}
	});

	filter("");

	return {
		dom,
		top: true,
		mount() { input.focus(); },
		destroy() { gone = true; },
	};
}

const quickSearchTheme = EditorView.baseTheme({
	".cm-gcodeQuickSearch": { padding: "4px" },
	".cm-gcodeQuickSearch-bar": { display: "flex", gap: "4px", alignItems: "center" },
	".cm-gcodeQuickSearch-input": { boxSizing: "border-box", flex: "1", minWidth: "0", padding: "4px 6px", font: "inherit" },
	".cm-gcodeQuickSearch-close": { cursor: "pointer", background: "none", border: "none", color: "inherit", font: "inherit", padding: "2px 8px" },
	".cm-gcodeQuickSearch-list": { maxHeight: "240px", overflowY: "auto", marginTop: "4px" },
	".cm-gcodeQuickSearch-row": {
		display: "flex", gap: "8px", padding: "3px 8px", cursor: "pointer", whiteSpace: "nowrap",
	},
	".cm-gcodeQuickSearch-row-selected": { background: "#3070c0", color: "#ffffff" },
	".cm-gcodeQuickSearch-label": { fontWeight: "bold", minWidth: "4em" },
	".cm-gcodeQuickSearch-detail": { flex: "1", overflow: "hidden", textOverflow: "ellipsis", opacity: "0.85" },
});

/**
 * `F4` — opens the G/M-code search, or, when the cursor sits inside an expression
 * (`isInsideExpression`), the object-model-path search. Mirrors `@duet3d/monacotokens`'s own
 * `addGcodeSearchAction` exactly (same key, same expression-context switch).
 *
 * `getObjectModel` is a thunk, not a static value, so a host can supply an always-current live machine
 * model without needing to reconfigure this extension every time that model changes (the same pattern
 * `duet-gcode-postprocessor`'s own `lineStateGutter(() => lineIndex)` already uses for live, external
 * data a CM6 extension reads on demand rather than owning). Omit it to offer local `var`/`global`
 * names only.
 */
export function gcodeQuickSearchKeymap(getObjectModel?: () => unknown): Extension {
	const binding: KeyBinding = {
		key: "F4",
		run: (view) => {
			const line = view.state.doc.lineAt(view.state.selection.main.head);
			const beforeCursor = line.text.slice(0, view.state.selection.main.head - line.from);
			if (isInsideExpression(beforeCursor)) {
				openExpressionQuickSearch(view, getObjectModel?.());
			} else {
				openGcodeQuickSearch(view);
			}
			return true;
		},
	};
	return [quickSearchTheme, keymap.of([binding])];
}
