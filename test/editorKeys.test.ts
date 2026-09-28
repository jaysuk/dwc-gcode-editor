import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { lexLine } from "dwc-gcode-core";
import { describe, expect, it } from "vitest";
import { createEditorInstance } from "../src/editorCore";
import { gcodeLanguage } from "../src/language";

const press = (view: EditorView, init: KeyboardEventInit): void => {
	view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
};
const blockComment: KeyboardEventInit = { key: "A", code: "KeyA", shiftKey: true, altKey: true };

function make(doc: string, extensions: Array<import("@codemirror/state").Extension> = []) {
	return createEditorInstance({ doc, parent: document.createElement("div"), extensions });
}

describe("commenting out a selection", () => {
	it("Shift-Alt-a comments every selected line with ';' - RRF (FFF mode) has no block comment - and uncomments them again", () => {
		const instance = make("G28\nG1 X10 Y20\nM84", [gcodeLanguage]);
		instance.view.dispatch({ selection: { anchor: 5, head: 12 } }); // inside line 2 only
		press(instance.view, blockComment);
		expect(instance.view.state.doc.toString()).toBe("G28\n; G1 X10 Y20\nM84");
		press(instance.view, blockComment);
		expect(instance.view.state.doc.toString()).toBe("G28\nG1 X10 Y20\nM84");
		instance.destroy();
	});

	it("never wraps in parentheses, which dwc-gcode-core only reads as a comment in CNC mode", () => {
		const instance = make("G1 X10", [gcodeLanguage]);
		instance.view.dispatch({ selection: { anchor: 3, head: 6 } });
		press(instance.view, blockComment);
		const text = instance.view.state.doc.toString();
		expect(text).not.toContain("(");
		expect(lexLine(text).comment).not.toBeNull();
		instance.destroy();
	});

	it("a language that does declare a block comment token still gets a real block comment", () => {
		const withBlock = EditorState.languageData.of(() => [{ commentTokens: { line: ";", block: { open: "/*", close: "*/" } } }]);
		const instance = make("abc", [withBlock]);
		instance.view.dispatch({ selection: { anchor: 0, head: 3 } });
		press(instance.view, blockComment);
		expect(instance.view.state.doc.toString()).toBe("/* abc */");
		instance.destroy();
	});

	it("Ctrl+/ on a multi-line selection line-comments every selected line, and uncomments them again", () => {
		const instance = make("G28\nG1 X10\nM84", [gcodeLanguage]);
		instance.view.dispatch({ selection: { anchor: 1, head: 8 } }); // lines 1-2 only
		press(instance.view, { key: "/", ctrlKey: true });
		expect(instance.view.state.doc.toString()).toBe("; G28\n; G1 X10\nM84");
		press(instance.view, { key: "/", ctrlKey: true });
		expect(instance.view.state.doc.toString()).toBe("G28\nG1 X10\nM84");
		instance.destroy();
	});
});

describe("Tab", () => {
	const tab = (view: EditorView, shiftKey = false): void => press(view, { key: "Tab", shiftKey });

	it("indents every line of a multi-line selection by one indent unit", () => {
		const instance = make("if true\nG28\nG1 X10\nM84");
		instance.view.dispatch({ selection: { anchor: 8, head: 16 } }); // G28 and G1 X10
		tab(instance.view);
		expect(instance.view.state.doc.toString()).toBe("if true\n  G28\n  G1 X10\nM84");
		instance.destroy();
	});

	it("indents the line for a partial single-line selection, without replacing the selected text", () => {
		const instance = make("G1 X10");
		instance.view.dispatch({ selection: { anchor: 3, head: 6 } });
		tab(instance.view);
		expect(instance.view.state.doc.toString()).toBe("  G1 X10");
		instance.destroy();
	});

	it("Shift-Tab dedents the selected lines", () => {
		const instance = make("  G28\n  G1 X10");
		instance.view.dispatch({ selection: { anchor: 0, head: 14 } });
		tab(instance.view, true);
		expect(instance.view.state.doc.toString()).toBe("G28\nG1 X10");
		instance.destroy();
	});

	it("with a bare cursor, inserts one indent unit AT the cursor rather than indenting the line", () => {
		const instance = make("G1 X10");
		instance.view.dispatch({ selection: { anchor: 3 } });
		tab(instance.view);
		expect(instance.view.state.doc.toString()).toBe("G1   X10");
		expect(instance.view.state.selection.main.head).toBe(5);
		instance.destroy();
	});

	it("does not edit a read-only document", () => {
		const instance = make("G28", [EditorState.readOnly.of(true)]);
		instance.view.dispatch({ selection: { anchor: 0, head: 3 } });
		tab(instance.view);
		expect(instance.view.state.doc.toString()).toBe("G28");
		instance.destroy();
	});
});
