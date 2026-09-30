/**
 * One setting - "how many spaces is a tab" - and everything that follows from it, plus the show/hide
 * whitespace toggle a host puts on its toolbar.
 *
 * **Tab width** (`DEFAULT_TAB_WIDTH` = 4, host-configurable via `createIndentationController`) drives
 * three things at once, so they cannot disagree:
 *  - the `Tab` key (`editorCore.ts`'s `indentOrInsertTab`, and `indentMore`/`indentLess` for a selection)
 *    all insert/remove the state's `indentUnit`, which is set here to that many SPACES - never a tab
 *    character;
 *  - `EditorState.tabSize`, so a tab already in a file is DRAWN that wide;
 *  - `convertTabsToSpaces`/`tabsToSpaces`, which a host runs when it saves.
 *
 * `editorCore.ts` installs the default (4) at the lowest precedence, so an editor whose host never
 * configures anything still gets 4-space indents rather than CM6's own 2, and any configured width wins.
 */

import { Compartment, EditorState, Prec, type Extension } from "@codemirror/state";
import { indentUnit } from "@codemirror/language";
import { highlightTrailingWhitespace, highlightWhitespace, type EditorView } from "@codemirror/view";

export const DEFAULT_TAB_WIDTH = 4;
export const MIN_TAB_WIDTH = 1;
export const MAX_TAB_WIDTH = 16;

/** A usable tab width from anything a settings store or a hand-edited file might hold: a whole number
 *  within `MIN_TAB_WIDTH`..`MAX_TAB_WIDTH`, else `DEFAULT_TAB_WIDTH` (a number outside the range is
 *  clamped, not discarded - `99` almost certainly means "as wide as allowed", not "I never chose"). */
export function normaliseTabWidth(value: unknown): number {
	const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
	if (typeof n !== "number" || !Number.isFinite(n)) return DEFAULT_TAB_WIDTH;
	return Math.min(MAX_TAB_WIDTH, Math.max(MIN_TAB_WIDTH, Math.round(n)));
}

/** The extensions that make `width` the tab width: indent unit (what Tab inserts) and drawn width. */
export function gcodeIndentation(width: number = DEFAULT_TAB_WIDTH): Extension {
	const w = normaliseTabWidth(width);
	return [indentUnit.of(" ".repeat(w)), EditorState.tabSize.of(w)];
}

/** What `editorCore.ts` installs so an unconfigured editor still indents by 4 spaces. Lowest precedence:
 *  `indentUnit`'s combine takes the FIRST value, so anything a host adds must sort ahead of this. */
export const DEFAULT_INDENTATION: Extension = Prec.lowest(gcodeIndentation(DEFAULT_TAB_WIDTH));

export interface IndentationController {
	/** Include once among the extensions passed to `createEditorInstance`. */
	readonly extension: Extension;
	/** The width currently in force in this controller's view. */
	readonly tabWidth: number;
	/** Change the width live - the Tab key, the drawn width of existing tabs and the indent guides follow
	 *  at once; the document, selection and undo history are untouched. */
	setTabWidth(view: EditorView, width: number): void;
}

/** A tab width a host can change reactively. One controller belongs to exactly one `EditorView` (a
 *  `Compartment` is bound to one), like `createThemeController`. */
export function createIndentationController(initialWidth: number = DEFAULT_TAB_WIDTH): IndentationController {
	const compartment = new Compartment();
	let width = normaliseTabWidth(initialWidth);
	return {
		extension: compartment.of(gcodeIndentation(width)),
		get tabWidth() {
			return width;
		},
		setTabWidth(view, next) {
			width = normaliseTabWidth(next);
			view.dispatch({ effects: compartment.reconfigure(gcodeIndentation(width)) });
		},
	};
}

export interface WhitespaceController {
	readonly extension: Extension;
	readonly shown: boolean;
	/** Show (dots for spaces, arrows for tabs, trailing whitespace highlighted) or hide, live. */
	setShown(view: EditorView, shown: boolean): void;
	/** Flip it and return the new state - what a toolbar button calls. */
	toggle(view: EditorView): boolean;
}

/** The show/hide-whitespace toggle: `editingExtras.ts`'s `gcodeWhitespaceRendering()` behind a
 *  `Compartment`, so it can be switched without recreating the view. Off unless `initiallyShown`. */
export function createWhitespaceController(initiallyShown = false): WhitespaceController {
	const compartment = new Compartment();
	let shown = initiallyShown;
	const current = (): Extension => (shown ? [highlightWhitespace(), highlightTrailingWhitespace()] : []);
	const controller: WhitespaceController = {
		extension: compartment.of(current()),
		get shown() {
			return shown;
		},
		setShown(view, next) {
			shown = next;
			view.dispatch({ effects: compartment.reconfigure(current()) });
		},
		toggle(view) {
			controller.setShown(view, !shown);
			return shown;
		},
	};
	return controller;
}

/**
 * `line` (no line break in it) with every tab replaced by spaces.
 *  - The line's LEADING whitespace keeps its visual width: a tab advances to the next multiple of
 *    `width`, so `"\tG1"` becomes 4 spaces and `"  \tG1"` also becomes 4 (a tab after two spaces only
 *    reaches the next stop), which is what the file looked like.
 *  - A tab anywhere else on the line becomes exactly `width` spaces - "1 tab = N spaces" - EXCEPT inside
 *    a quoted string, where a tab is the string's content (`echo "a<TAB>b"`) and is left alone. A
 *    comment (`;` outside a quote to the end of the line) is converted; its quotes mean nothing.
 */
export function lineTabsToSpaces(line: string, width: number = DEFAULT_TAB_WIDTH): string {
	if (!line.includes("\t")) return line;
	const w = normaliseTabWidth(width);
	let out = "";
	let col = 0;
	let i = 0;
	for (; i < line.length && (line[i] === " " || line[i] === "\t"); i++) {
		const n = line[i] === "\t" ? w - (col % w) : 1;
		out += " ".repeat(n);
		col += n;
	}
	const gap = " ".repeat(w);
	let inQuote = false;
	let inComment = false;
	for (; i < line.length; i++) {
		const ch = line[i];
		if (ch === "\t" && !inQuote) out += gap;
		else {
			if (!inComment) {
				if (ch === '"') inQuote = !inQuote;
				else if (ch === ";" && !inQuote) inComment = true;
			}
			out += ch;
		}
	}
	return out;
}

/** `text` with tabs converted line by line (see `lineTabsToSpaces`); line breaks are kept as they are. */
export function tabsToSpaces(text: string, width: number = DEFAULT_TAB_WIDTH): string {
	if (!text.includes("\t")) return text;
	return text.replace(/[^\r\n]+/g, (line) => lineTabsToSpaces(line, width));
}

/**
 * Converts the tabs in a document to spaces, in place, as ONE undoable edit that touches only the lines
 * that contain a tab (so the cursor, scroll position and every other line's diagnostics are undisturbed,
 * and a 200 MB file with no tabs costs one scan). A host calls this just before it reads the document to
 * save, so what reaches the card and what the editor shows are the same text. Returns whether anything
 * changed; a read-only document is left alone.
 */
export function convertTabsToSpaces(view: EditorView, width: number = DEFAULT_TAB_WIDTH): boolean {
	const { state } = view;
	if (state.readOnly) return false;
	const changes: Array<{ from: number; to: number; insert: string }> = [];
	let pos = 0;
	for (const line of state.doc.iterLines()) {
		if (line.includes("\t")) changes.push({ from: pos, to: pos + line.length, insert: lineTabsToSpaces(line, width) });
		pos += line.length + 1;
	}
	if (changes.length === 0) return false;
	view.dispatch({ changes });
	return true;
}
