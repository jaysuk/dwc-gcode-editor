import { describe, expect, it } from "vitest";
import { defaultKeymap, historyKeymap } from "@codemirror/commands";
import { searchKeymap } from "@codemirror/search";
import { completionKeymap } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, type KeyBinding } from "@codemirror/view";
import {
	GCODE_EDITOR_SHORTCUTS, closeShortcutsHelp, formatShortcutKeys, gcodeShortcutsHelp, isShortcutsHelpOpen, openShortcutsHelp,
} from "../src/shortcutsHelp";

function mount(extensions: ReadonlyArray<unknown> = [gcodeShortcutsHelp()], doc = "G1 X10\n") {
	const parent = document.createElement("div");
	document.body.appendChild(parent);
	const view = new EditorView({ state: EditorState.create({ doc, extensions: extensions as never }), parent });
	return { view, parent };
}

function press(view: EditorView, key: string): boolean {
	const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
	view.contentDOM.dispatchEvent(ev);
	return ev.defaultPrevented;
}

const allEntries = GCODE_EDITOR_SHORTCUTS.flatMap((g) => g.entries);

describe("GCODE_EDITOR_SHORTCUTS", () => {
	it("has unique ids", () => {
		const ids = allEntries.map((e) => e.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	// Each entry that stands for a CM6 binding must still exist in the installed keymaps, otherwise the
	// help would be listing a key that does nothing.
	const known = new Map<string, ReadonlyArray<KeyBinding>>([
		["undo", historyKeymap], ["redo", historyKeymap],
		["find", searchKeymap], ["findNext", searchKeymap], ["selectNextOccurrence", searchKeymap],
		["selectAllMatches", searchKeymap], ["gotoLine", searchKeymap],
		["selectAll", defaultKeymap], ["selectLine", defaultKeymap], ["selectParent", defaultKeymap],
		["matchingBracket", defaultKeymap], ["cursorAbove", defaultKeymap], ["collapseSelection", defaultKeymap],
		["moveLine", defaultKeymap], ["copyLine", defaultKeymap], ["deleteLine", defaultKeymap],
		["insertBlankLine", defaultKeymap], ["indentMore", defaultKeymap], ["indentLess", defaultKeymap],
		["toggleComment", defaultKeymap], ["deleteWord", defaultKeymap], ["tabFocus", defaultKeymap],
		["docStart", defaultKeymap], ["wordMove", defaultKeymap],
		["completion", completionKeymap],
	]);
	// CM6 matches modifiers in any order (`Shift-Mod-l` is `Mod-Shift-l`), so compare them sorted.
	const norm = (k: string) => {
		const parts = k.toLowerCase().split("-");
		return [...parts.slice(0, -1).sort(), parts[parts.length - 1]].join("-");
	};

	for (const [id, keymapForId] of known) {
		it(`"${id}" is a real binding`, () => {
			const entry = allEntries.find((e) => e.id === id)!;
			expect(entry, id).toBeDefined();
			const bound = keymapForId
				.flatMap((b) => [b.key, b.mac, b.linux, b.win])
				.filter((k): k is string => k !== undefined)
				.map(norm);
			// `Mod-` is Ctrl or Cmd depending on platform, so the CM6 spelling is either `mod-…` or the expansion.
			const spellings = [entry.keys, entry.mac].filter((k): k is string => k !== undefined).map(norm);
			const ok = spellings.some((k) => bound.includes(k) || bound.includes(norm(k.replace("mod-", "cmd-"))) || bound.includes(norm(k.replace("mod-", "ctrl-"))));
			expect(ok, `${id}: ${spellings.join(" / ")} is not bound in the installed CM6 keymap`).toBe(true);
		});
	}

	it("every entry is either checked against a CM6 keymap above or a binding this package makes itself", () => {
		const own = new Set(["quickSearch", "blockComment", "indent", "dedent", "save", "findPrevious", "help"]);
		for (const e of allEntries) {
			expect(known.has(e.id) || own.has(e.id), `${e.id} is neither checked against a keymap nor a known own binding`).toBe(true);
		}
	});
});

describe("formatShortcutKeys", () => {
	it("spells Mod as Ctrl off a Mac and as the command key on one", () => {
		expect(formatShortcutKeys("Mod-Shift-f", false)).toEqual(["Ctrl", "Shift", "F"]);
		expect(formatShortcutKeys("Mod-Shift-f", true)).toEqual(["⌘", "⇧", "F"]);
	});
	it("names arrow keys", () => {
		expect(formatShortcutKeys("Alt-ArrowUp", false)).toEqual(["Alt", "↑"]);
	});
});

describe("the help panel", () => {
	it("F1 opens it, lists the shortcuts, and F1 again closes it", () => {
		const { view, parent } = mount();
		expect(parent.querySelector(".cm-gcodeShortcuts")).toBeNull();
		expect(press(view, "F1")).toBe(true); // default prevented: the browser's own help must not open
		expect(parent.querySelector(".cm-gcodeShortcuts")).not.toBeNull();
		expect(parent.querySelectorAll(".cm-gcodeShortcuts-row").length).toBe(allEntries.length);
		expect(parent.textContent).toContain("Find and replace");
		press(view, "F1");
		expect(parent.querySelector(".cm-gcodeShortcuts")).toBeNull();
		view.destroy();
		parent.remove();
	});

	it("opens from a toolbar-style call even without the extension installed, and toggles", () => {
		const { view, parent } = mount([]);
		openShortcutsHelp(view);
		expect(isShortcutsHelpOpen(view)).toBe(true);
		expect(parent.querySelector(".cm-gcodeShortcuts")).not.toBeNull();
		openShortcutsHelp(view);
		expect(isShortcutsHelpOpen(view)).toBe(false);
		view.destroy();
		parent.remove();
	});

	it("has a close button that closes it", () => {
		const { view, parent } = mount();
		openShortcutsHelp(view);
		(parent.querySelector(".cm-gcodeShortcuts-close") as HTMLButtonElement).click();
		expect(parent.querySelector(".cm-gcodeShortcuts")).toBeNull();
		view.destroy();
		parent.remove();
	});

	it("Escape in the document closes it even with a selection (which the base keymap would claim)", () => {
		// The base keymap is listed FIRST, as createEditorInstance does: its Escape would win without Prec.high.
		const { view, parent } = mount([keymap.of(defaultKeymap), gcodeShortcutsHelp()], "G1 X10\n");
		view.dispatch({ selection: { anchor: 0, head: 4 } });
		openShortcutsHelp(view);
		press(view, "Escape");
		expect(isShortcutsHelpOpen(view)).toBe(false);
		// The selection is still there: that Escape closed the panel and nothing else.
		expect(view.state.selection.main.empty).toBe(false);
		view.destroy();
		parent.remove();
	});

	it("Escape inside the panel closes it", () => {
		const { view, parent } = mount();
		openShortcutsHelp(view);
		(parent.querySelector(".cm-gcodeShortcuts") as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		expect(isShortcutsHelpOpen(view)).toBe(false);
		view.destroy();
		parent.remove();
	});

	it("leaves out the entries a host hides", () => {
		const { view, parent } = mount();
		openShortcutsHelp(view, { hide: ["save", "quickSearch"] });
		expect(parent.querySelector('[data-shortcut="save"]')).toBeNull();
		expect(parent.querySelector('[data-shortcut="quickSearch"]')).toBeNull();
		expect(parent.querySelector('[data-shortcut="find"]')).not.toBeNull();
		closeShortcutsHelp(view);
		view.destroy();
		parent.remove();
	});
});
