import type { Editor} from "obsidian";
import { Notice } from "obsidian";
import type ClaudeAssistantPlugin from "../main";
import { PreviewModal } from "../preview-modal";

export async function summarizeNote(
	plugin: ClaudeAssistantPlugin,
	editor: Editor
): Promise<void> {
	const fullText = editor.getValue();

	if (!fullText.trim()) {
		new Notice("Note is empty — nothing to summarize.");
		return;
	}

	const systemPrompt = await plugin.buildSystemPrompt();
	const fullSystem =
		systemPrompt +
		"\n\nSummarize the note the user provides. Output ONLY the summary — no preamble, no quotes, no explanation. Produce a concise but comprehensive summary.";

	let action: "accept" | "retry" | "cancel" = "retry";

	while (action === "retry") {
		const modal = new PreviewModal(plugin.app, fullText);
		modal.open();

		try {
			const client = plugin.getClient();
			await client.streamMessage(
				fullSystem,
				[{ role: "user", content: `Summarize this note:\n\n${fullText}` }],
				{
					onChunk: (chunk: string) => modal.appendChunk(chunk),
					onComplete: () => modal.finishStreaming(),
					onError: (error: Error) => {
						new Notice(`Error: ${error.message}`);
						modal.finishStreaming();
					},
				}
			);
		} catch {
			modal.finishStreaming();
		}

		action = await modal.waitForAction();

		if (action === "accept") {
			const summary = modal.getNewText();
			if (summary) {
				editor.setValue(summary);
			}
		}
	}
}
