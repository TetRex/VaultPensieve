import { App, Modal } from "obsidian";

export type PreviewAction = "accept" | "retry" | "cancel";

export class PreviewModal extends Modal {
	private originalText: string;
	private newText: string;
	private contentEl_: HTMLElement | null = null;
	private streamingEl: HTMLElement | null = null;
	private resolve: ((action: PreviewAction) => void) | null = null;
	private isStreaming = true;

	constructor(app: App, originalText: string) {
		super(app);
		this.originalText = originalText;
		this.newText = "";
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass("claude-preview-modal");

		contentEl.createEl("h3", { text: "Preview changes" });

		// Original section
		if (this.originalText) {
			contentEl.createEl("h4", { text: "Original" });
			const origDiv = contentEl.createDiv({ cls: "claude-preview-diff" });
			origDiv.textContent = this.originalText;
		}

		// New text section
		contentEl.createEl("h4", { text: "Suggested" });
		this.streamingEl = contentEl.createDiv({
			cls: "claude-preview-diff claude-preview-streaming",
		});
		this.streamingEl.textContent = this.newText || "Generating...";

		// Action buttons
		const actions = contentEl.createDiv({ cls: "claude-preview-actions" });

		const acceptBtn = actions.createEl("button", {
			text: "Accept",
			cls: "mod-cta",
		});
		acceptBtn.addEventListener("click", () => {
			this.resolve?.("accept");
			this.close();
		});

		const retryBtn = actions.createEl("button", { text: "Retry" });
		retryBtn.addEventListener("click", () => {
			this.resolve?.("retry");
			this.close();
		});

		const cancelBtn = actions.createEl("button", { text: "Cancel" });
		cancelBtn.addEventListener("click", () => {
			this.resolve?.("cancel");
			this.close();
		});
	}

	onClose() {
		// If closed without picking an action, treat as cancel
		this.resolve?.("cancel");
		this.contentEl.empty();
	}

	appendChunk(chunk: string) {
		this.newText += chunk;
		if (this.streamingEl) {
			this.streamingEl.textContent = this.newText;
		}
	}

	finishStreaming() {
		this.isStreaming = false;
		this.streamingEl?.removeClass("claude-preview-streaming");
	}

	getNewText(): string {
		return this.newText;
	}

	waitForAction(): Promise<PreviewAction> {
		return new Promise((resolve) => {
			this.resolve = resolve;
		});
	}
}
