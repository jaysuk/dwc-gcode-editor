/**
 * Real find/replace — `@codemirror/search`'s own default UI (a bottom-docked panel: find/replace
 * fields, case/regex/whole-word toggles, "replace"/"replace all"), NOT Monaco's F4 "jump to
 * code/expression" quick-picker (`@duet3d/monacotokens`'s `duet.searchGcode` action, the thing
 * `MonacoEditor.vue`'s own `mdi-tag-search` toolbar button actually calls). That is a materially
 * different, larger feature — a cursor-anchored overlay listing every G/M-code, or, inside a
 * `{expression}`, the machine's live object model flattened into searchable paths — deferred for the
 * same reason `completion.ts`'s own doc comment already defers object-model-aware axis completion: it
 * needs live machine object-model data this package has never consumed, not just `dwc-gcode-core`'s
 * static dictionary. Plain find/replace is real, missing, table-stakes scope on its own; the F4
 * overlay is separate, later work.
 *
 * `openSearchPanel` is re-exported directly (rather than leaving a host add its own
 * `@codemirror/search` dependency just for this one `Command`) so a toolbar "Search" button is a
 * single import from this package — the same shape `editorCore.ts`'s `saveKeymap` already gives a
 * host for `Mod-s`.
 */

import { search, searchKeymap, openSearchPanel } from "@codemirror/search";
import { keymap } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

export { openSearchPanel };

/**
 * Find/replace UI plus `@codemirror/search`'s own default keybindings — `Mod-f` opens the panel,
 * `F3`/`Mod-g` find next, `Shift-F3`/`Shift-Mod-g` find previous, `Mod-Alt-g` go to line, `Mod-d`
 * select next occurrence (the full list is `searchKeymap`'s own doc comment in the installed
 * `@codemirror/search` package).
 *
 * Opt-in, not folded into `editorCore.ts`'s always-on `BASE_EDITING_EXTENSIONS` — matching
 * `gcodeCompletion()`/`gcodeLintUi()`'s own precedent for a feature a host explicitly opts into,
 * unlike undo/redo or comment-toggling. `search()` also changes the editor's own DOM shape once
 * opened (it reserves panel space at the bottom of the view), which is exactly the kind of default-
 * appearance change `editingExtras.ts`'s own module doc comment already treats as opt-in-only.
 */
export function gcodeSearch(): Extension {
	return [search(), keymap.of(searchKeymap)];
}
