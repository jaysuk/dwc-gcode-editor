/**
 * 12864-display menu files (`0:/menu/*`, `FileKind: "menu"`) - highlighting and diagnostics. A menu
 * file is NOT G-code (`text R0 C0 F1 T"Hello"` has no G/M command), so `language.ts`'s `lexLine`
 * grammar would colour it as nonsense; this reads it the way RepRapFirmware's `Menu::ParseMenuLine`
 * does, via `dwc-gcode-core`'s own `parseMenu` (which reports each command's parameters with their
 * exact spans), so this module owns no grammar of its own.
 *
 * - the six commands RRF dispatches on (`image`/`text`/`button`/`value`/`alter`/`files`, matched
 *   case-insensitively) are `keyword`; an unrecognised word is deliberately left uncoloured, because it
 *   is exactly what RRF refuses;
 * - a parameter's letter is `propertyName`, its value `number` / `string`, and a `{...}` expression
 *   (`V{...}` visibility, `N{...}` on a `value`) is tokenised with `language.ts`'s own expression
 *   scanner, so `exists(...)`, `move.axes[0].homed` and friends match what a G-code file shows;
 * - a `;` comment is `lineComment`.
 *
 * Only tags `language.ts` already uses are emitted, so `customTheme.ts`'s ten user colours and the
 * high-contrast theme cover menu files with no new colour keys.
 *
 * Diagnostics are core's `menu/*` rules. Those are project-level in core (`diagnoseProject` - the
 * `menu/target-missing` and `menu/image-missing` rules need to know what else is in `0:/menu/`), so
 * {@link menuDiagnostics} loads the file as a one-file project, plus a stub for each name the caller
 * says its siblings have, and keeps the findings for the file being edited.
 */

import { StreamLanguage, type StreamParser } from "@codemirror/language";
import type { Diagnostic as CmDiagnostic } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { diagnoseProject, loadProject, parseMenu, type DiagnoseOptions } from "dwc-gcode-core";
import { gcodeLiveLinter, toCmDiagnostics } from "./diagnostics.js";
import { classifyExpression, type HighlightRange } from "./language.js";

const isBlank = (c: string | undefined): boolean => c === " " || c === "\t";

/** One menu line's highlight ranges in ascending `from` order. Exported so tests can assert on it
 *  without a full `StreamLanguage`/`EditorView`, same as `boardTxt.ts`'s `classifyBoardTxtLine`. */
export function classifyMenuLine(raw: string): ReadonlyArray<HighlightRange> {
	const ranges: Array<HighlightRange> = [];
	const line = parseMenu(raw).lines[0];
	if (line === undefined || line.kind === "blank") return ranges;

	let pos = 0;
	while (isBlank(raw[pos])) pos++;
	if (line.kind === "comment") {
		ranges.push({ from: pos, to: raw.length, tag: "lineComment" });
		return ranges;
	}

	const commandEnd = pos + (line.command?.length ?? 0);
	if (line.kind === "command" && commandEnd > pos) ranges.push({ from: pos, to: commandEnd, tag: "keyword" });

	let after = commandEnd;
	for (const param of line.params) {
		if (raw[param.start] === "\"") {
			// A bare quoted string is short for `T` (RRF: `case '"': ch = 'T'; --args;`) - no letter to colour.
			ranges.push({ from: param.start, to: param.end, tag: "string" });
		} else {
			ranges.push({ from: param.start, to: param.start + 1, tag: "propertyName" });
			const valueFrom = param.start + 1;
			if (param.kind === "number") {
				if (param.end > valueFrom) ranges.push({ from: valueFrom, to: param.end, tag: "number" });
			} else if (param.kind === "string") {
				if (param.end > valueFrom) ranges.push({ from: valueFrom, to: param.end, tag: "string" });
			} else {
				// `{expression}`: `value` is the text between the braces, so it starts after the `{`.
				classifyExpression(raw, valueFrom + 1, valueFrom + 1 + param.value.length, ranges);
			}
		}
		after = param.end;
	}

	// Parsing stops at the first bad argument, so a `;` only counts as a comment if everything before it parsed.
	while (isBlank(raw[after])) after++;
	if (raw[after] === ";") ranges.push({ from: after, to: raw.length, tag: "lineComment" });
	return ranges;
}

interface MenuStreamState {
	raw: string | null;
	ranges: ReadonlyArray<HighlightRange>;
}

const menuStreamParser: StreamParser<MenuStreamState> = {
	startState: () => ({ raw: null, ranges: [] }),
	// `Menu::ParseMenuLine`: a line whose first non-blank character is `;` is a comment.
	languageData: { commentTokens: { line: ";" } },
	token(stream, state) {
		if (stream.sol() || state.raw !== stream.string) {
			state.raw = stream.string;
			state.ranges = classifyMenuLine(stream.string);
		}
		const pos = stream.pos;
		const range = state.ranges.find((r) => pos >= r.from && pos < r.to);
		if (range === undefined) {
			stream.next();
			return null;
		}
		stream.pos = range.to;
		return range.tag;
	},
};

/** A CM6 language for a 12864 menu file. */
export const menuLanguage = StreamLanguage.define(menuStreamParser);

export interface MenuDiagnosticsOptions {
	/** Path of the file being checked; it must sit under a `menu` folder (default `0:/menu/main`). */
	path?: string;
	/**
	 * Names of the OTHER files in `0:/menu/` - menus and images alike (`listFiles`, `logo.bin`). With it,
	 * `menu/target-missing` and `menu/image-missing` are judged against that list; without it those two
	 * rules are switched off, because "not in the folder" can't be told from "folder not listed".
	 */
	siblings?: ReadonlyArray<string>;
	/** Passed to core; no menu rule depends on it. Default `0.0.0`. */
	firmwareVersion?: string;
	rules?: DiagnoseOptions["rules"];
}

const SIBLING_RULES = ["menu/target-missing", "menu/image-missing"];

/**
 * The `menu/*` findings for one menu file's text, as CM6 diagnostics. `text` must use `\n` line ends
 * (a CM6 document always does): core's offsets count one character per line break. Findings are
 * offsets into `text`, so they can go straight into `applyDiagnostics`/a live linter.
 */
export function menuDiagnostics(text: string, options: MenuDiagnosticsOptions = {}): Array<CmDiagnostic> {
	const path = options.path ?? "0:/menu/main";
	const own = path.replace(/\/+$/, "").split("/").pop()!.toLowerCase();
	const files = [{ path, text }];
	for (const name of options.siblings ?? []) {
		if (name.toLowerCase() !== own) files.push({ path: `${path.slice(0, path.lastIndexOf("/") + 1)}${name}`, text: "" });
	}
	const disabled = [...(options.rules?.disable ?? []), ...(options.siblings === undefined ? SIBLING_RULES : [])];
	const found = diagnoseProject(loadProject(files), {
		firmwareVersion: options.firmwareVersion ?? "0.0.0",
		rules: { ...options.rules, disable: disabled },
	});
	return toCmDiagnostics(found.filter((d) => d.file === path && d.rule.startsWith("menu/")));
}

/** Live linting for a menu file - small by nature (RRF's whole menu buffer is 2500 bytes), so unlike
 *  `diagnostics.ts`'s note about G-code, re-checking on every change is fine. `getOptions` is read on
 *  every run, so `siblings` can follow a directory listing that arrives later. */
export function menuLiveLinter(getOptions: () => MenuDiagnosticsOptions = () => ({})): Extension {
	return gcodeLiveLinter((view: EditorView) => menuDiagnostics(view.state.doc.toString(), getOptions()));
}
