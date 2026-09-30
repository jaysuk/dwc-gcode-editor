import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { createEditorInstance } from "../src/editorCore";
import {
	convertTabsToSpaces, createIndentationController, createWhitespaceController, DEFAULT_TAB_WIDTH, gcodeIndentation,
	lineTabsToSpaces, MAX_TAB_WIDTH, normaliseTabWidth, tabsToSpaces,
} from "../src/indentation";

const press = (view: EditorView, init: KeyboardEventInit): void => {
	view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
};
const tab = (view: EditorView, shiftKey = false): void => press(view, { key: "Tab", shiftKey });

function make(doc: string, extensions: Array<Extension> = []) {
	return createEditorInstance({ doc, parent: document.createElement("div"), extensions });
}

describe("normaliseTabWidth", () => {
	it("defaults to 4", () => {
		expect(DEFAULT_TAB_WIDTH).toBe(4);
		expect(normaliseTabWidth(undefined)).toBe(4);
		expect(normaliseTabWidth("abc")).toBe(4);
		expect(normaliseTabWidth(NaN)).toBe(4);
		expect(normaliseTabWidth("")).toBe(4);
	});
	it("accepts numbers and numeric strings, rounds, and clamps to 1..MAX", () => {
		expect(normaliseTabWidth(2)).toBe(2);
		expect(normaliseTabWidth("8")).toBe(8);
		expect(normaliseTabWidth(2.6)).toBe(3);
		expect(normaliseTabWidth(0)).toBe(1);
		expect(normaliseTabWidth(-3)).toBe(1);
		expect(normaliseTabWidth(999)).toBe(MAX_TAB_WIDTH);
	});
});

describe("lineTabsToSpaces / tabsToSpaces", () => {
	it("a leading tab is `width` spaces", () => {
		expect(lineTabsToSpaces("\tG28", 4)).toBe("    G28");
		expect(lineTabsToSpaces("\t\tG28", 2)).toBe("    G28");
		expect(lineTabsToSpaces("\tG28", 8)).toBe("        G28");
	});
	it("a tab after leading spaces only reaches the next stop, so the indentation looks the same", () => {
		expect(lineTabsToSpaces("  \tG28", 4)).toBe("    G28");
		expect(lineTabsToSpaces("   \tG28", 4)).toBe("    G28");
		expect(lineTabsToSpaces("     \tG28", 4)).toBe("        G28");
	});
	it("a tab inside the line is exactly `width` spaces", () => {
		expect(lineTabsToSpaces("G1\tX10\tY20", 4)).toBe("G1    X10    Y20");
		expect(lineTabsToSpaces("G1\tX10", 2)).toBe("G1  X10");
	});
	it("leaves a tab inside a quoted string alone - it is the string's content", () => {
		expect(lineTabsToSpaces('echo "a\tb"', 4)).toBe('echo "a\tb"');
		expect(lineTabsToSpaces('M117\t"a\tb"\tX', 4)).toBe('M117    "a\tb"    X');
	});
	it("converts a tab in a comment even after an unbalanced quote", () => {
		expect(lineTabsToSpaces('G1 X1 ; it"s\tmine', 4)).toBe('G1 X1 ; it"s    mine');
	});
	it("returns lines without a tab unchanged and keeps every line break", () => {
		expect(tabsToSpaces("G28\nG1 X1", 4)).toBe("G28\nG1 X1");
		expect(tabsToSpaces("\tA\r\n\tB\n\n\tC", 2)).toBe("  A\r\n  B\n\n  C");
	});
});

describe("convertTabsToSpaces", () => {
	it("rewrites only the lines that contain a tab, keeps the cursor, and is one undo step", () => {
		const instance = make("G28\n\tG1 X1\nM84\n\t\tM0");
		const { view } = instance;
		view.dispatch({ selection: { anchor: 2 } });
		expect(convertTabsToSpaces(view, 4)).toBe(true);
		expect(view.state.doc.toString()).toBe("G28\n    G1 X1\nM84\n        M0");
		expect(view.state.selection.main.head).toBe(2);
		expect(convertTabsToSpaces(view, 4)).toBe(false); // nothing left to do
		press(view, { key: "z", ctrlKey: true });
		expect(view.state.doc.toString()).toBe("G28\n\tG1 X1\nM84\n\t\tM0");
		instance.destroy();
	});

	it("uses the given width", () => {
		const instance = make("\tG28");
		convertTabsToSpaces(instance.view, 2);
		expect(instance.view.state.doc.toString()).toBe("  G28");
		instance.destroy();
	});

	it("does nothing to a read-only document", () => {
		const instance = make("\tG28", [EditorState.readOnly.of(true)]);
		expect(convertTabsToSpaces(instance.view, 4)).toBe(false);
		expect(instance.view.state.doc.toString()).toBe("\tG28");
		instance.destroy();
	});
});

describe("the Tab key follows the configured width", () => {
	it("inserts 4 spaces with nothing configured", () => {
		const instance = make("G1");
		tab(instance.view);
		expect(instance.view.state.doc.toString()).toBe("    G1");
		instance.destroy();
	});

	it("inserts the configured number of spaces, never a tab character", () => {
		for (const width of [1, 2, 3, 8]) {
			const instance = make("X", [gcodeIndentation(width)]);
			tab(instance.view);
			expect(instance.view.state.doc.toString()).toBe(`${" ".repeat(width)}X`);
			instance.destroy();
		}
	});

	it("indents and dedents a selection by the configured width", () => {
		const instance = make("A\nB", [gcodeIndentation(2)]);
		instance.view.dispatch({ selection: { anchor: 0, head: 3 } });
		tab(instance.view);
		expect(instance.view.state.doc.toString()).toBe("  A\n  B");
		tab(instance.view);
		expect(instance.view.state.doc.toString()).toBe("    A\n    B");
		tab(instance.view, true);
		expect(instance.view.state.doc.toString()).toBe("  A\n  B");
		instance.destroy();
	});

	it("changes live through the controller, keeping the document and undo history", () => {
		const controller = createIndentationController(4);
		const instance = make("G1", [controller.extension]);
		tab(instance.view);
		expect(instance.view.state.doc.toString()).toBe("    G1");
		controller.setTabWidth(instance.view, 2);
		expect(controller.tabWidth).toBe(2);
		expect(instance.view.state.tabSize).toBe(2);
		instance.view.dispatch({ selection: { anchor: 0 } });
		tab(instance.view);
		expect(instance.view.state.doc.toString()).toBe("      G1");
		press(instance.view, { key: "z", ctrlKey: true });
		expect(instance.view.state.doc.toString()).toBe("    G1");
		instance.destroy();
	});

	it("draws an existing tab that wide", () => {
		const controller = createIndentationController(6);
		const instance = make("\tG1", [controller.extension]);
		expect(instance.view.state.tabSize).toBe(6);
		instance.destroy();
	});

	it("an invalid width from a settings store falls back to the default", () => {
		expect(createIndentationController(Number("oops")).tabWidth).toBe(4);
	});
});

describe("createWhitespaceController", () => {
	function mount(controller: ReturnType<typeof createWhitespaceController>) {
		const parent = document.createElement("div");
		document.body.appendChild(parent);
		const view = new EditorView({ state: EditorState.create({ doc: "G1 X1\t Y2  ", extensions: [controller.extension] }), parent });
		return { view, parent };
	}

	it("is off by default and toggles marks on and off live", () => {
		const controller = createWhitespaceController();
		const { view, parent } = mount(controller);
		expect(controller.shown).toBe(false);
		expect(parent.querySelector(".cm-highlightSpace")).toBeNull();
		expect(parent.querySelector(".cm-highlightTab")).toBeNull();
		expect(controller.toggle(view)).toBe(true);
		expect(parent.querySelector(".cm-highlightSpace")).not.toBeNull();
		expect(parent.querySelector(".cm-highlightTab")).not.toBeNull();
		expect(parent.querySelector(".cm-trailingSpace")).not.toBeNull();
		expect(controller.toggle(view)).toBe(false);
		expect(parent.querySelector(".cm-highlightSpace")).toBeNull();
		view.destroy();
		parent.remove();
	});

	it("can start shown", () => {
		const { view, parent } = mount(createWhitespaceController(true));
		expect(parent.querySelector(".cm-highlightSpace")).not.toBeNull();
		view.destroy();
		parent.remove();
	});
});
