/**
 * The "keyboard shortcuts" help panel — what a host's toolbar Help button opens, and what `F1` opens
 * from the keyboard. A CM6 `Panel` (same primitive `quickSearch.ts` uses) docked to the top of the
 * editor, so it needs no dialog/overlay system from the host and works identically in both.
 *
 * `GCODE_EDITOR_SHORTCUTS` is a hand-kept table, not something derived from the installed keymaps
 * (CM6 keymaps carry no descriptions), so `test/shortcutsHelp.test.ts` cross-checks every entry that
 * maps onto a CM6 binding against the REAL `defaultKeymap`/`searchKeymap`/`historyKeymap`/
 * `completionKeymap` — a CM6 upgrade that moves a key fails a test instead of silently leaving the
 * help wrong. Keys are written CM6-style (`Mod-` = Ctrl, or Cmd on a Mac) and rendered per platform.
 */

import { EditorView, keymap, showPanel, type Panel, type PanelConstructor } from "@codemirror/view";
import { Prec, StateEffect, StateField, type Extension } from "@codemirror/state";

export interface ShortcutEntry {
	/** Stable id, so a host can hide the ones it has not wired (see `OpenShortcutsHelpOptions.hide`). */
	readonly id: string;
	/** CM6-style key name: `Mod-f`, `Shift-Alt-ArrowUp`, `F4`. `Mod` is Ctrl (Cmd on a Mac). */
	readonly keys: string;
	/** The Mac spelling when it differs from `keys` (e.g. select-line is `Alt-l` elsewhere, `Ctrl-l` there). */
	readonly mac?: string;
	readonly description: string;
}

export interface ShortcutGroup {
	readonly title: string;
	readonly entries: ReadonlyArray<ShortcutEntry>;
}

export const GCODE_EDITOR_SHORTCUTS: ReadonlyArray<ShortcutGroup> = [
	{
		title: "G-code",
		entries: [
			{ id: "quickSearch", keys: "F4", description: "Find a G/M-code (or, inside { }, an object-model path) and insert it" },
			{ id: "completion", keys: "Ctrl-Space", description: "Show completions (codes and parameter letters)" },
			{ id: "toggleComment", keys: "Mod-/", description: "Comment / uncomment the selected lines (;)" },
			{ id: "blockComment", keys: "Shift-Alt-a", mac: "Shift-Ctrl-a", description: "Comment the selection (; on each line)" },
		],
	},
	{
		title: "Find",
		entries: [
			{ id: "find", keys: "Mod-f", description: "Find and replace" },
			{ id: "findNext", keys: "F3", description: "Find next (also Ctrl+G)" },
			{ id: "findPrevious", keys: "Shift-F3", description: "Find previous (also Ctrl+Shift+G)" },
			{ id: "selectNextOccurrence", keys: "Mod-d", description: "Select the next occurrence of the selected text" },
			{ id: "selectAllMatches", keys: "Shift-Mod-l", description: "Select every match of the search" },
			{ id: "gotoLine", keys: "Mod-Alt-g", description: "Go to line" },
		],
	},
	{
		title: "Editing",
		entries: [
			{ id: "undo", keys: "Mod-z", description: "Undo" },
			{ id: "redo", keys: "Mod-y", description: "Redo (also Ctrl+Shift+Z)" },
			{ id: "save", keys: "Mod-s", description: "Save" },
			{ id: "indent", keys: "Tab", description: "Indent (a selection, or insert an indent at the cursor)" },
			{ id: "dedent", keys: "Shift-Tab", description: "Dedent" },
			{ id: "indentMore", keys: "Mod-]", description: "Indent the selected lines" },
			{ id: "indentLess", keys: "Mod-[", description: "Dedent the selected lines" },
			{ id: "moveLine", keys: "Alt-ArrowUp", description: "Move the line up (Alt+Down: down)" },
			{ id: "copyLine", keys: "Shift-Alt-ArrowUp", description: "Copy the line up (Shift+Alt+Down: down)" },
			{ id: "deleteLine", keys: "Shift-Mod-k", description: "Delete the line" },
			{ id: "insertBlankLine", keys: "Mod-Enter", description: "Insert a blank line below" },
			{ id: "deleteWord", keys: "Mod-Backspace", mac: "Alt-Backspace", description: "Delete the word before the cursor" },
		],
	},
	{
		title: "Selection and cursors",
		entries: [
			{ id: "selectAll", keys: "Mod-a", description: "Select all" },
			{ id: "selectLine", keys: "Alt-l", mac: "Ctrl-l", description: "Select the line" },
			{ id: "selectParent", keys: "Mod-i", description: "Expand the selection to the enclosing bracket / block" },
			{ id: "matchingBracket", keys: "Shift-Mod-\\", description: "Jump to the matching bracket" },
			{ id: "cursorAbove", keys: "Mod-Alt-ArrowUp", description: "Add a cursor above (Ctrl+Alt+Down: below)" },
			{ id: "collapseSelection", keys: "Escape", description: "Collapse multiple cursors / selection to one" },
		],
	},
	{
		title: "Navigation",
		entries: [
			{ id: "docStart", keys: "Mod-Home", mac: "Cmd-ArrowUp", description: "Go to the start of the file (Ctrl+End: the end)" },
			{ id: "wordMove", keys: "Mod-ArrowLeft", mac: "Alt-ArrowLeft", description: "Move by word (Ctrl+Right: forward)" },
			{ id: "tabFocus", keys: "Ctrl-m", description: "Let Tab leave the editor (keyboard-only navigation); press again to restore" },
		],
	},
	{
		title: "Help",
		entries: [
			{ id: "help", keys: "F1", description: "This list" },
		],
	},
];

export interface OpenShortcutsHelpOptions {
	/** `ShortcutEntry.id`s to leave out — e.g. `["save"]` for a host with no save path. */
	readonly hide?: ReadonlyArray<string>;
	/** Force the Mac or non-Mac key spelling; default reads `navigator.platform`. */
	readonly mac?: boolean;
}

function detectMac(): boolean {
	return typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform ?? "");
}

const KEY_LABELS_MAC: Record<string, string> = { Mod: "⌘", Alt: "⌥", Shift: "⇧", Ctrl: "⌃", Cmd: "⌘" };
const KEY_LABELS_OTHER: Record<string, string> = { Mod: "Ctrl" };
const KEY_NAMES: Record<string, string> = {
	ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Backspace: "Backspace", Escape: "Esc", " ": "Space",
};

/** `Mod-Shift-f` -> `["Ctrl", "Shift", "F"]` (or `["⌘", "⇧", "F"]` on a Mac). Exported for a host that
 *  wants to show one binding elsewhere (e.g. in a button tooltip). */
export function formatShortcutKeys(keys: string, mac: boolean = detectMac()): Array<string> {
	const table = mac ? KEY_LABELS_MAC : KEY_LABELS_OTHER;
	// "Shift-\\" and "Mod--" style keys: a trailing "-" or the key itself may be a literal dash, but no
	// entry uses one, so a plain split is exact for every key in this table.
	return keys.split("-").map((part) => {
		const named = KEY_NAMES[part];
		if (named !== undefined) return named;
		return table[part] ?? (part.length === 1 ? part.toUpperCase() : part);
	});
}

const setShortcutsPanel = StateEffect.define<PanelConstructor | null>();

const shortcutsPanelState = StateField.define<PanelConstructor | null>({
	create: () => null,
	update(value, tr) {
		for (const effect of tr.effects) if (effect.is(setShortcutsPanel)) value = effect.value;
		return value;
	},
	provide: (f) => showPanel.from(f, (v) => v),
});

/** True while the help panel is showing. */
export function isShortcutsHelpOpen(view: EditorView): boolean {
	return (view.state.field(shortcutsPanelState, false) ?? null) !== null;
}

export function closeShortcutsHelp(view: EditorView): void {
	if (isShortcutsHelpOpen(view)) view.dispatch({ effects: setShortcutsPanel.of(null) });
}

/** Opens the shortcuts list, or closes it if it is already open (so a toolbar button toggles).
 *  Self-installs its own state field the first time, like `openQuickSearch`/`openSearchPanel`, so a
 *  toolbar button works even if `gcodeShortcutsHelp()` was never added to the editor. */
export function openShortcutsHelp(view: EditorView, options: OpenShortcutsHelpOptions = {}): void {
	if (isShortcutsHelpOpen(view)) {
		closeShortcutsHelp(view);
		view.focus();
		return;
	}
	const make: PanelConstructor = (v) => createPanel(v, options);
	view.dispatch({
		effects: view.state.field(shortcutsPanelState, false) === undefined
			? [StateEffect.appendConfig.of([shortcutsPanelState, shortcutsTheme]), setShortcutsPanel.of(make)]
			: setShortcutsPanel.of(make),
	});
}

function createPanel(view: EditorView, options: OpenShortcutsHelpOptions): Panel {
	const mac = options.mac ?? detectMac();
	const hidden = new Set(options.hide ?? []);

	const dom = document.createElement("div");
	dom.className = "cm-gcodeShortcuts";
	dom.tabIndex = -1;
	dom.setAttribute("role", "dialog");
	dom.setAttribute("aria-label", "Keyboard shortcuts");

	const header = document.createElement("div");
	header.className = "cm-gcodeShortcuts-header";
	const title = document.createElement("span");
	title.className = "cm-gcodeShortcuts-title";
	title.textContent = "Keyboard shortcuts";
	const close = document.createElement("button");
	close.type = "button";
	close.className = "cm-gcodeShortcuts-close";
	close.textContent = "✕";
	close.title = "Close (Esc)";
	close.setAttribute("aria-label", "Close keyboard shortcuts");
	close.addEventListener("click", () => { closeShortcutsHelp(view); view.focus(); });
	header.append(title, close);

	const body = document.createElement("div");
	body.className = "cm-gcodeShortcuts-body";
	for (const group of GCODE_EDITOR_SHORTCUTS) {
		const entries = group.entries.filter((e) => !hidden.has(e.id));
		if (entries.length === 0) continue;
		const section = document.createElement("section");
		section.className = "cm-gcodeShortcuts-group";
		const heading = document.createElement("h4");
		heading.textContent = group.title;
		section.appendChild(heading);
		for (const entry of entries) {
			const row = document.createElement("div");
			row.className = "cm-gcodeShortcuts-row";
			row.dataset.shortcut = entry.id;
			const keys = document.createElement("span");
			keys.className = "cm-gcodeShortcuts-keys";
			for (const part of formatShortcutKeys(mac && entry.mac !== undefined ? entry.mac : entry.keys, mac)) {
				const kbd = document.createElement("kbd");
				kbd.textContent = part;
				keys.appendChild(kbd);
			}
			const description = document.createElement("span");
			description.className = "cm-gcodeShortcuts-desc";
			description.textContent = entry.description;
			row.append(keys, description);
			section.appendChild(row);
		}
		body.appendChild(section);
	}

	dom.append(header, body);
	// Escape works while focus is anywhere inside the panel (the editor's own binding below covers
	// focus being back in the document).
	dom.addEventListener("keydown", (e) => {
		if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeShortcutsHelp(view); view.focus(); }
	});

	return { dom, top: true, mount() { dom.focus(); } };
}

const shortcutsTheme = EditorView.baseTheme({
	".cm-gcodeShortcuts": { padding: "6px 10px", maxHeight: "50vh", overflowY: "auto", outline: "none" },
	".cm-gcodeShortcuts-header": { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" },
	".cm-gcodeShortcuts-title": { fontWeight: "bold" },
	".cm-gcodeShortcuts-close": { cursor: "pointer", background: "none", border: "none", color: "inherit", font: "inherit", padding: "0 6px" },
	".cm-gcodeShortcuts-body": { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(22em, 1fr))", gap: "4px 20px" },
	".cm-gcodeShortcuts-group h4": { margin: "6px 0 2px", opacity: "0.75", fontSize: "0.9em", textTransform: "uppercase" },
	".cm-gcodeShortcuts-row": { display: "flex", gap: "10px", padding: "1px 0", alignItems: "baseline" },
	".cm-gcodeShortcuts-keys": { flex: "0 0 10em", display: "flex", gap: "3px", flexWrap: "wrap" },
	".cm-gcodeShortcuts-keys kbd": {
		fontFamily: "inherit", fontSize: "0.85em", padding: "0 5px", borderRadius: "3px",
		border: "1px solid currentColor", opacity: "0.85",
	},
	".cm-gcodeShortcuts-desc": { flex: "1", minWidth: "0" },
});

/**
 * `F1` opens/closes the list; `Escape` closes it from the document too. `preventDefault` stops the
 * browser's own help page opening on F1. Bundles the panel's theme, like `gcodeQuickSearchKeymap`.
 */
export function gcodeShortcutsHelp(options: OpenShortcutsHelpOptions = {}): Extension {
	return [
		shortcutsPanelState,
		shortcutsTheme,
		// Prec.high: the base keymap's Escape (`simplifySelection`) claims the key whenever there is a
		// selection, which would leave the panel open.
		Prec.high(keymap.of([
			{ key: "F1", preventDefault: true, run: (view) => { openShortcutsHelp(view, options); return true; } },
			// Only claims Escape while the panel is open, so search/completion/selection keep theirs.
			{ key: "Escape", run: (view) => { if (!isShortcutsHelpOpen(view)) return false; closeShortcutsHelp(view); return true; } },
		])),
	];
}
