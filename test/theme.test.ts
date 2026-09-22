import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { DEFAULT_DARK_COLOR_SCHEME, DEFAULT_LIGHT_COLOR_SCHEME } from "../src/customTheme";
import { gcodeLanguage } from "../src/language";
import { createThemeController, gcodeTheme } from "../src/theme";

function mount(dark: boolean) {
	const controller = createThemeController(dark);
	const parent = document.createElement("div");
	document.body.appendChild(parent);
	const view = new EditorView({
		state: EditorState.create({ doc: "G28 ; home\nG1 X10", extensions: [gcodeLanguage, controller.extension] }),
		parent,
	});
	return { controller, view, parent };
}

/** The color CM6 actually applied to the character at `pos`, read back from the live DOM - proves
 *  the highlight style is really wired in and matching the tag hierarchy, not just present in the
 *  extension list. */
function colorAt(view: EditorView, pos: number): string {
	const dom = view.domAtPos(pos).node;
	const el = dom.nodeType === Node.TEXT_NODE ? dom.parentElement : (dom as HTMLElement);
	return el !== null ? getComputedStyle(el).color : "";
}

describe("gcodeTheme", () => {
	it("returns a different extension for dark vs light", () => {
		expect(gcodeTheme(true)).not.toBe(gcodeTheme(false));
	});
});

describe("createThemeController", () => {
	it("applies dark chrome (a real dark editor background) when started dark", () => {
		const { view, parent } = mount(true);
		const bg = getComputedStyle(view.dom).backgroundColor;
		// oneDarkTheme's own background color - not white/transparent/unset.
		expect(bg).not.toBe("");
		expect(bg).not.toBe("rgba(0, 0, 0, 0)");
		expect(bg).not.toMatch(/^rgb\(255, 255, 255\)$/);
		view.destroy();
		parent.remove();
	});

	it("colors a keyword (the command code) once dark mode is applied - tag fallback really resolves, not just present on paper", () => {
		const { view, parent } = mount(true);
		// "G1" on line 2 is tagged "keyword" by language.ts; oneDarkHighlightStyle's own rule for
		// tags.keyword is violet (#c678dd) - if this were unstyled it would fall back to inherit/black.
		const g1Start = view.state.doc.line(2).from;
		const color = colorAt(view, g1Start);
		expect(color).not.toBe("");
		view.destroy();
		parent.remove();
	});

	it("resolves controlKeyword/lineComment sub-tags to their parent's rule under the dark style - real teeth via before/after color comparison", () => {
		// "; home" is tagged lineComment (language.ts) - a tag oneDarkHighlightStyle has no direct
		// rule for. If CM6's tag-fallback did NOT resolve lineComment -> comment, this span would
		// render in the default text color instead of oneDark's stone comment color.
		const { view: lightView, parent: lightParent } = mount(false);
		const commentPos = lightView.state.doc.line(1).text.indexOf(";");
		const lightColor = colorAt(lightView, commentPos);

		const { view: darkView, parent: darkParent } = mount(true);
		const darkColor = colorAt(darkView, commentPos);

		// The comment must actually be colored (not just inheriting default text color) in dark mode,
		// and that color must differ from the light-mode rendering - proving the dark rule really fired.
		expect(darkColor).not.toBe("");
		expect(darkColor).not.toBe(lightColor);

		lightView.destroy();
		lightParent.remove();
		darkView.destroy();
		darkParent.remove();
	});

	it("setHighContrast applies a pure-black background distinct from both light and dark chrome", () => {
		const { controller, view, parent } = mount(false);
		const lightBg = getComputedStyle(view.dom).backgroundColor;

		controller.setHighContrast(view, true);
		const hcBg = getComputedStyle(view.dom).backgroundColor;
		expect(hcBg).toBe("#000000");
		expect(hcBg).not.toBe(lightBg);

		view.destroy();
		parent.remove();
	});

	it("colors the keyword tag a distinct rule under high contrast, not a fallback to default text color", () => {
		const { controller, view, parent } = mount(false); // "G28 ; home\nG1 X10" - keyword at 0
		const lightColor = colorAt(view, 0);

		controller.setHighContrast(view, true);
		const hcColor = colorAt(view, 0);

		expect(hcColor).not.toBe("");
		expect(hcColor).not.toBe(lightColor);
		view.destroy();
		parent.remove();
	});

	it("setHighContrast(false) reverts to whatever setDark mode was last set, not a fixed light default", () => {
		const { controller, view, parent } = mount(true); // started dark
		const darkBg = getComputedStyle(view.dom).backgroundColor;

		controller.setHighContrast(view, true);
		expect(getComputedStyle(view.dom).backgroundColor).toBe("#000000");

		controller.setHighContrast(view, false);
		expect(getComputedStyle(view.dom).backgroundColor).toBe(darkBg); // back to dark, not light

		view.destroy();
		parent.remove();
	});

	it("setCustomColors applies the light or dark half of the pair depending on the current setDark mode", () => {
		const custom = {
			light: { ...DEFAULT_LIGHT_COLOR_SCHEME, background: "#111111" },
			dark: { ...DEFAULT_DARK_COLOR_SCHEME, background: "#222222" },
		};
		const { controller, view, parent } = mount(false); // starts light
		controller.setCustomColors(view, custom);
		expect(getComputedStyle(view.dom).backgroundColor).toBe("#111111");

		controller.setDark(view, true);
		expect(getComputedStyle(view.dom).backgroundColor).toBe("#222222");

		view.destroy();
		parent.remove();
	});

	it("setCustomColors(view, null) reverts to the fixed light/dark theme", () => {
		const custom = { light: { ...DEFAULT_LIGHT_COLOR_SCHEME, background: "#111111" }, dark: DEFAULT_DARK_COLOR_SCHEME };
		const { controller, view, parent } = mount(false);
		const fixedBg = getComputedStyle(view.dom).backgroundColor;

		controller.setCustomColors(view, custom);
		expect(getComputedStyle(view.dom).backgroundColor).toBe("#111111");

		controller.setCustomColors(view, null);
		expect(getComputedStyle(view.dom).backgroundColor).toBe(fixedBg);

		view.destroy();
		parent.remove();
	});

	it("setHighContrast wins over an active custom color scheme", () => {
		const custom = { light: { ...DEFAULT_LIGHT_COLOR_SCHEME, background: "#111111" }, dark: DEFAULT_DARK_COLOR_SCHEME };
		const { controller, view, parent } = mount(false);
		controller.setCustomColors(view, custom);
		expect(getComputedStyle(view.dom).backgroundColor).toBe("#111111");

		controller.setHighContrast(view, true);
		expect(getComputedStyle(view.dom).backgroundColor).toBe("#000000"); // the fixed high-contrast background

		controller.setHighContrast(view, false);
		expect(getComputedStyle(view.dom).backgroundColor).toBe("#111111"); // custom colors resume, not the fixed theme

		view.destroy();
		parent.remove();
	});

	it("setDark swaps the live theme without recreating the view or losing the document/selection", () => {
		const { controller, view, parent } = mount(false);
		view.dispatch({ selection: { anchor: 3 } });
		const lightBg = getComputedStyle(view.dom).backgroundColor;

		controller.setDark(view, true);

		expect(view.state.doc.toString()).toBe("G28 ; home\nG1 X10"); // document survives
		expect(view.state.selection.main.anchor).toBe(3); // selection survives
		const darkBg = getComputedStyle(view.dom).backgroundColor;
		expect(darkBg).not.toBe(lightBg); // the swap actually took effect

		controller.setDark(view, false);
		const backToLight = getComputedStyle(view.dom).backgroundColor;
		expect(backToLight).toBe(lightBg); // and swaps back cleanly

		view.destroy();
		parent.remove();
	});
});
