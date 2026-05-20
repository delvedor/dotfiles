/**
 * DCG Guard Extension - Destructive Command Guard Integration
 *
 * Uses https://github.com/Dicklesworthstone/destructive_command_guard
 * to block dangerous bash commands before execution.
 *
 * Requires: dcg installed in PATH (e.g., ~/.local/bin/dcg)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { spawnSync } from "node:child_process";

interface DCGResult {
	schema_version: number;
	dcg_version: string;
	robot_mode: boolean;
	command: string;
	decision: "allow" | "deny" | "warn";
	rule_id?: string;
	pack_id?: string;
	pattern_name?: string;
	reason?: string;
	explanation?: string;
	severity?: "low" | "medium" | "high" | "critical";
}

function checkCommand(command: string): DCGResult | null {
	const result = spawnSync("dcg", ["test", command], {
		encoding: "utf-8",
		env: { ...process.env, DCG_ROBOT: "1" },
		timeout: 5000,
	});

	if (result.error) {
		// dcg not found or other error
		return null;
	}

	try {
		return JSON.parse(result.stdout) as DCGResult;
	} catch {
		return null;
	}
}

export default function (pi: ExtensionAPI) {
	let dcgAvailable = false;

	pi.on("session_start", async (_event, ctx) => {
		// Test if dcg is available
		const test = checkCommand("echo test");
		dcgAvailable = test !== null;

		if (dcgAvailable) {
			ctx.ui.setStatus("dcg", ctx.ui.theme.fg("success", "🛡️ DCG active"));
		} else {
			ctx.ui.setStatus("dcg", ctx.ui.theme.fg("warning", "⚠️ DCG not found"));
		}
	});

	pi.on("tool_call", async (event, ctx) => {
		if (!dcgAvailable) return;
		if (!isToolCallEventType("bash", event)) return;

		const command = event.input.command;
		const result = checkCommand(command);

		if (!result) return; // dcg failed, allow through (fail open)

		// Block denied commands
		if (result.decision === "deny") {
			const severity = result.severity || "high";
			const color = severity === "critical" ? "error" : severity === "high" ? "warning" : "muted";

			ctx.ui.setStatus(
				"dcg",
				ctx.ui.theme.fg(color, `🛡️ DCG blocked: ${result.pattern_name || "destructive command"}`)
			);

			// Build detailed error message
			let message = `DCG blocked destructive command (${severity})`;
			if (result.reason) {
				message += `\n\nReason: ${result.reason}`;
			}
			if (result.explanation) {
				// Truncate long explanations
				const explanation = result.explanation.length > 500
					? result.explanation.slice(0, 500) + "..."
					: result.explanation;
				message += `\n\n${explanation}`;
			}
			if (result.pack_id) {
				message += `\n\nRule: ${result.rule_id} (${result.pack_id})`;
			}

			return { block: true, reason: message };
		}

		// Warn on suspicious commands (allow but notify)
		if (result.decision === "warn") {
			ctx.ui.setStatus(
				"dcg",
				ctx.ui.theme.fg("warning", `⚠️ DCG warning: ${result.pattern_name || "suspicious command"}`)
			);
		}
	});

	pi.registerCommand("dcg", {
		description: "Check DCG status",
		handler: async (_args, ctx) => {
			if (!dcgAvailable) {
				ctx.ui.notify("DCG not available - is dcg in PATH?", "error");
				return;
			}

			const result = spawnSync("dcg", ["packs"], { encoding: "utf-8" });
			ctx.ui.notify(`DCG Status:\n${result.stdout || result.stderr || "OK"}`, "info");
		},
	});
}
