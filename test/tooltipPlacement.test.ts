import { showTooltip, type Tooltip } from "@codemirror/view";
import { StateField } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { createEditorInstance } from "../src/editorCore";
import { gcodeTooltipPlacement } from "../src/tooltipPlacement";

function tooltipField() {
	const tip: Tooltip = {
		pos: 0,
		create: () => {
			const dom = document.createElement("div");
			dom.className = "test-tip";
			return { dom };
		},
	};
	return StateField.define<Tooltip>({ create: () => tip, update: (v) => v, provide: (f) => showTooltip.from(f) });
}

describe("gcodeTooltipPlacement", () => {
	it("mounts tooltips on document.body, outside any clipping ancestor of the editor", () => {
		const host = document.createElement("div");
		host.style.overflow = "hidden";
		host.style.transform = "translateZ(0)";
		document.body.appendChild(host);
		const inst = createEditorInstance({ doc: "G28", parent: host, extensions: [tooltipField()] });
		const tip = document.querySelector(".test-tip") as HTMLElement;
		expect(tip).not.toBeNull();
		expect(host.contains(tip)).toBe(false);
		expect(tip.closest("body > div")?.parentElement).toBe(document.body);
		inst.destroy();
		host.remove();
	});

	it("is included in createEditorInstance without the host opting in, and is safe to pass alone", () => {
		expect(() => gcodeTooltipPlacement()).not.toThrow();
	});
});
