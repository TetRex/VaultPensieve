import { ItemView, Notice, WorkspaceLeaf, MarkdownRenderer, setIcon } from "obsidian";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type ClaudeAssistantPlugin from "./main";
import { VAULT_TOOLS, createToolExecutor } from "./vault-tools";

export const CHAT_VIEW_TYPE = "claude-chat-view";

const MODELS = [
	{ value: "claude-sonnet-4-6", label: "Sonnet 4.6" },
	{ value: "claude-haiku-4-5", label: "Haiku 4.5" },
];

interface ChatMessage {
	role: "user" | "assistant" | "tool";
	content: string;
}

export class ClaudeChatView extends ItemView {
	private plugin: ClaudeAssistantPlugin;
	private displayMessages: ChatMessage[] = [];
	private apiMessages: MessageParam[] = [];
	private messagesContainer: HTMLElement | null = null;
	private inputEl: HTMLTextAreaElement | null = null;
	private sendBtn: HTMLButtonElement | null = null;
	private attachBtn: HTMLButtonElement | null = null;
	private modelSelect: HTMLSelectElement | null = null;
	private attachNote = false;
	private attachedNoteName: string | null = null;
	private attachedNoteChip: HTMLElement | null = null;
	private isStreaming = false;

	constructor(leaf: WorkspaceLeaf, plugin: ClaudeAssistantPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string { return CHAT_VIEW_TYPE; }
	getDisplayText(): string { return "Claude Chat"; }
	getIcon(): string { return "message-square"; }

	async onOpen() {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("claude-chat-container");

		// ── Header ──────────────────────────────────────────────
		const header = container.createDiv({ cls: "claude-chat-header" });
		const titleRow = header.createDiv({ cls: "claude-chat-title-row" });
		titleRow.createSpan({ cls: "claude-chat-title", text: "Claude" });

		const headerActions = titleRow.createDiv({ cls: "claude-chat-header-actions" });

		// Model selector
		this.modelSelect = headerActions.createEl("select", { cls: "claude-model-select" });
		for (const m of MODELS) {
			const opt = this.modelSelect.createEl("option", { text: m.label, value: m.value });
			if (m.value === this.plugin.settings.model) opt.selected = true;
		}
		this.modelSelect.addEventListener("change", async () => {
			if (!this.modelSelect) return;
			this.plugin.settings.model = this.modelSelect.value;
			await this.plugin.saveSettings();
			const label = MODELS.find(m => m.value === this.modelSelect!.value)?.label;
			new Notice(`Switched to ${label}`);
		});

		// Clear button
		const clearBtn = headerActions.createEl("button", {
			cls: "claude-icon-btn",
			attr: { title: "Clear chat" },
		});
		setIcon(clearBtn, "trash-2");
		clearBtn.addEventListener("click", () => {
			this.displayMessages = [];
			this.apiMessages = [];
			this.renderMessages();
		});

		// ── Messages ─────────────────────────────────────────────
		this.messagesContainer = container.createDiv({ cls: "claude-chat-messages" });
		this.renderMessages();

		// ── Input area ───────────────────────────────────────────
		const inputArea = container.createDiv({ cls: "claude-chat-input-area" });

		this.inputEl = inputArea.createEl("textarea", {
			cls: "claude-chat-textarea",
			attr: { placeholder: "Message Claude… (Enter to send)", rows: "1" },
		});
		this.inputEl.addEventListener("input", () => this.autoResizeTextarea());
		this.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				this.sendMessage();
			}
		});

		const inputFooter = inputArea.createDiv({ cls: "claude-chat-input-footer" });

		// Attach button
		this.attachBtn = inputFooter.createEl("button", {
			cls: "claude-attach-btn",
			attr: { title: "Attach current note as context" },
		});
		setIcon(this.attachBtn, "paperclip");
		this.attachBtn.createSpan({ text: " Attach note" });
		this.attachBtn.addEventListener("click", () => {
			this.attachNote = !this.attachNote;
			this.attachBtn?.toggleClass("active", this.attachNote);
		});

		// Send button
		this.sendBtn = inputFooter.createEl("button", {
			cls: "claude-send-btn mod-cta",
			attr: { title: "Send (Enter)" },
		});
		setIcon(this.sendBtn, "send");
		this.sendBtn.addEventListener("click", () => this.sendMessage());
	}

	async onClose() {}

	private autoResizeTextarea() {
		if (!this.inputEl) return;
		this.inputEl.style.height = "auto";
		this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 160) + "px";
	}

	private async sendMessage() {
		if (this.isStreaming || !this.inputEl) return;
		const text = this.inputEl.value.trim();
		if (!text) return;

		this.inputEl.value = "";
		this.autoResizeTextarea();
		this.setStreaming(true);

		let userContent = text;
		if (this.attachNote) {
			const activeFile = this.app.workspace.getActiveFile();
			if (activeFile) {
				const noteContent = await this.app.vault.read(activeFile);
				userContent = `[Attached note: ${activeFile.path}]\n\n${noteContent}\n\n---\n\n${text}`;
			}
			this.attachNote = false;
			this.attachBtn?.toggleClass("active", false);
		}

		this.displayMessages.push({ role: "user", content: text });
		this.apiMessages.push({ role: "user", content: userContent });

		const assistantMsg: ChatMessage = { role: "assistant", content: "" };
		this.displayMessages.push(assistantMsg);
		this.renderMessages();
		this.scrollToBottom();

		try {
			const client = this.plugin.getClient();
			const systemPrompt = await this.plugin.buildSystemPrompt();
			const toolExecutor = createToolExecutor(this.app);

			const newMessages = await client.streamMessage(
				systemPrompt,
				this.apiMessages,
				{
					onChunk: (chunk: string) => {
						assistantMsg.content += chunk;
						this.renderMessages();
						this.scrollToBottom();
					},
					onComplete: () => {
						this.renderMessages();
						this.scrollToBottom();
					},
					onError: (error: Error) => {
						new Notice(`Claude error: ${error.message}`);
					},
				},
				VAULT_TOOLS,
				async (name: string, input: Record<string, unknown>) => {
					const result = await toolExecutor(name, input);
					this.displayMessages.push({
						role: "tool",
						content: `${name}: ${result}`,
					});
					this.renderMessages();
					return result;
				}
			);

			for (const msg of newMessages) {
				this.apiMessages.push(msg);
			}
		} catch (e) {
			if (assistantMsg.content === "") {
				assistantMsg.content = e instanceof Error ? e.message : "Something went wrong";
			}
			this.renderMessages();
		} finally {
			this.setStreaming(false);
		}
	}

	private setStreaming(streaming: boolean) {
		this.isStreaming = streaming;
		if (this.sendBtn) this.sendBtn.disabled = streaming;
		if (this.inputEl) this.inputEl.disabled = streaming;
	}

	private renderMessages() {
		if (!this.messagesContainer) return;
		this.messagesContainer.empty();

		if (this.displayMessages.length === 0) {
			const empty = this.messagesContainer.createDiv({ cls: "claude-chat-empty" });
			empty.createDiv({ cls: "claude-chat-empty-icon", text: "✦" });
			empty.createDiv({ cls: "claude-chat-empty-text", text: "Ask Claude anything about your vault" });
			return;
		}

		for (const msg of this.displayMessages) {
			if (msg.role === "tool") {
				const toolDiv = this.messagesContainer.createDiv({ cls: "claude-tool-call" });
				const icon = toolDiv.createSpan({ cls: "claude-tool-icon" });
				setIcon(icon, "settings-2");
				toolDiv.createSpan({ cls: "claude-tool-text", text: msg.content });
				continue;
			}

			const row = this.messagesContainer.createDiv({ cls: `claude-msg-row ${msg.role}` });
			const bubble = row.createDiv({ cls: "claude-msg-bubble" });

			if (msg.role === "assistant") {
				MarkdownRenderer.render(this.app, msg.content || "…", bubble, "", this);
			} else {
				bubble.textContent = msg.content;
			}
		}
	}

	private scrollToBottom() {
		if (this.messagesContainer) {
			this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
		}
	}
}
