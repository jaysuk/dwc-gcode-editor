import { describe, expect, it } from "vitest";
import { findNext, SearchQuery, setSearchQuery } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { gcodeSearch, openSearchPanel } from "../src/search";

function mount(doc: string, extensions: ReadonlyArray<unknown>) {
	const parent = document.createElement("div");
	document.body.appendChild(parent);
	const view = new EditorView({ state: EditorState.create({ doc, extensions: extensions as never }), parent });
	return { view, parent };
}

describe("gcodeSearch", () => {
	it("openSearchPanel opens the real find/replace panel once installed", () => {
		const { view, parent } = mount("G1 X10\nG1 X20\n", [gcodeSearch()]);
		expect(parent.querySelector(".cm-search")).toBeNull();
		openSearchPanel(view);
		expect(parent.querySelector(".cm-search")).not.toBeNull();
		view.destroy();
		parent.remove();
	});

	it("opens the panel on Mod-f, a real keyboard event through the searchKeymap binding", () => {
		const { view, parent } = mount("G1 X10\n", [gcodeSearch()]);
		expect(parent.querySelector(".cm-search")).toBeNull();
		view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true }));
		expect(parent.querySelector(".cm-search")).not.toBeNull();
		view.destroy();
		parent.remove();
	});

	it("does nothing on Mod-f without the extension installed", () => {
		const { view, parent } = mount("G1 X10\n", []);
		view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true }));
		expect(parent.querySelector(".cm-search")).toBeNull();
		view.destroy();
		parent.remove();
	});

	it("a search for an existing term actually finds and can select a real match", () => {
		// Sets the query through the real state-effect API (setSearchQuery) rather than faking a DOM
		// input event on the panel's own text field - this package's own established lesson
		// (theme.ts/completion.ts's tests) is that CM6 widgets often need a specific real trigger, not
		// a generic synthetic event, so this goes through the documented programmatic path instead.
		const { view, parent } = mount("G1 X10\nG1 X20\n", [gcodeSearch()]);
		view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "X20" })) });
		expect(findNext(view)).toBe(true);
		const sel = view.state.selection.main;
		expect(view.state.sliceDoc(sel.from, sel.to)).toBe("X20");
		view.destroy();
		parent.remove();
	});
});
