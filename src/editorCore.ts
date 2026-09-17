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

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorState, Text, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

/**
 * Undo/redo history plus CM6's standard editing keybindings (word/line navigation, indent,
 * delete-word, etc.) — `createEditorInstance` always includes this, unconditionally, because CM6
 * ships none of it by default the way Monaco does. Found missing from every consumer built so far
 * (`duet-gcode-postprocessor`'s `GcodeEditor.vue`, `Flexible-Layouts`' `GcodeCmEditor.vue`, this
 * package's own demo) - Ctrl+Z silently did nothing in all three. Fixing it here, once, in the
 * thing every consumer already goes through, closes it everywhere at once and makes the same class
 * of bug structurally hard to reintroduce for a future consumer.
 */
const BASE_EDITING_EXTENSIONS: ReadonlyArray<Extension> = [
	history(),
	keymap.of([...defaultKeymap, ...historyKeymap]),
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
		extensions: [...BASE_EDITING_EXTENSIONS, ...(options.extensions ?? [])],
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
