import { redo, undo } from "@codemirror/commands";
import { describe, expect, it, vi } from "vitest";
import { createEditorInstance, saveKeymap } from "../src/editorCore";

describe("createEditorInstance", () => {
	it("mounts with the given initial document", () => {
		const instance = createEditorInstance({ doc: "G28\nG1 X10", parent: document.createElement("div") });
		expect(instance.view.state.doc.toString()).toBe("G28\nG1 X10");
		instance.destroy();
	});

	it("flush() reports the CURRENT document, including edits made after creation", () => {
		let reported: string | null = null;
		const instance = createEditorInstance({
			doc: "G28",
			parent: document.createElement("div"),
			onFlush: (doc) => { reported = doc.toString(); },
		});
		instance.view.dispatch({ changes: { from: 3, insert: "\nG1 X10" } });
		instance.flush();
		expect(reported).toBe("G28\nG1 X10");
		instance.destroy();
	});

	it("destroy() calls onFlush with the final content BEFORE tearing the view down", () => {
		const calls: Array<string> = [];
		const instance = createEditorInstance({
			doc: "G28",
			parent: document.createElement("div"),
			onFlush: (doc) => calls.push(doc.toString()),
		});
		instance.view.dispatch({ changes: { from: 3, insert: " ; edited" } });
		instance.destroy();
		expect(calls).toEqual(["G28 ; edited"]);
	});

	it("destroy() calls onFlush even if the host never called flush() itself - the actual gap this closes", () => {
		// This is the direct analogue of PR #517's documented Monaco gap: a host that edits, then
		// unmounts without an explicit save step, must not lose the edit.
		const calls: Array<string> = [];
		const instance = createEditorInstance({
			doc: "G1 X1",
			parent: document.createElement("div"),
			onFlush: (doc) => calls.push(doc.toString()),
		});
		instance.view.dispatch({ changes: { from: 5, insert: " Y1" } });
		// No manual flush() call here - straight to destroy().
		instance.destroy();
		expect(calls).toEqual(["G1 X1 Y1"]);
	});

	it("destroy() is idempotent - a second call does not throw or re-flush", () => {
		const calls: Array<string> = [];
		const instance = createEditorInstance({
			doc: "G28",
			parent: document.createElement("div"),
			onFlush: (doc) => calls.push(doc.toString()),
		});
		instance.destroy();
		expect(() => instance.destroy()).not.toThrow();
		expect(calls).toHaveLength(1);
	});

	it("works with no onFlush given at all", () => {
		const instance = createEditorInstance({ doc: "G28", parent: document.createElement("div") });
		expect(() => { instance.flush(); instance.destroy(); }).not.toThrow();
	});

	it("accepts extensions (e.g. the language) and actually applies them to the created state", async () => {
		const { gcodeLanguage } = await import("../src/language");
		const { language } = await import("@codemirror/language");

		const withLanguage = createEditorInstance({
			doc: "G1 X10", parent: document.createElement("div"), extensions: [gcodeLanguage],
		});
		const withoutLanguage = createEditorInstance({ doc: "G1 X10", parent: document.createElement("div") });

		expect(withLanguage.view.state.facet(language)).not.toBeNull();
		expect(withoutLanguage.view.state.facet(language)).toBeNull();

		withLanguage.destroy();
		withoutLanguage.destroy();
	});

	it("has working undo/redo by default - the actual bug this base extension set fixes", () => {
		// Every consumer built before this fix (duet-gcode-postprocessor's GcodeEditor.vue,
		// Flexible-Layouts' GcodeCmEditor.vue, this package's own demo) had no history() extension
		// at all, so Ctrl+Z silently did nothing. undo()/redo() only succeed at all if a history()
		// extension is present in the state - this is a real, not simulated, exercise of that.
		const instance = createEditorInstance({ doc: "G28", parent: document.createElement("div") });
		instance.view.dispatch({ changes: { from: 3, insert: "\nG1 X10" } });
		expect(instance.view.state.doc.toString()).toBe("G28\nG1 X10");

		expect(undo(instance.view)).toBe(true);
		expect(instance.view.state.doc.toString()).toBe("G28");

		expect(redo(instance.view)).toBe(true);
		expect(instance.view.state.doc.toString()).toBe("G28\nG1 X10");

		instance.destroy();
	});

	it("has CM6's standard editing keybindings by default (e.g. Backspace)", () => {
		// A real keyboard event through CM6's own handler, not a direct state.doc splice - proves
		// the default keymap extension is actually wired into the view, not just present in a list.
		const instance = createEditorInstance({ doc: "G28", parent: document.createElement("div") });
		instance.view.dispatch({ selection: { anchor: 3 } });
		instance.view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));
		expect(instance.view.state.doc.toString()).toBe("G2");
		instance.destroy();
	});
});

describe("saveKeymap", () => {
	it("calls onSave when Ctrl+S is pressed while the editor has focus", () => {
		const onSave = vi.fn();
		const instance = createEditorInstance({
			doc: "G28", parent: document.createElement("div"), extensions: [saveKeymap(onSave)],
		});
		instance.view.contentDOM.dispatchEvent(
			new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }),
		);
		expect(onSave).toHaveBeenCalledTimes(1);
		instance.destroy();
	});

	it("does not call onSave for a plain 's' keystroke", () => {
		const onSave = vi.fn();
		const instance = createEditorInstance({
			doc: "G28", parent: document.createElement("div"), extensions: [saveKeymap(onSave)],
		});
		instance.view.contentDOM.dispatchEvent(
			new KeyboardEvent("keydown", { key: "s", bubbles: true, cancelable: true }),
		);
		expect(onSave).not.toHaveBeenCalled();
		instance.destroy();
	});
});
