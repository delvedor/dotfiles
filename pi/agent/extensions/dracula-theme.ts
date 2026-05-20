/**
 * Dracula Theme Extension for pi.dev
 *
 * Auto-activates the Dracula theme and provides theme-related utilities.
 *
 * Dracula color palette:
 * - Purple #BD93F9 - Keywords, accent
 * - Pink   #FF79C6 - Strings, secondary accent
 * - Cyan   #8BE9FD - Functions, links, primary accent
 * - Green  #50FA7B - Success, added lines
 * - Yellow #F1FA8C - Warnings, strings
 * - Orange #FFB86C - Variables, bash mode
 * - Red    #FF5555 - Errors, removed lines
 * - Background #282A36 - Dark background
 * - Foreground #F8F8F2 - Main text
 * - Comment    #6272A4 - Muted text, borders
 * - Selection  #44475A - Selection bg
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Dracula color constants for use by other extensions
export const DRACULA = {
	purple: "#BD93F9",
	pink: "#FF79C6",
	cyan: "#8BE9FD",
	green: "#50FA7B",
	yellow: "#F1FA8C",
	orange: "#FFB86C",
	red: "#FF5555",
	bg: "#282A36",
	fg: "#F8F8F2",
	dim: "#6272A4",
	selection: "#44475A",
} as const;

// ANSI truecolor helpers
export const C = {
	purple: "\x1b[38;2;189;147;249m",
	pink: "\x1b[38;2;255;121;198m",
	cyan: "\x1b[38;2;139;233;253m",
	green: "\x1b[38;2;80;250;123m",
	yellow: "\x1b[38;2;241;250;140m",
	orange: "\x1b[38;2;255;184;108m",
	red: "\x1b[38;2;255;85;85m",
	fg: "\x1b[38;2;248;248;242m",
	dim: "\x1b[38;2;98;114;164m",
	reset: "\x1b[0m",
} as const;

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		// Theme is auto-loaded from ~/.pi/agent/themes/dracula.json
		// Just show a status indicator
		ctx.ui.setStatus("dracula", ctx.ui.theme.fg("accent", "🧛 Dracula"));
	});

	pi.registerCommand("dracula", {
		description: "Dracula theme info and utilities",
		handler: async (args, ctx) => {
			const subcmd = args.trim() || "info";

			switch (subcmd) {
				case "info":
					ctx.ui.notify(
						`Dracula Theme\n\n` +
						`Palette:\n` +
						`  ${C.purple}Purple #BD93F9${C.reset} - Keywords, accent\n` +
						`  ${C.pink}Pink   #FF79C6${C.reset} - Strings\n` +
						`  ${C.cyan}Cyan   #8BE9FD${C.reset} - Functions, links\n` +
						`  ${C.green}Green  #50FA7B${C.reset} - Success\n` +
						`  ${C.yellow}Yellow #F1FA8C${C.reset} - Warnings\n` +
						`  ${C.orange}Orange #FFB86C${C.reset} - Variables\n` +
						`  ${C.red}Red    #FF5555${C.reset} - Errors\n` +
						`\nLocation: ~/.pi/agent/themes/dracula.json`,
						"info"
					);
					break;

				case "colors":
					// Show color swatches
					const swatches = [
						`${C.purple}████${C.reset} Purple`,
						`${C.pink}████${C.reset} Pink`,
						`${C.cyan}████${C.reset} Cyan`,
						`${C.green}████${C.reset} Green`,
						`${C.yellow}████${C.reset} Yellow`,
						`${C.orange}████${C.reset} Orange`,
						`${C.red}████${C.reset} Red`,
						`${C.dim}████${C.reset} Comment`,
					];
					ctx.ui.notify(swatches.join("\n"), "info");
					break;

				default:
					ctx.ui.notify("Usage: /dracula [info|colors]", "error");
			}
		},
	});

	// Export colors for other extensions via events
	pi.events.emit("dracula:colors", DRACULA);
}
