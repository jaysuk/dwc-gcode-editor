import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { gcodeLanguage } from "../src/language";
import {
	DEFAULT_DARK_COLOR_SCHEME, DEFAULT_LIGHT_COLOR_SCHEME, GCODE_COLOR_SCHEME_KEYS, gcodeCustomTheme,
	isGcodeColorScheme,
} from "../src/customTheme";

function colorAt(view: EditorView, pos: number): string {
	const dom = view.domAtPos(pos).node;
	const el = dom.nodeType === Node.TEXT_NODE ? dom.parentElement : (dom as HTMLElement);
	return el !== null ? getComputedStyle(el).color : "";
}

function mount(scheme = DEFAULT_LIGHT_COLOR_SCHEME) {
	const parent = document.createElement("div");
	document.body.appendChild(parent);
	const view = new EditorView({
		state: EditorState.create({ doc: "G28 ; home\nG1 X10", extensions: [gcodeLanguage, gcodeCustomTheme(scheme)] }),
		parent,
	});
	return { view, parent };
}

describe("isGcodeColorScheme", () => {
	it("accepts a value with every real key present as a string", () => {
		expect(isGcodeColorScheme(DEFAULT_LIGHT_COLOR_SCHEME)).toBe(true);
		expect(isGcodeColorScheme(DEFAULT_DARK_COLOR_SCHEME)).toBe(true);
	});

	it("rejects a value missing a key", () => {
		const { comment, ...rest } = DEFAULT_LIGHT_COLOR_SCHEME;
		void comment;
		expect(isGcodeColorScheme(rest)).toBe(false);
	});

	it("rejects a value with a non-string field", () => {
		expect(isGcodeColorScheme({ ...DEFAULT_LIGHT_COLOR_SCHEME, keyword: 123 })).toBe(false);
	});

	it("rejects null, arrays, and primitives", () => {
		expect(isGcodeColorScheme(null)).toBe(false);
		expect(isGcodeColorScheme([])).toBe(false);
		expect(isGcodeColorScheme("red")).toBe(false);
		expect(isGcodeColorScheme(42)).toBe(false);
	});

	it("GCODE_COLOR_SCHEME_KEYS matches the real default scheme's own keys exactly", () => {
		expect(new Set(GCODE_COLOR_SCHEME_KEYS)).toEqual(new Set(Object.keys(DEFAULT_LIGHT_COLOR_SCHEME)));
	});
});

describe("gcodeCustomTheme", () => {
	it("applies the chosen background color to the editor", () => {
		const { view, parent } = mount({ ...DEFAULT_LIGHT_COLOR_SCHEME, background: "#123456" });
		expect(getComputedStyle(view.dom).backgroundColor).toBe("#123456");
		view.destroy();
		parent.remove();
	});

	it("colors the keyword tag (the command code) with the chosen keyword color", () => {
		const { view, parent } = mount({ ...DEFAULT_LIGHT_COLOR_SCHEME, keyword: "#ff00ff" });
		const color = colorAt(view, 0); // "G28" starts the doc
		expect(color).toBe("#ff00ff");
		view.destroy();
		parent.remove();
	});

	it("colors the comment tag with the chosen comment color, distinct from the keyword color", () => {
		const { view, parent } = mount({ ...DEFAULT_LIGHT_COLOR_SCHEME, keyword: "#ff00ff", comment: "#00ff00" });
		const commentPos = view.state.doc.line(1).text.indexOf(";");
		expect(colorAt(view, commentPos)).toBe("#00ff00");
		view.destroy();
		parent.remove();
	});

	it("does not throw for a non-hex background color (e.g. a named color or rgb())", () => {
		expect(() => mount({ ...DEFAULT_LIGHT_COLOR_SCHEME, background: "cornflowerblue" })).not.toThrow();
		expect(() => mount({ ...DEFAULT_LIGHT_COLOR_SCHEME, background: "rgb(10, 20, 30)" })).not.toThrow();
	});

	it("two different schemes produce two different (non-equal) extensions", () => {
		expect(gcodeCustomTheme(DEFAULT_LIGHT_COLOR_SCHEME)).not.toBe(gcodeCustomTheme(DEFAULT_DARK_COLOR_SCHEME));
	});
});
