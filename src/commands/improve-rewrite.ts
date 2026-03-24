import type { Editor} from "obsidian";
import { Notice } from "obsidian";
import type ClaudeAssistantPlugin from "../main";
import { PreviewModal } from "../preview-modal";

export async function improveRewrite(
	plugin: ClaudeAssistantPlugin,
	editor: Editor
): Promise<void> {
	const selection = editor.getSelection();

	if (!selection.trim()) {
		new Notice("Select text to improve/rewrite.");
		return;
	}

	const systemPrompt = await plugin.buildSystemPrompt();
	const fullSystem =
		systemPrompt +
		"\n\nRewrite and improve the user's selected text. Output ONLY the rewritten text — no preamble, no quotes, no explanation. Preserve the original meaning while improving clarity, flow, and style.";

	let action: "accept" | "retry" | "cancel" = "retry";

	while (action === "retry") {
		const modal = new PreviewModal(plugin.app, selection);
		modal.open();

		try {
			const client = plugin.getClient();
			await client.streamMessage(
				fullSystem,
				[{ role: "user", content: `Improve this text:\n\n${selection}` }],
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
			const improved = modal.getNewText();
			if (improved) {
				editor.replaceSelection(improved);
			}
		}
	}
}
