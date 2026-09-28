/**
 * One editor instance's lifecycle, with the `flush()` contract `docs/gcode-editor-plan.md` calls
 * for — the fix for the exact gap `Duet3D/DuetWebControl` PR #517's own implementation notes
 * documented for Monaco: *"MonacoEditor's unmount has no unsaved-content flush path — unmounting a
 * dirty editor would silently lose the edits"* (which is why that PR collapses a hidden pane via
 * CSS instead of unmounting it, rather than fixing the real gap).
 *
 * CM6 does not have that gap internally — `view.state.doc` is always the current, correct content,
 * readable at any time before `view.destroy()` is called, no "flush" operation is actually needed to
 * make CM6 itself consistent. The real problem PR #517 hit is a *discipline* one: a host (a Vue
 * component wrapping the editor) must reliably read that content back out into its own data model
 * before the view goes away, and it is easy to accidentally destroy a view without ever doing so.
 * `createEditorInstance`'s `destroy()` makes that impossible to skip: it always calls `onFlush` with
 * the final document first. A host must go through this `destroy()`, never `view.destroy()` directly.
 */

import { defaultKeymap, history, historyKeymap, indentLess, indentMore, toggleComment } from "@codemirror/commands";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { EditorState, Text, type Extension } from "@codemirror/state";
import { indentUnit } from "@codemirror/language";
import { EditorView, keymap, type Command } from "@codemirror/view";
import { gcodeTooltipPlacement } from "./tooltipPlacement.js";

/**
 * Undo/redo history plus CM6's standard editing keybindings (word/line navigation, indent,
 * delete-word, etc.) — `createEditorInstance` always includes this, unconditionally, because CM6
 * ships none of it by default the way Monaco does. Found missing from every consumer built so far
 * (`duet-gcode-postprocessor`'s `GcodeEditor.vue`, `Flexible-Layouts`' `GcodeCmEditor.vue`, this
 * package's own demo) - Ctrl+Z silently did nothing in all three. Fixing it here, once, in the
 * thing every consumer already goes through, closes it everywhere at once and makes the same class
 * of bug structurally hard to reintroduce for a future consumer.
 *
 * `defaultKeymap` (above) already binds `Mod-/` to `toggleComment` and `Shift-Alt-a` to
 * `toggleBlockComment` — those were always live, just inert without `language.ts`'s new
 * `commentTokens` language data. `closeBrackets()` is genuinely new here: unlike undo/redo it is a
 * separate opt-in `@codemirror/autocomplete` extension, not part of `defaultKeymap`, and it only
 * closes what `language.ts`'s `closeBrackets` language data (`{` only) tells it to — see that
 * module's own comment for why.
 *
 * `closeBracketsKeymap` MUST be listed before `defaultKeymap` in the combined array below, not
 * after — verified against `@codemirror/view`'s real `buildKeymap` source (`getKeymap`'s
 * `bindings.reduce((a, b) => a.concat(b), [])` flattens every registered keymap array in order, and
 * `runHandlers`'s `runFor` tries each key's accumulated commands in that same order, first one
 * returning `true` wins). `defaultKeymap`'s own Backspace binding (`deleteCharBackward`) always
 * succeeds when there is a character to delete, so if it were listed first it would permanently mask
 * `closeBracketsKeymap`'s Backspace binding (`deleteBracketPair`, which deletes a whole `{}` pair in
 * one step) — the more specific handler needs first refusal, the same ordering the `codemirror`
 * package's own `basicSetup` uses. Caught via a real teeth check: with the original (wrong) order,
 * every existing test still passed, because none of them exercised Backspace between an auto-closed
 * pair — see `test/editorCore.test.ts`'s own Backspace-pair-delete test, added specifically to close
 * that gap.
 */
/**
 * `Tab` / `Shift-Tab`, which `defaultKeymap` deliberately leaves unbound (CM6 does not trap Tab by
 * default - it is a keyboard-accessibility escape hatch), so with nothing bound a selection could not
 * be indented at all. Matches Monaco: with a selection, `Tab` indents every selected line by one
 * indent unit and `Shift-Tab` dedents them; with a bare cursor, `Tab` inserts one indent unit AT the
 * cursor (unlike `indentWithTab`, which would indent the whole line from mid-line) and `Shift-Tab`
 * dedents the line. Uses the state's `indentUnit` rather than `insertTab`'s hard-coded `"	"`, so a
 * cursor Tab and a selection Tab agree and `gcodeIndentGuides()`'s column counting stays consistent.
 * CM6's own `Ctrl-m` (`toggleTabFocusMode`) and `Escape` still release the trap for keyboard users.
 */
const indentOrInsertTab: Command = (view) => {
	const { state } = view;
	if (state.readOnly) return false;
	if (state.selection.ranges.some((r) => !r.empty)) return indentMore(view);
	view.dispatch(state.update(state.replaceSelection(state.facet(indentUnit)), { scrollIntoView: true, userEvent: "input" }));
	return true;
};

/**
 * `Shift-Alt-a` ("block comment") must do something useful for G-code. `defaultKeymap` binds it to
 * `toggleBlockComment`, which needs a `block` comment token - and RRF has none in its default (FFF)
 * mode: `lexLine` only recognises `(...)` in CNC mode, so wrapping a selection in parentheses would
 * silently corrupt a real printer file (`G1 ( X10 )` is not a comment there). The only comment RRF has
 * is `;` to end of line, so the honest "comment out this selection" is `toggleComment`: `;` on every
 * selected line, and off again. Listed AFTER `defaultKeymap` so a language that does declare a block
 * token (a host running CNC mode) still gets the real block comment first - `toggleBlockComment`
 * returns `false` without one and falls through to here.
 */
const blockCommentFallback = { key: "Alt-A", mac: "Ctrl-A", run: toggleComment };

const BASE_EDITING_EXTENSIONS: ReadonlyArray<Extension> = [
	history(),
	closeBrackets(),
	keymap.of([
		...closeBracketsKeymap,
		{ key: "Tab", run: indentOrInsertTab, shift: indentLess },
		...defaultKeymap,
		blockCommentFallback,
		...historyKeymap,
	]),
];

export interface EditorInstanceOptions {
	doc: Text | string;
	extensions?: ReadonlyArray<Extension>;
	parent: Element;
	/** Called with the editor's current document whenever `flush()` runs — manually, or
	 *  automatically as the first step of `destroy()`. A host MUST rely on this (not a copy of
	 *  `doc` captured at creation time) to persist a tab's final content — see the module doc
	 *  comment for the gap this closes. */
	onFlush?: (doc: Text) => void;
}

export interface EditorInstance {
	readonly view: EditorView;
	/** Read the current document and report it via `onFlush`, without tearing anything down — for
	 *  a host that wants to persist edits periodically (e.g. before an auto-save), not only when
	 *  the instance is about to be destroyed. Returns the document either way, `onFlush` or not. */
	flush(): Text;
	/**
	 * The one correct way to get rid of an instance. Calls `flush()` first (so `onFlush` always
	 * sees the final content, even if the host forgot to call `flush()` itself before this),
	 * then tears down the view. Safe to call more than once — every call after the first is a
	 * no-op, since the view is already gone and re-reading `view.state.doc` after `destroy()` would
	 * throw.
	 */
	destroy(): void;
}

export function createEditorInstance(options: EditorInstanceOptions): EditorInstance {
	const state = EditorState.create({
		doc: options.doc,
		extensions: [...BASE_EDITING_EXTENSIONS, gcodeTooltipPlacement(), ...(options.extensions ?? [])],
	});
	const view = new EditorView({ state, parent: options.parent });
	let destroyed = false;

	function flush(): Text {
		const doc = view.state.doc;
		options.onFlush?.(doc);
		return doc;
	}

	function destroy(): void {
		if (destroyed) return;
		destroyed = true;
		flush();
		view.destroy();
	}

	return { view, flush, destroy };
}

/**
 * A `Mod-s` (Ctrl+S / Cmd+S) keybinding that calls `onSave`, matching Monaco's own real behaviour
 * (`MonacoEditor.vue`'s own comment: registering this as a *keymap* rather than a raw
 * `addEventListener`-style global handler is what keeps it scoped to the editor that currently has
 * focus — CM6's `keymap` facet, like Monaco's `addAction`, only fires while this specific editor
 * instance is focused). `preventDefault: true` stops the browser's own "Save Page As" dialog from
 * opening underneath. `onSave` is fire-and-forget from the keybinding's own point of view — a host
 * whose save is async should not await anything here; it manages its own `saving` state.
 */
export function saveKeymap(onSave: () => void): Extension {
	return keymap.of([{
		key: "Mod-s",
		preventDefault: true,
		run: () => {
			onSave();
			return true;
		},
	}]);
}
