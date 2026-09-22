import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
	closeQuickSearch, gcodeQuickSearchKeymap, openExpressionQuickSearch, openGcodeQuickSearch,
} from "../src/quickSearch";

function mount(doc: string, extensions: ReadonlyArray<unknown> = [gcodeQuickSearchKeymap()]) {
	const parent = document.createElement("div");
	document.body.appendChild(parent);
	const view = new EditorView({ state: EditorState.create({ doc, extensions: extensions as never }), parent });
	return { view, parent };
}

function pressF4(view: EditorView): void {
	view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "F4", bubbles: true, cancelable: true }));
}

describe("gcodeQuickSearchKeymap", () => {
	it("F4 opens the G/M-code search panel on an ordinary line", () => {
		const { view, parent } = mount("G1 X10\n");
		expect(parent.querySelector(".cm-gcodeQuickSearch")).toBeNull();
		pressF4(view);
		expect(parent.querySelector(".cm-gcodeQuickSearch")).not.toBeNull();
		// The gcode panel's placeholder names codes, not object-model paths.
		const input = parent.querySelector(".cm-gcodeQuickSearch-input") as HTMLInputElement;
		expect(input.placeholder).toMatch(/code/i);
		view.destroy();
		parent.remove();
	});

	it("F4 opens the object-model search panel when the cursor is inside a { expression", () => {
		const { view, parent } = mount("G1 X{move.axes[0]\n");
		view.dispatch({ selection: { anchor: "G1 X{move.axes[0]".length } });
		pressF4(view);
		const input = parent.querySelector(".cm-gcodeQuickSearch-input") as HTMLInputElement;
		expect(input.placeholder).toMatch(/object-model/i);
		view.destroy();
		parent.remove();
	});

	it("does nothing on F4 without the extension installed", () => {
		const { view, parent } = mount("G1 X10\n", []);
		pressF4(view);
		expect(parent.querySelector(".cm-gcodeQuickSearch")).toBeNull();
		view.destroy();
		parent.remove();
	});
});

describe("the quick-search panel", () => {
	it("lists real dictionary entries and filters them as you type", () => {
		const { view, parent } = mount("");
		openGcodeQuickSearch(view);
		const rowsBefore = parent.querySelectorAll(".cm-gcodeQuickSearch-row").length;
		expect(rowsBefore).toBeGreaterThan(50);

		const input = parent.querySelector(".cm-gcodeQuickSearch-input") as HTMLInputElement;
		input.value = "G28";
		input.dispatchEvent(new Event("input", { bubbles: true }));
		const rows = parent.querySelectorAll(".cm-gcodeQuickSearch-row");
		expect(rows.length).toBeGreaterThan(0);
		expect(Array.from(rows).some((r) => r.textContent?.includes("G28"))).toBe(true);
		expect(rows.length).toBeLessThan(rowsBefore);
		view.destroy();
		parent.remove();
	});

	it("Enter accepts the selected (first) entry, inserts it at the selection, and closes the panel", () => {
		const { view, parent } = mount("");
		openGcodeQuickSearch(view);
		const input = parent.querySelector(".cm-gcodeQuickSearch-input") as HTMLInputElement;
		input.value = "G28";
		input.dispatchEvent(new Event("input", { bubbles: true }));
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));

		expect(view.state.doc.toString()).toBe("G28");
		expect(parent.querySelector(".cm-gcodeQuickSearch")).toBeNull();
		view.destroy();
		parent.remove();
	});

	it("replaces an existing selection rather than just inserting at a bare cursor", () => {
		const { view, parent } = mount("G1 XXXX Y10");
		view.dispatch({ selection: { anchor: 3, head: 7 } }); // selects "XXXX"
		openGcodeQuickSearch(view);
		const input = parent.querySelector(".cm-gcodeQuickSearch-input") as HTMLInputElement;
		input.value = "G28";
		input.dispatchEvent(new Event("input", { bubbles: true }));
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));

		expect(view.state.doc.toString()).toBe("G1 G28 Y10");
		view.destroy();
		parent.remove();
	});

	it("ArrowDown moves the selected row before accepting", () => {
		const { view, parent } = mount("");
		openGcodeQuickSearch(view);
		const input = parent.querySelector(".cm-gcodeQuickSearch-input") as HTMLInputElement;
		const firstLabelBefore = parent.querySelector(".cm-gcodeQuickSearch-row-selected .cm-gcodeQuickSearch-label")?.textContent;

		input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
		const selectedLabelAfter = parent.querySelector(".cm-gcodeQuickSearch-row-selected .cm-gcodeQuickSearch-label")?.textContent;
		expect(selectedLabelAfter).not.toBe(firstLabelBefore);

		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
		expect(view.state.doc.toString()).toBe(selectedLabelAfter);
		view.destroy();
		parent.remove();
	});

	it("Escape closes the panel without inserting anything", () => {
		const { view, parent } = mount("G28\n");
		openGcodeQuickSearch(view);
		const input = parent.querySelector(".cm-gcodeQuickSearch-input") as HTMLInputElement;
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));

		expect(parent.querySelector(".cm-gcodeQuickSearch")).toBeNull();
		expect(view.state.doc.toString()).toBe("G28\n");
		view.destroy();
		parent.remove();
	});

	it("clicking a row accepts it, same as Enter", () => {
		const { view, parent } = mount("");
		openGcodeQuickSearch(view);
		const input = parent.querySelector(".cm-gcodeQuickSearch-input") as HTMLInputElement;
		input.value = "G28";
		input.dispatchEvent(new Event("input", { bubbles: true }));
		const row = parent.querySelector(".cm-gcodeQuickSearch-row") as HTMLElement;
		row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

		expect(view.state.doc.toString()).toBe("G28");
		view.destroy();
		parent.remove();
	});

	it("opening the expression search a second time replaces the panel rather than stacking two", () => {
		const { view, parent } = mount("");
		openGcodeQuickSearch(view);
		openExpressionQuickSearch(view, { move: { speedFactor: 1 } });
		expect(parent.querySelectorAll(".cm-gcodeQuickSearch").length).toBe(1);
		const input = parent.querySelector(".cm-gcodeQuickSearch-input") as HTMLInputElement;
		expect(input.placeholder).toMatch(/object-model/i);
		view.destroy();
		parent.remove();
	});
});

describe("openGcodeQuickSearch / openExpressionQuickSearch / closeQuickSearch", () => {
	it("openGcodeQuickSearch works even without gcodeQuickSearchKeymap() installed - self-installs its own state field", () => {
		const { view, parent } = mount("", []);
		openGcodeQuickSearch(view);
		expect(parent.querySelector(".cm-gcodeQuickSearch")).not.toBeNull();
		view.destroy();
		parent.remove();
	});

	it("closeQuickSearch is a harmless no-op when nothing is open", () => {
		const { view, parent } = mount("", []);
		expect(() => closeQuickSearch(view)).not.toThrow();
		expect(parent.querySelector(".cm-gcodeQuickSearch")).toBeNull();
		view.destroy();
		parent.remove();
	});

	it("openExpressionQuickSearch offers a supplied object model's flattened paths", () => {
		const { view, parent } = mount("", []);
		openExpressionQuickSearch(view, { move: { speedFactor: 1 } });
		const labels = Array.from(parent.querySelectorAll(".cm-gcodeQuickSearch-label")).map((e) => e.textContent);
		expect(labels).toContain("move.speedFactor");
		view.destroy();
		parent.remove();
	});
});
