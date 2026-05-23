/**
 * Plan Mode Extension
 *
 * Read-only exploration mode for safe code analysis.
 * When enabled, only read-only tools are available.
 *
 * Features:
 * - /plan command or Ctrl+Alt+P to toggle
 * - Bash restricted to allowlisted read-only commands
 * - Extracts numbered plan steps from "Plan:" sections
 * - [DONE:n] markers to complete steps during execution
 * - Progress tracking widget during execution
 *
 * Restore semantics:
 *   When entering plan mode the *current* active tool list is captured.
 *   When leaving plan mode it is restored verbatim — so we honour whatever
 *   the user/session had enabled, instead of forcing a hard-coded set.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, TextContent } from "@earendil-works/pi-ai";
import type {
	CustomEntry,
	ExtensionAPI,
	ExtensionContext,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { extractTodoItems, isSafeCommand, markCompletedSteps, type TodoItem } from "./utils.js";

// Tools available while plan mode is active.
const PLAN_MODE_TOOLS = ["read", "bash", "grep", "find", "ls", "questionnaire"];
const STORAGE_KEY = "plan-mode";

interface PlanModePersistedState {
	enabled: boolean;
	todos?: TodoItem[];
	executing?: boolean;
	/** Tools that were active when plan mode was entered, restored on exit. */
	savedTools?: string[];
}

// === Type guards ===

function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
	return m.role === "assistant" && Array.isArray(m.content);
}

function isTextContent(block: { type: string }): block is TextContent {
	return block.type === "text";
}

function isCustomEntryOfType(customType: string) {
	return (entry: SessionEntry): entry is CustomEntry => entry.type === "custom" && entry.customType === customType;
}

const isPlanModeStateEntry = isCustomEntryOfType(STORAGE_KEY);
const isPlanModeExecuteEntry = isCustomEntryOfType("plan-mode-execute");

function isPersistedState(value: unknown): value is PlanModePersistedState {
	if (typeof value !== "object" || value === null) return false;
	const v = value as Record<string, unknown>;
	return typeof v.enabled === "boolean";
}

// Extract text content from an assistant message
function getTextContent(message: AssistantMessage): string {
	return message.content
		.filter(isTextContent)
		.map((block) => block.text)
		.join("\n");
}

export default function planModeExtension(pi: ExtensionAPI): void {
	let planModeEnabled = false;
	let executionMode = false;
	let todoItems: TodoItem[] = [];
	let savedTools: string[] = [];

	pi.registerFlag("plan", {
		description: "Start in plan mode (read-only exploration)",
		type: "boolean",
		default: false,
	});

	function persistState(): void {
		const state: PlanModePersistedState = {
			enabled: planModeEnabled,
			todos: todoItems,
			executing: executionMode,
			savedTools,
		};
		pi.appendEntry(STORAGE_KEY, state);
	}

	function updateStatus(ctx: ExtensionContext): void {
		// Footer status
		if (executionMode && todoItems.length > 0) {
			const completed = todoItems.filter((t) => t.completed).length;
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("accent", `📋 ${completed}/${todoItems.length}`));
		} else if (planModeEnabled) {
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "⏸ plan"));
		} else {
			ctx.ui.setStatus("plan-mode", undefined);
		}

		// Widget showing todo list
		if (executionMode && todoItems.length > 0) {
			const lines = todoItems.map((item) => {
				if (item.completed) {
					return (
						ctx.ui.theme.fg("success", "☑ ") +
						ctx.ui.theme.fg("muted", ctx.ui.theme.strikethrough(item.text))
					);
				}
				return `${ctx.ui.theme.fg("muted", "☐ ")}${item.text}`;
			});
			ctx.ui.setWidget("plan-todos", lines);
		} else {
			ctx.ui.setWidget("plan-todos", undefined);
		}

		// Notify the statusline (and any other extension listening) so it can
		// include a plan-mode indicator in the footer without polling.
		const completed = todoItems.filter((t) => t.completed).length;
		pi.events.emit("plan-mode:status", {
			enabled: planModeEnabled,
			executing: executionMode && todoItems.length > 0,
			completed,
			total: todoItems.length,
		});
	}

	/**
	 * Re-activate the user's pre-plan-mode tool set. Falls back to "all known
	 * tools" if we never captured a baseline (e.g. first run with no entry).
	 */
	function restoreSavedTools(): void {
		const restore = savedTools.length > 0 ? savedTools : pi.getAllTools().map((t) => t.name);
		pi.setActiveTools(restore);
	}

	function enterPlanMode(ctx: ExtensionContext): void {
		// Only capture the baseline if we aren't already in plan mode. A defensive
		// double-call (shortcut spam, etc.) would otherwise clobber savedTools with
		// PLAN_MODE_TOOLS and silently break the restore-on-exit contract.
		if (!planModeEnabled) {
			savedTools = pi.getActiveTools();
		}
		planModeEnabled = true;
		executionMode = false;
		todoItems = [];
		pi.setActiveTools(PLAN_MODE_TOOLS);
		ctx.ui.notify(`Plan mode enabled. Tools: ${PLAN_MODE_TOOLS.join(", ")}`);
		updateStatus(ctx);
		persistState();
	}

	function leavePlanMode(ctx: ExtensionContext, reason: "manual" | "execute"): void {
		planModeEnabled = false;
		if (reason === "manual") {
			executionMode = false;
			todoItems = [];
		}
		restoreSavedTools();
		ctx.ui.notify("Plan mode disabled. Default tools restored.");
		updateStatus(ctx);
		persistState();
	}

	function togglePlanMode(ctx: ExtensionContext): void {
		if (planModeEnabled) {
			leavePlanMode(ctx, "manual");
		} else {
			enterPlanMode(ctx);
		}
	}

	pi.registerCommand("plan", {
		description: "Toggle plan mode (read-only exploration)",
		handler: async (_args, ctx) => togglePlanMode(ctx),
	});

	pi.registerCommand("todos", {
		description: "Show current plan todo list",
		handler: async (_args, ctx) => {
			if (todoItems.length === 0) {
				ctx.ui.notify("No todos. Create a plan first with /plan", "info");
				return;
			}
			const list = todoItems
				.map((item, i) => `${i + 1}. ${item.completed ? "✓" : "○"} ${item.text}`)
				.join("\n");
			ctx.ui.notify(`Plan Progress:\n${list}`, "info");
		},
	});

	pi.registerShortcut(Key.ctrlAlt("p"), {
		description: "Toggle plan mode",
		handler: async (ctx) => togglePlanMode(ctx),
	});

	// Block destructive bash commands in plan mode
	pi.on("tool_call", async (event) => {
		if (!planModeEnabled) return;
		if (!isToolCallEventType("bash", event)) return;

		const command = event.input.command;
		if (!isSafeCommand(command)) {
			return {
				block: true,
				reason: `Plan mode: command blocked (not allowlisted). Use /plan to disable plan mode first.\nCommand: ${command}`,
			};
		}
	});

	// Filter out stale plan mode context when not in plan mode
	pi.on("context", async (event) => {
		if (planModeEnabled) return;

		return {
			messages: event.messages.filter((m) => {
				const msg = m as AgentMessage & { customType?: string };
				if (msg.customType === "plan-mode-context") return false;
				if (msg.role !== "user") return true;

				const content = msg.content;
				if (typeof content === "string") {
					return !content.includes("[PLAN MODE ACTIVE]");
				}
				if (Array.isArray(content)) {
					return !content.some(
						(c) => c.type === "text" && (c as TextContent).text?.includes("[PLAN MODE ACTIVE]"),
					);
				}
				return true;
			}),
		};
	});

	// Inject plan/execution context before agent starts
	pi.on("before_agent_start", async () => {
		if (planModeEnabled) {
			return {
				message: {
					customType: "plan-mode-context",
					content: `[PLAN MODE ACTIVE]
You are in plan mode - a read-only exploration mode for safe code analysis.

Restrictions:
- You can only use: read, bash, grep, find, ls, questionnaire
- You CANNOT use: edit, write (file modifications are disabled)
- Bash is restricted to an allowlist of read-only commands

Ask clarifying questions using the questionnaire tool.
Use brave-search skill via bash for web research.

Create a detailed numbered plan under a "Plan:" header:

Plan:
1. First step description
2. Second step description
...

Do NOT attempt to make changes - just describe what you would do.`,
					display: false,
				},
			};
		}

		if (executionMode && todoItems.length > 0) {
			const remaining = todoItems.filter((t) => !t.completed);
			const todoList = remaining.map((t) => `${t.step}. ${t.text}`).join("\n");
			return {
				message: {
					customType: "plan-execution-context",
					content: `[EXECUTING PLAN - Full tool access enabled]

Remaining steps:
${todoList}

Execute each step in order.
After completing a step, include a [DONE:n] tag in your response.`,
					display: false,
				},
			};
		}
	});

	// Track progress after each turn (markCompletedSteps mutates `todoItems` in place).
	pi.on("turn_end", async (event, ctx) => {
		if (!executionMode || todoItems.length === 0) return;
		if (!isAssistantMessage(event.message)) return;

		const text = getTextContent(event.message);
		if (markCompletedSteps(text, todoItems) > 0) {
			updateStatus(ctx);
		}
		persistState();
	});

	// Handle plan completion and plan mode UI
	pi.on("agent_end", async (event, ctx) => {
		// Check if execution is complete
		if (executionMode && todoItems.length > 0) {
			if (todoItems.every((t) => t.completed)) {
				const completedList = todoItems.map((t) => `~~${t.text}~~`).join("\n");
				pi.sendMessage(
					{ customType: "plan-complete", content: `**Plan Complete!** ✓\n\n${completedList}`, display: true },
					{ triggerTurn: false },
				);
				executionMode = false;
				todoItems = [];
				restoreSavedTools();
				updateStatus(ctx);
				persistState();
			}
			return;
		}

		if (!planModeEnabled || !ctx.hasUI) return;

		// Extract todos from last assistant message
		const lastAssistant = event.messages.findLast(isAssistantMessage);
		if (lastAssistant) {
			const extracted = extractTodoItems(getTextContent(lastAssistant));
			if (extracted.length > 0) {
				todoItems = extracted;
			}
		}

		// Show plan steps and prompt for next action
		if (todoItems.length > 0) {
			const todoListText = todoItems.map((t, i) => `${i + 1}. ☐ ${t.text}`).join("\n");
			pi.sendMessage(
				{
					customType: "plan-todo-list",
					content: `**Plan Steps (${todoItems.length}):**\n\n${todoListText}`,
					display: true,
				},
				{ triggerTurn: false },
			);
		}

		const choice = await ctx.ui.select("Plan mode - what next?", [
			todoItems.length > 0 ? "Execute the plan (track progress)" : "Execute the plan",
			"Stay in plan mode",
			"Refine the plan",
		]);

		if (choice?.startsWith("Execute")) {
			planModeEnabled = false;
			executionMode = todoItems.length > 0;
			restoreSavedTools();
			updateStatus(ctx);

			const execMessage =
				todoItems.length > 0
					? `Execute the plan. Start with: ${todoItems[0].text}`
					: "Execute the plan you just created.";
			// Use deliverAs: "nextTurn" so pi queues the turn trigger after the
			// current agent_end processing settles. Calling triggerTurn: true
			// directly inside agent_end causes "Agent is already processing".
			pi.sendMessage(
				{ customType: "plan-mode-execute", content: execMessage, display: true },
				{ deliverAs: "nextTurn" },
			);
			persistState();
		} else if (choice === "Refine the plan") {
			const refinement = await ctx.ui.editor("Refine the plan:", "");
			if (refinement?.trim()) {
				// Same issue: followUp queues after current agent_end handler returns.
				pi.sendUserMessage(refinement.trim(), { deliverAs: "followUp" });
			}
		}
	});

	// Restore state on session start/resume
	pi.on("session_start", async (_event, ctx) => {
		const entries = ctx.sessionManager.getEntries();

		// Restore persisted state first (last write wins).
		const planModeEntry = entries.filter(isPlanModeStateEntry).pop();
		if (planModeEntry && isPersistedState(planModeEntry.data)) {
			const data = planModeEntry.data;
			planModeEnabled = data.enabled;
			todoItems = data.todos ?? todoItems;
			executionMode = data.executing ?? executionMode;
			savedTools = data.savedTools ?? savedTools;
		}

		// `--plan` is an explicit user signal at startup — it must win over
		// whatever the prior session persisted. Also reset todos and savedTools
		// so the new run starts from a clean baseline and captures the *current*
		// tool set, not whatever was active last time. Persist immediately so a
		// crash before any toggle/turn doesn't leave stale on-disk state.
		if (pi.getFlag("plan") === true) {
			planModeEnabled = true;
			executionMode = false;
			todoItems = [];
			savedTools = [];
			persistState();
		}

		// On resume: re-scan messages to rebuild completion state.
		// Only scan messages AFTER the last "plan-mode-execute" entry — avoids picking
		// up [DONE:n] from previous plan runs. If no execute marker is found, skip the
		// scan entirely (we have no safe anchor and would otherwise mis-mark steps).
		const isResume = planModeEntry !== undefined;
		if (isResume && executionMode && todoItems.length > 0) {
			const executeIndex = entries.findLastIndex(isPlanModeExecuteEntry);
			if (executeIndex >= 0) {
				const messages: AssistantMessage[] = [];
				for (let i = executeIndex + 1; i < entries.length; i++) {
					const entry = entries[i];
					if (entry.type === "message" && isAssistantMessage(entry.message)) {
						messages.push(entry.message);
					}
				}
				const allText = messages.map(getTextContent).join("\n");
				markCompletedSteps(allText, todoItems);
			}
		}

		if (planModeEnabled) {
			// On a fresh session_start (not from a manual toggle) we may not have a
			// saved baseline yet — capture the current tool list before clamping.
			if (savedTools.length === 0) {
				savedTools = pi.getActiveTools();
			}
			pi.setActiveTools(PLAN_MODE_TOOLS);
		}
		updateStatus(ctx);
	});
}
