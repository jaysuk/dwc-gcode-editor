import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { gcodeIndentGuides, gcodeLineWrapping, gcodeWhitespaceRendering } from "../src/editingExtras";

function mount(doc: string, extensions: ReadonlyArray<unknown>) {
	const parent = document.createElement("div");
	document.body.appendChild(parent);
	const view = new EditorView({
		state: EditorState.create({ doc, extensions: extensions as never }),
		parent,
	});
	return { view, parent };
}

describe("gcodeLineWrapping", () => {
	it("is CM6's own EditorView.lineWrapping - not a hand-rolled reimplementation", () => {
		expect(gcodeLineWrapping).toBe(EditorView.lineWrapping);
	});

	it("makes a mounted view report lineWrapping true, off by default without it", () => {
		const off = mount("G1 X10", []);
		expect(off.view.lineWrapping).toBe(false);
		off.view.destroy();
		off.parent.remove();

		const on = mount("G1 X10", [gcodeLineWrapping]);
		expect(on.view.lineWrapping).toBe(true);
		on.view.destroy();
		on.parent.remove();
	});
});

describe("gcodeWhitespaceRendering", () => {
	it("marks spaces with cm-highlightSpace once installed - absent without it", () => {
		const off = mount("G1 X10 Y20", []);
		expect(off.parent.querySelector(".cm-highlightSpace")).toBeNull();
		off.view.destroy();
		off.parent.remove();

		const on = mount("G1 X10 Y20", [gcodeWhitespaceRendering()]);
		expect(on.parent.querySelector(".cm-highlightSpace")).not.toBeNull();
		on.view.destroy();
		on.parent.remove();
	});

	it("marks trailing whitespace with cm-trailingSpace", () => {
		const { view, parent } = mount("G1 X10   ", [gcodeWhitespaceRendering()]);
		expect(parent.querySelector(".cm-trailingSpace")).not.toBeNull();
		view.destroy();
		parent.remove();
	});
});

describe("gcodeIndentGuides", () => {
	// Default getIndentUnit(state) is 2 (CM6's own default, unset by anything in these fixtures).

	it("renders no guides at all without the extension", () => {
		const { view, parent } = mount("if true\n    G28\n", []);
		expect(parent.querySelectorAll(".cm-gcodeIndentGuide")).toHaveLength(0);
		view.destroy();
		parent.remove();
	});

	it("renders one guide for a 2-level (4-space) indented line - the boundary between the two levels", () => {
		const { view, parent } = mount("if true\n    G28\n", [gcodeIndentGuides()]);
		expect(parent.querySelectorAll(".cm-gcodeIndentGuide")).toHaveLength(1);
		view.destroy();
		parent.remove();
	});

	it("renders no guide for a single-level (2-space) indented line - nothing to mark as an ancestor boundary", () => {
		const { view, parent } = mount("if true\n  G28\n", [gcodeIndentGuides()]);
		expect(parent.querySelectorAll(".cm-gcodeIndentGuide")).toHaveLength(0);
		view.destroy();
		parent.remove();
	});

	it("skips a blank (whitespace-only) line even if deeply indented", () => {
		const { view, parent } = mount("if true\n      \nG28\n", [gcodeIndentGuides()]);
		expect(parent.querySelectorAll(".cm-gcodeIndentGuide")).toHaveLength(0);
		view.destroy();
		parent.remove();
	});

	it("scales with indent depth - a 3-level (6-space) line gets two guides", () => {
		const { view, parent } = mount("if true\n      G28\n", [gcodeIndentGuides()]);
		expect(parent.querySelectorAll(".cm-gcodeIndentGuide")).toHaveLength(2);
		view.destroy();
		parent.remove();
	});
});
