/**
 * `dwc-gcode-core`'s command dictionary (`dwc-gcode-core/dictionary/commands`) as a real CM6
 * `CompletionSource` — command codes (`G1`, `M104`, ...) and, once a known command is on the line,
 * that command's own documented parameter letters.
 *
 * **Safe to run on every keystroke, unlike `diagnostics.ts`'s live linter.** This source only ever
 * calls `lexLine` on the *current line's own text* (`context.state.doc.lineAt(context.pos)`), never
 * the whole document — the same per-line cost `language.ts`'s `StreamLanguage` already pays for
 * highlighting, not the whole-document cost `diagnoseDocument` has. There is no huge-file caveat to
 * repeat here.
 *
 * **Two completion positions, both derived from `lexLine`'s own structural output rather than a
 * hand-rolled regex re-parse of the line:**
 * - *Command code* — the cursor sits inside a command's own code span (`cmd.start`..`cmd.end`)
 *   while it has no params yet (`cmd.params.length === 0`) and no string argument. Confirmed
 *   empirically that `lexLine` happily lexes a bare, even unrecognised, `[GMT][digits]` token into a
 *   `LexedCommand` regardless of whether the dictionary knows it — dictionary lookup only decides
 *   which completions to *offer*, never whether typing itself is accepted.
 * - *Parameter letter* — confirmed empirically that `lexLine` tolerantly lexes a bare, valueless
 *   letter typed after a known command as a real `LexedParam` with `kind: "empty"` and
 *   `valueStart === end` (e.g. `"G1 X"` → one param, `{letter: "X", kind: "empty", start: 3, end: 4}`),
 *   and that a command's own `end` always extends through any such trailing bare letter or even bare
 *   trailing whitespace (`"G1 "` → `cmd.end === 3`) — so both "still typing the letter" and "just
 *   pressed space, nothing typed yet" are positions this module can detect directly from `lexLine`'s
 *   own fields, with no separate boundary-finding logic of its own. This also already extends
 *   correctly to more than one command sharing a line (`"G90 G1 "` → each command's `params` and
 *   `end` cover only its own span) — the same multi-command-per-line fact
 *   `duet-gcode-postprocessor`'s own pipeline had to account for.
 *
 * **Scope note — axis letters (`X`/`Y`/`Z`/...) are not offered beyond what a command's own
 * `parameters` array lists.** `dwc-gcode-core`'s real allowed-axis-letter set (`ALLOWED_AXIS_LETTERS`
 * in `lex.ts`) is a private, unexported module constant, not part of the package's public API —
 * duplicating that list here by hand would be exactly the "never invent a rule" mistake this whole
 * family avoids elsewhere. A command's `axisParameters` field (present on movement commands) is
 * therefore not turned into completions; only its own `parameters` array is. Revisit if
 * `dwc-gcode-core` ever exports the real axis-letter set.
 *
 * **`machineMode` is optional and, when supplied, only excludes commands scoped to OTHER machine
 * modes.** A command with no `machineModes` field is valid in every mode (`CommandSpec`'s own doc
 * comment) and is never excluded. Omitting `machineMode` entirely (the default) offers every command
 * in the dictionary — an honest "I don't know the current mode" default, not a guess.
 */

import type { Completion, CompletionContext, CompletionResult, CompletionSource } from "@codemirror/autocomplete";
import { autocompletion } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { lexLine, type LexedCommand, type MachineMode } from "dwc-gcode-core";
import { COMMANDS, commandSpec } from "dwc-gcode-core/dictionary/commands";
import type { CommandSpec, ParamSpec } from "dwc-gcode-core/dictionary/schema";

export interface GcodeCompletionOptions {
	/** Restrict command-code completions to those valid in this mode (plus mode-agnostic commands).
	 *  Omit to offer every command regardless of mode — see the module doc comment. */
	machineMode?: MachineMode;
}

function describeCommand(spec: CommandSpec): string {
	if (spec.deprecated === undefined) return spec.summary;
	const replacement = spec.deprecated.replacement;
	return `${spec.summary} (deprecated${replacement !== undefined ? `, use ${replacement}` : ""})`;
}

function commandCompletion(spec: CommandSpec): Completion {
	return { label: spec.code, type: "keyword", detail: describeCommand(spec) };
}

function buildCommandOptions(machineMode?: MachineMode): ReadonlyArray<Completion> {
	const specs = Object.values(COMMANDS);
	const inMode = machineMode === undefined
		? specs
		: specs.filter((s) => s.machineModes === undefined || s.machineModes.includes(machineMode));
	return inMode.map(commandCompletion);
}

function describeParam(p: ParamSpec): string {
	const range = p.range !== undefined
		? ` (${p.range.min ?? "−∞"}–${p.range.max ?? "∞"})`
		: "";
	return `${p.description}${range}`;
}

function paramCompletion(p: ParamSpec): Completion {
	return { label: p.letter, type: "property", detail: describeParam(p) };
}

/** The command whose code span or trailing param region contains `posInLine`, if any. */
function commandAt(commands: ReadonlyArray<LexedCommand>, posInLine: number): LexedCommand | null {
	return commands.find((c) => posInLine >= c.start && posInLine <= c.end) ?? null;
}

function commandCodeCompletions(
	context: CompletionContext, lineFrom: number, cmd: LexedCommand,
	options: ReadonlyArray<Completion>,
): CompletionResult | null {
	if (cmd.params.length > 0 || cmd.stringArgument !== null) return null;
	const match = context.matchBefore(/[A-Za-z][\d.]*/);
	if (match === null || match.from !== lineFrom + cmd.start) return null;
	return { from: match.from, options, validFor: /^[A-Za-z][\d.]*$/ };
}

function paramLetterCompletions(
	context: CompletionContext, lineFrom: number, posInLine: number, cmd: LexedCommand,
): CompletionResult | null {
	const spec = commandSpec(cmd.code);
	if (spec === null || spec.parameters.length === 0) return null;

	const params = cmd.params;
	const last = params.length > 0 ? params[params.length - 1] : undefined;
	const typingBareLetter = last !== undefined && last.kind === "empty" && last.valueStart === last.end
		&& posInLine === last.end;

	let from: number;
	let usedLetters: Set<string>;
	if (typingBareLetter) {
		from = lineFrom + last.start;
		usedLetters = new Set(params.slice(0, -1).map((p) => p.letter.toUpperCase()));
	} else if (context.explicit && posInLine === cmd.end && (last === undefined || last.end < posInLine)) {
		from = context.pos;
		usedLetters = new Set(params.map((p) => p.letter.toUpperCase()));
	} else {
		return null;
	}

	const options = spec.parameters
		.filter((p) => !usedLetters.has(p.letter.toUpperCase()))
		.map(paramCompletion);
	if (options.length === 0) return null;
	return { from, options, validFor: /^[A-Za-z]?$/ };
}

/**
 * A real `CompletionSource`, exported directly (in addition to `gcodeCompletion`'s ready-to-use
 * `Extension`) so a host can compose it into its own `autocompletion({override: [...]})` call
 * alongside other sources, or drive it directly in a test the way this package's own tests do.
 */
export function createGcodeCompletionSource(options: GcodeCompletionOptions = {}): CompletionSource {
	const commandOptions = buildCommandOptions(options.machineMode);

	return (context: CompletionContext): CompletionResult | null => {
		const line = context.state.doc.lineAt(context.pos);
		const posInLine = context.pos - line.from;
		const lexed = lexLine(line.text);
		const cmd = commandAt(lexed.commands, posInLine);
		if (cmd === null) return null;

		return commandCodeCompletions(context, line.from, cmd, commandOptions)
			?? paramLetterCompletions(context, line.from, posInLine, cmd);
	};
}

/** Ready-to-use extension: `@codemirror/autocomplete`'s own `autocompletion()` UI, wired to
 *  `createGcodeCompletionSource`'s source as its sole override. */
export function gcodeCompletion(options: GcodeCompletionOptions = {}): Extension {
	return autocompletion({ override: [createGcodeCompletionSource(options)] });
}
