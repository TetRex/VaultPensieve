import { Editor, Notice } from "obsidian";
import type ClaudeAssistantPlugin from "../main";
import { PreviewModal } from "../preview-modal";

export async function continueWriting(
	plugin: ClaudeAssistantPlugin,
	editor: Editor
): Promise<void> {
	const cursor = editor.getCursor();
	const textBefore = editor.getRange({ line: 0, ch: 0 }, cursor);

	if (!textBefore.trim()) {
		new Notice("No text before cursor to continue from.");
		return;
	}

	const systemPrompt = await plugin.buildSystemPrompt();
	const fullSystem =
		systemPrompt +
		"\n\nYou are continuing the user's writing. Output ONLY the continuation text — no preamble, no quotes, no explanation. Match the existing tone and style.";

	let action: "accept" | "retry" | "cancel" = "retry";

	while (action === "retry") {
		const modal = new PreviewModal(plugin.app, "");
		modal.open();

		try {
			const client = plugin.getClient();
			await client.streamMessage(
				fullSystem,
				[{ role: "user", content: `Continue this text:\n\n${textBefore}` }],
				{
					onChunk: (chunk: string) => modal.appendChunk(chunk),
					onComplete: () => modal.finishStreaming(),
					onError: (error: Error) => {
						new Notice(`Error: ${error.message}`);
						modal.finishStreaming();
					},
				}
			);
		} catch (e) {
			modal.finishStreaming();
		}

		action = await modal.waitForAction();

		if (action === "accept") {
			const continuation = modal.getNewText();
			if (continuation) {
				editor.replaceRange(continuation, cursor);
			}
		}
	}
}
