import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { gcodeCurrentLine, setCurrentLine } from "../src/currentLine";

function mount(doc: string) {
	const parent = document.createElement("div");
	document.body.appendChild(parent);
	const view = new EditorView({ state: EditorState.create({ doc, extensions: [gcodeCurrentLine()] }), parent });
	return { view, parent };
}

describe("gcodeCurrentLine / setCurrentLine", () => {
	it("has no highlighted line until setCurrentLine is called", () => {
		const { view, parent } = mount("G28\nG1 X10\nG1 X20\n");
		expect(parent.querySelector(".cm-gcodeCurrentLine")).toBeNull();
		view.destroy();
		parent.remove();
	});

	it("highlights the requested line (1-based)", () => {
		const { view, parent } = mount("G28\nG1 X10\nG1 X20\n");
		setCurrentLine(view, 2);
		const highlighted = parent.querySelector(".cm-gcodeCurrentLine");
		expect(highlighted).not.toBeNull();
		expect(highlighted!.textContent).toContain("G1 X10");
		view.destroy();
		parent.remove();
	});

	it("moves the highlight when called again with a different line", () => {
		const { view, parent } = mount("G28\nG1 X10\nG1 X20\n");
		setCurrentLine(view, 2);
		setCurrentLine(view, 3);
		const highlighted = parent.querySelector(".cm-gcodeCurrentLine");
		expect(highlighted!.textContent).toContain("G1 X20");
		expect(parent.querySelectorAll(".cm-gcodeCurrentLine")).toHaveLength(1); // not two lines highlighted
		view.destroy();
		parent.remove();
	});

	it("clears the highlight when called with null", () => {
		const { view, parent } = mount("G28\nG1 X10\n");
		setCurrentLine(view, 1);
		expect(parent.querySelector(".cm-gcodeCurrentLine")).not.toBeNull();
		setCurrentLine(view, null);
		expect(parent.querySelector(".cm-gcodeCurrentLine")).toBeNull();
		view.destroy();
		parent.remove();
	});

	it("clamps an out-of-range line to the document's real bounds instead of throwing", () => {
		// No trailing newline: a Text's own line count includes a final empty line after a trailing
		// "\n" (verified directly, not assumed) - this fixture's real last line is "G1 X10" itself.
		const { view, parent } = mount("G28\nG1 X10");
		expect(() => setCurrentLine(view, 999)).not.toThrow();
		expect(parent.querySelector(".cm-gcodeCurrentLine")!.textContent).toContain("G1 X10"); // last line
		expect(() => setCurrentLine(view, 0)).not.toThrow();
		expect(parent.querySelector(".cm-gcodeCurrentLine")!.textContent).toContain("G28"); // first line
		view.destroy();
		parent.remove();
	});

	it("stays on the same line's own text through an edit elsewhere in the document", () => {
		const { view, parent } = mount("G28\nG1 X10\nG1 X20\n");
		setCurrentLine(view, 3);
		// Insert a new line at the very start - line 3's own content should still be highlighted,
		// now as line 4, because the decoration is mapped through the change, not re-resolved by index.
		view.dispatch({ changes: { from: 0, insert: "; inserted\n" } });
		const highlighted = parent.querySelector(".cm-gcodeCurrentLine");
		expect(highlighted!.textContent).toContain("G1 X20");
		view.destroy();
		parent.remove();
	});

	it("does nothing when the extension isn't installed", () => {
		const parent = document.createElement("div");
		document.body.appendChild(parent);
		const view = new EditorView({ state: EditorState.create({ doc: "G28\n" }), parent });
		expect(() => setCurrentLine(view, 1)).not.toThrow();
		expect(parent.querySelector(".cm-gcodeCurrentLine")).toBeNull();
		view.destroy();
		parent.remove();
	});
});
