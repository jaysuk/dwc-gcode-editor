import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { insertAsciiArt, listAsciiArtFonts, renderAsciiArt } from "../src/asciiArt";

function mount(doc: string, extensions: ReadonlyArray<import("@codemirror/state").Extension> = []) {
	return new EditorView({ state: EditorState.create({ doc, extensions }), parent: document.createElement("div") });
}

describe("renderAsciiArt", () => {
	it("renders every row as its own full-line ; comment", () => {
		const art = renderAsciiArt("Hi");
		const lines = art.split("\n");
		expect(lines.length).toBeGreaterThan(1);
		for (const line of lines) {
			expect(line === ";" || line.startsWith("; ")).toBe(true);
		}
	});

	it("trims figlet's own trailing padding rather than leaving dangling whitespace", () => {
		const art = renderAsciiArt("Hi");
		for (const line of art.split("\n")) {
			expect(line).not.toMatch(/\s$/);
		}
	});

	it("uses a bare ; (no trailing space) for a row that's entirely padding", () => {
		// The Standard font pads "Hi" with one wholly-blank trailing row - confirmed empirically
		// against the real figlet output, not assumed.
		const art = renderAsciiArt("Hi");
		expect(art.split("\n")).toContain(";");
	});

	it("defaults to the bundled Standard font without requiring any setup", () => {
		expect(() => renderAsciiArt("A")).not.toThrow();
	});

	it("honours an explicit font option", () => {
		const standard = renderAsciiArt("A", { font: "Standard" });
		expect(standard.length).toBeGreaterThan(0);
	});
});

describe("listAsciiArtFonts", () => {
	it("includes the bundled Standard font", () => {
		expect(listAsciiArtFonts()).toContain("Standard");
	});
});

describe("insertAsciiArt", () => {
	it("inserts the rendered banner at an empty document's cursor", () => {
		const view = mount("");
		insertAsciiArt(view, "Hi");
		expect(view.state.doc.toString()).toBe(renderAsciiArt("Hi"));
	});

	it("splits a mid-line cursor's line around the inserted block, keeping both halves intact", () => {
		const view = mount("G28\nG1 X10\n");
		// Cursor between "G1 " and "X10" on line 2 (offset 4 + 3 = 7) - neither at that line's start
		// nor its end, so the insert must gain both a leading and a trailing newline.
		view.dispatch({ selection: { anchor: 7 } });
		insertAsciiArt(view, "Hi");
		const expected = `G28\nG1 \n${renderAsciiArt("Hi")}\nX10\n`;
		expect(view.state.doc.toString()).toBe(expected);
	});

	it("adds no leading newline when the cursor already sits at column 0", () => {
		const view = mount("G28\n");
		view.dispatch({ selection: { anchor: 4 } }); // start of the (empty) second line
		insertAsciiArt(view, "Hi");
		const text = view.state.doc.toString();
		expect(text.startsWith("G28\n" + renderAsciiArt("Hi"))).toBe(true);
	});

	it("replaces a non-empty selection with the banner", () => {
		const view = mount("G28\nOLD\nG1 X10\n");
		const from = "G28\n".length;
		const to = from + "OLD".length;
		view.dispatch({ selection: { anchor: from, head: to } });
		insertAsciiArt(view, "Hi");
		const text = view.state.doc.toString();
		expect(text).not.toContain("OLD");
		expect(text).toContain(renderAsciiArt("Hi"));
	});

	it("does nothing on a read-only view", () => {
		const view = mount("G28\n", [EditorState.readOnly.of(true)]);
		const before = view.state.doc.toString();
		const result = insertAsciiArt(view, "Hi");
		expect(result).toBe(false);
		expect(view.state.doc.toString()).toBe(before);
	});

	it("moves the cursor to just after the inserted block", () => {
		const view = mount("");
		insertAsciiArt(view, "Hi");
		const art = renderAsciiArt("Hi");
		expect(view.state.selection.main.head).toBe(art.length);
	});
});
