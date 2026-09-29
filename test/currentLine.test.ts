import { describe, expect, it, vi } from "vitest";
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

	describe("annotation (the line as evaluated)", () => {
		const annotation = {
			segments: [
				{ text: "G1 X", kind: "source" as const },
				{ text: "105", kind: "value" as const },
				{ text: " → done", kind: "result" as const },
			],
		};

		it("draws the segments in a block beneath the highlighted line, tagged by kind", () => {
			const { view, parent } = mount("G28\nG1 X{var.a + 5}\nG1 X20\n");
			setCurrentLine(view, 2, { annotation });
			const widget = parent.querySelector(".cm-gcodeEvaluatedLine");
			expect(widget).not.toBeNull();
			expect(widget!.textContent).toBe("G1 X105 → done");
			expect(widget!.querySelector(".cm-gcodeEvaluated-value")!.textContent).toBe("105");
			expect(widget!.querySelector(".cm-gcodeEvaluated-result")!.textContent).toBe(" → done");
			expect(widget!.querySelector(".cm-gcodeEvaluated-source")!.textContent).toBe("G1 X");
			view.destroy();
			parent.remove();
		});

		it("sits after the highlighted line, not before it or inside another line", () => {
			const { view, parent } = mount("G28\nG1 X{var.a + 5}\nG1 X20");
			setCurrentLine(view, 2, { annotation });
			const rows = [...parent.querySelectorAll(".cm-content > *")].map((el) => el.textContent);
			expect(rows.indexOf("G1 X105 → done")).toBe(rows.findIndex((t) => t === "G1 X{var.a + 5}") + 1);
			view.destroy();
			parent.remove();
		});

		it("is replaced by the next call rather than accumulating, and gone when that call has none", () => {
			const { view, parent } = mount("G28\nG1 X10\nG1 X20\n");
			setCurrentLine(view, 2, { annotation });
			setCurrentLine(view, 3, { annotation: { segments: [{ text: "second", kind: "result" }] } });
			expect(parent.querySelectorAll(".cm-gcodeEvaluatedLine")).toHaveLength(1);
			expect(parent.querySelector(".cm-gcodeEvaluatedLine")!.textContent).toBe("second");
			setCurrentLine(view, 3); // no annotation given: must not inherit the last step's
			expect(parent.querySelector(".cm-gcodeEvaluatedLine")).toBeNull();
			expect(parent.querySelector(".cm-gcodeCurrentLine")).not.toBeNull(); // still highlighted
			view.destroy();
			parent.remove();
		});

		it("is cleared along with the highlight by line: null", () => {
			const { view, parent } = mount("G28\nG1 X10\n");
			setCurrentLine(view, 1, { annotation });
			setCurrentLine(view, null);
			expect(parent.querySelector(".cm-gcodeEvaluatedLine")).toBeNull();
			view.destroy();
			parent.remove();
		});

		it("draws nothing for an annotation with no segments", () => {
			const { view, parent } = mount("G28\n");
			setCurrentLine(view, 1, { annotation: { segments: [] } });
			expect(parent.querySelector(".cm-gcodeEvaluatedLine")).toBeNull();
			view.destroy();
			parent.remove();
		});

		it("follows its line through an edit elsewhere in the document", () => {
			const { view, parent } = mount("G28\nG1 X10\nG1 X20");
			setCurrentLine(view, 3, { annotation });
			view.dispatch({ changes: { from: 0, insert: "; inserted\n" } });
			const rows = [...parent.querySelectorAll(".cm-content > *")].map((el) => el.textContent);
			expect(rows.indexOf("G1 X105 → done")).toBe(rows.indexOf("G1 X20") + 1);
			view.destroy();
			parent.remove();
		});

		it("puts a clamped out-of-range line's annotation under the real last line", () => {
			const { view, parent } = mount("G28\nG1 X10");
			expect(() => setCurrentLine(view, 999, { annotation })).not.toThrow();
			const rows = [...parent.querySelectorAll(".cm-content > *")].map((el) => el.textContent);
			expect(rows.indexOf("G1 X105 → done")).toBe(rows.indexOf("G1 X10") + 1);
			view.destroy();
			parent.remove();
		});
	});

	describe("scrolling", () => {
		const frame = () => new Promise<void>((resolve) => setTimeout(resolve, 50));
		/** happy-dom has no layout, so give the editor a 300px-tall scroller and a fixed line block. */
		function mountWithLayout() {
			const m = mount("G28\nG1 X10\nG1 X20\n");
			Object.defineProperty(m.view.scrollDOM, "clientHeight", { configurable: true, value: 300 });
			m.view.lineBlockAt = () => ({ top: 1000, height: 20 }) as ReturnType<EditorView["lineBlockAt"]>;
			return m;
		}

		it("centres the line by moving the editor's own scroller", async () => {
			const { view, parent } = mountWithLayout();
			setCurrentLine(view, 2);
			await frame();
			expect(view.scrollDOM.scrollTop).toBe(view.documentPadding.top + 1000 - (300 - 20) / 2);
			view.destroy();
			parent.remove();
		});

		it("never scrolls the page: CM6's own scroll-into-view request climbs every ancestor and does", async () => {
			// scrollRectIntoView hands whatever centring the editor's scroller could not do (a line near the
			// top or bottom of a file) on to window.scrollBy - the page jumped down when stepping to the end.
			const { view, parent } = mountWithLayout();
			const scrollBy = vi.spyOn(window, "scrollBy");
			const scrolled: unknown[] = [];
			const seen = view.dispatch.bind(view);
			view.dispatch = ((...specs: Parameters<EditorView["dispatch"]>) => {
				for (const spec of specs) {
					const effects = (spec as { effects?: unknown }).effects;
					scrolled.push(...(Array.isArray(effects) ? effects : effects === undefined ? [] : [effects]));
				}
				return seen(...specs);
			}) as EditorView["dispatch"];
			setCurrentLine(view, 3);
			await frame();
			expect(scrollBy).not.toHaveBeenCalled();
			// the only effect dispatched is the highlight itself, not a scrollIntoView
			expect(scrolled).toHaveLength(1);
			scrollBy.mockRestore();
			view.destroy();
			parent.remove();
		});

		it("never scrolls above the top of the document", async () => {
			const { view, parent } = mountWithLayout();
			view.lineBlockAt = () => ({ top: 0, height: 20 }) as ReturnType<EditorView["lineBlockAt"]>;
			setCurrentLine(view, 1);
			await frame();
			expect(view.scrollDOM.scrollTop).toBe(0);
			view.destroy();
			parent.remove();
		});

		it("leaves the scroll position alone with scroll: false", async () => {
			const { view, parent } = mountWithLayout();
			setCurrentLine(view, 2, { scroll: false });
			await frame();
			expect(view.scrollDOM.scrollTop).toBe(0);
			view.destroy();
			parent.remove();
		});
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
