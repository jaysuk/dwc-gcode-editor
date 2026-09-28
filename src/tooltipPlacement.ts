/**
 * Where CM6 puts tooltips (diagnostic hovers, the completion list, the F4 picker's hints) and how
 * tall they may get.
 *
 * By default `@codemirror/view` renders a tooltip as a `position: fixed` child of the editor's own
 * DOM. That is fine on a bare page, but every host of this package embeds the editor inside
 * something with its own layering — a Vuetify dialog (CSS `transform` while it animates in), a
 * Flexible-Layouts grid tile (`overflow: hidden`, sometimes scaled). A `transform`ed ancestor makes
 * `fixed` positioning relative to that ancestor instead of the viewport (CM6 notices and falls back
 * to `absolute`, verified in its `readMeasure`), and `overflow: hidden` then clips the tooltip at
 * the tile's edge — so a hover near the top or bottom of the editor is cut off or lands off-screen
 * even though CM6's own flip-above/below logic (measured against the window) picked the right side.
 *
 * Mounting the tooltip container on `document.body` sidesteps every ancestor at once, and CM6 still
 * measures and flips against the window (`tooltipSpace` defaults to it). Theme classes are copied
 * onto the body-level container by CM6 itself (`this.container.className = view.themeClasses`), so
 * the light/dark/custom themes still apply.
 *
 * The second half is height: when there is less room than a tooltip wants, CM6 sets an explicit
 * `height` on it but leaves overflow visible, so a long list of diagnostics spilled out of its own
 * box. Capping the lint tooltip and letting it scroll keeps it inside the box CM6 sized for it.
 */

import type { Extension } from "@codemirror/state";
import { EditorView, tooltips } from "@codemirror/view";

const tooltipTheme = EditorView.baseTheme({
	// Above Vuetify's dialog (202) / menu layers, which a body-level container now competes with.
	".cm-tooltip": { zIndex: 10000 },
	".cm-tooltip.cm-tooltip-lint": {
		maxHeight: "50vh",
		maxWidth: "min(90vw, 48em)",
		overflowY: "auto",
	},
});

export function gcodeTooltipPlacement(): Extension {
	const placement: Extension = typeof document === "undefined"
		? []
		: tooltips({ parent: document.body, position: "fixed" });
	return [placement, tooltipTheme];
}
