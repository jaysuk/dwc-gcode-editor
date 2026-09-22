import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { alignLineComments, codeAtCursor } from "../src/editorActions";

function mount(doc: string) {
	const view = new EditorView({ state: EditorState.create({ doc }), parent: document.createElement("div") });
	return view;
}

describe("codeAtCursor", () => {
	it("returns the code the cursor sits inside", () => {
		const view = mount("G1 X10 Y20\n");
		expect(codeAtCursor(view, 1)).toBe("G1"); // inside "G1"
	});

	it("returns the code while the cursor is in its trailing param region", () => {
		const view = mount("G1 X10 Y20\n");
		expect(codeAtCursor(view, 8)).toBe("G1"); // inside "Y20", still part of the G1 command
	});

	it("returns null when the cursor isn't on any command", () => {
		const view = mount("; just a comment\n");
		expect(codeAtCursor(view, 5)).toBeNull();
	});

	it("defaults to the current selection head when pos is omitted", () => {
		const view = mount("G28\n");
		view.dispatch({ selection: { anchor: 1 } });
		expect(codeAtCursor(view)).toBe("G28");
	});

	it("resolves the right command on the second of two commands sharing a line", () => {
		const view = mount("G90 G1 X10\n");
		expect(codeAtCursor(view, 8)).toBe("G1");
	});
});

describe("alignLineComments", () => {
	it("pads every commented line's command to the longest one, plus one space", () => {
		const view = mount("G1 X10 ;short\nG1 X10 Y20 ;longer command\n");
		expect(alignLineComments(view)).toBe(true);
		// "G1 X10 Y20" is the longest command (10 chars); "G1 X10" (6 chars) pads out to 10+1=11
		// columns before its ";" - 5 spaces, since "G1 X10" already ends at column 6.
		expect(view.state.doc.toString()).toBe(
			"G1 X10     ;short\nG1 X10 Y20 ;longer command\n",
		);
	});

	it("leaves a full-line (column-0) comment untouched and excluded from the column computation", () => {
		// The full-line comment is deliberately much "longer" than any real command - if it wrongly
		// contributed to maxCommandLength, "G1 X10"'s padding below would be far wider than 5 spaces.
		const view = mount("; a very very very long full-line comment indeed\nG1 X10 ;short\nG1 X10 Y20 ;longer\n");
		expect(alignLineComments(view)).toBe(true);
		const lines = view.state.doc.toString().split("\n");
		expect(lines[0]).toBe("; a very very very long full-line comment indeed"); // untouched
		expect(lines[1]).toBe("G1 X10     ;short"); // aligned to "G1 X10 Y20"'s 10 chars, not the comment
		expect(lines[2]).toBe("G1 X10 Y20 ;longer"); // already at the right column
	});

	it("leaves a quoted semicolon alone - the comment is the real trailing one, not inside the string", () => {
		const view = mount('M28 "file;name.g" ;comment\nG1 X10 ;c\n');
		expect(alignLineComments(view)).toBe(true);
		const lines = view.state.doc.toString().split("\n");
		expect(lines[0]).toBe('M28 "file;name.g" ;comment');
	});

	it("returns false and dispatches nothing when the file is already aligned", () => {
		const view = mount("G1 X10 ;a\nG1 X10 Y20 ;b\n");
		expect(alignLineComments(view)).toBe(true); // first call aligns the shorter line
		const aligned = view.state.doc.toString();
		expect(alignLineComments(view)).toBe(false); // second call: already aligned, no-op
		expect(view.state.doc.toString()).toBe(aligned);
	});

	it("returns false when no line has a trailing comment at all", () => {
		const view = mount("G1 X10\nG1 X20\n");
		expect(alignLineComments(view)).toBe(false);
	});

	it("is a single undo step even though it may touch several lines", async () => {
		const { undo } = await import("@codemirror/commands");
		const { history } = await import("@codemirror/commands");
		const view = new EditorView({
			state: EditorState.create({ doc: "G1 X10 ;short\nG1 X10 Y20 ;longer\n", extensions: [history()] }),
			parent: document.createElement("div"),
		});
		alignLineComments(view);
		const aligned = view.state.doc.toString();
		expect(aligned).not.toBe("G1 X10 ;short\nG1 X10 Y20 ;longer\n");
		expect(undo(view)).toBe(true);
		expect(view.state.doc.toString()).toBe("G1 X10 ;short\nG1 X10 Y20 ;longer\n");
	});
});
