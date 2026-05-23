/**
 * Alucard Theme Extension for pi.dev
 *
 * Companion extension for the alucard.json light theme.
 * Provides the theme palette to other extensions (notably statusline)
 * via the shared `theme:ansi` event on `pi.events`.
 *
 * Alucard color palette:
 * - Purple  #644ac9 - Keywords, accent
 * - Pink    #a3144d - Strings, secondary accent
 * - Cyan    #036a96 - Functions, links
 * - Green   #14710a - Success, added lines
 * - Yellow  #7a6012 - Warnings, thinking-medium
 * - Orange  #a34d14 - Variables, bash mode
 * - Red     #cb3a2a - Errors, removed lines
 * - BG      #fffbeb - Warm cream background
 * - FG      #1f1f1f - Near-black foreground
 * - Dim     #6c664b - Muted text, borders (= comment in theme JSON)
 * - Sel     #cfcfde - Selection background
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Hex palette — single source of truth.
export const ALUCARD = {
	purple:    "#644ac9",
	pink:      "#a3144d",
	cyan:      "#036a96",
	green:     "#14710a",
	yellow:    "#7a6012",
	orange:    "#a34d14",
	red:       "#cb3a2a",
	bg:        "#fffbeb",
	fg:        "#1f1f1f",
	dim:       "#6c664b",
	selection: "#cfcfde",
} as const;

type AlucardKey = keyof typeof ALUCARD;

function hexToRgb(hex: string): readonly [number, number, number] {
	const h = hex.startsWith("#") ? hex.slice(1) : hex;
	const r = Number.parseInt(h.slice(0, 2), 16);
	const g = Number.parseInt(h.slice(2, 4), 16);
	const b = Number.parseInt(h.slice(4, 6), 16);
	return [r, g, b];
}

function ansiFg(hex: string): string {
	const [r, g, b] = hexToRgb(hex);
	return `\x1b[38;2;${r};${g};${b}m`;
}

// ANSI truecolor helpers derived from ALUCARD (one source of truth).
export const C: Record<AlucardKey, string> & { reset: string } = {
	purple:    ansiFg(ALUCARD.purple),
	pink:      ansiFg(ALUCARD.pink),
	cyan:      ansiFg(ALUCARD.cyan),
	green:     ansiFg(ALUCARD.green),
	yellow:    ansiFg(ALUCARD.yellow),
	orange:    ansiFg(ALUCARD.orange),
	red:       ansiFg(ALUCARD.red),
	bg:        ansiFg(ALUCARD.bg),
	fg:        ansiFg(ALUCARD.fg),
	dim:       ansiFg(ALUCARD.dim),
	selection: ansiFg(ALUCARD.selection),
	reset:     "\x1b[0m",
};


const PALETTE_ENTRIES: ReadonlyArray<readonly [AlucardKey, string, string]> = [
	["purple", ALUCARD.purple, "Keywords, accent"],
	["pink",   ALUCARD.pink,   "Strings"],
	["cyan",   ALUCARD.cyan,   "Functions, links"],
	["green",  ALUCARD.green,  "Success"],
	["yellow", ALUCARD.yellow, "Warnings"],
	["orange", ALUCARD.orange, "Variables"],
	["red",    ALUCARD.red,    "Errors"],
	["dim",    ALUCARD.dim,    "Comment / muted"],
];

const RESET = C.reset;

function formatInfo(): string {
	const rows = PALETTE_ENTRIES.map(
		([key, hex, label]) => `  ${C[key]}${key.padEnd(7)} ${hex}${RESET} - ${label}`,
	).join("\n");
	return `Alucard Theme\n\nPalette:\n${rows}\n\nLocation: ~/.pi/agent/themes/alucard.json`;
}

function formatColors(): string {
	return PALETTE_ENTRIES.map(([key, , label]) => `${C[key]}████${RESET} ${label} (${key})`).join("\n");
}

export default function (pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		ctx.ui.setStatus("alucard", ctx.ui.theme.fg("accent", "🧛 Alucard"));

		// Broadcast the hex palette so other extensions can derive their own colours.
		pi.events.emit("alucard:colors", ALUCARD);

	});

	pi.registerCommand("alucard", {
		description: "Alucard theme info and utilities",
		handler: async (args, ctx) => {
			const subcmd = args.trim() || "info";

			switch (subcmd) {
				case "info": {
					ctx.ui.notify(formatInfo(), "info");
					break;
				}
				case "colors":
				case "palette": {
					ctx.ui.notify(formatColors(), "info");
					break;
				}
				default: {
					ctx.ui.notify("Usage: /alucard [info|colors|palette]", "error");
				}
			}
		},
	});
}
