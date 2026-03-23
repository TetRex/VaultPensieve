import { ItemView, Notice, WorkspaceLeaf, MarkdownRenderer } from "obsidian";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type ClaudeAssistantPlugin from "./main";
import { VAULT_TOOLS, createToolExecutor } from "./vault-tools";

export const CHAT_VIEW_TYPE = "claude-chat-view";

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
	private attachNote = false;
	private attachBtn: HTMLButtonElement | null = null;
	private isStreaming = false;

	constructor(leaf: WorkspaceLeaf, plugin: ClaudeAssistantPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return CHAT_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Claude Chat";
	}

	getIcon(): string {
		return "message-square";
	}

	async onOpen() {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("claude-chat-container");

		// Messages area
		this.messagesContainer = container.createDiv({ cls: "claude-chat-messages" });

		// Input area
		const inputArea = container.createDiv({ cls: "claude-chat-input-area" });

		// Buttons row (attach + actions)
		const buttonsRow = inputArea.createDiv({ cls: "claude-chat-buttons" });

		this.attachBtn = buttonsRow.createEl("button", {
			text: "Attach note",
			cls: "claude-attach-btn",
		});
		this.attachBtn.addEventListener("click", () => {
			this.attachNote = !this.attachNote;
			this.attachBtn?.toggleClass("active", this.attachNote);
			this.attachBtn!.textContent = this.attachNote
				? "Note attached"
				: "Attach note";
		});

		const clearBtn = buttonsRow.createEl("button", { text: "Clear" });
		clearBtn.addEventListener("click", () => {
			this.displayMessages = [];
			this.apiMessages = [];
			this.renderMessages();
		});

		// Text input
		this.inputEl = inputArea.createEl("textarea", {
			placeholder: "Ask Claude...",
		});
		this.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				this.sendMessage();
			}
		});

		// Send button
		const sendRow = inputArea.createDiv({ cls: "claude-chat-buttons" });
		const sendBtn = sendRow.createEl("button", {
			text: "Send",
			cls: "mod-cta",
		});
		sendBtn.addEventListener("click", () => this.sendMessage());
	}

	async onClose() {
		// Nothing to clean up
	}

	private async sendMessage() {
		if (this.isStreaming || !this.inputEl) return;
		const text = this.inputEl.value.trim();
		if (!text) return;

		this.inputEl.value = "";

		// Build user content — optionally attach current note
		let userContent = text;
		if (this.attachNote) {
			const activeFile = this.app.workspace.getActiveFile();
			if (activeFile) {
				const noteContent = await this.app.vault.read(activeFile);
				userContent = `[Attached note: ${activeFile.path}]\n\n${noteContent}\n\n---\n\n${text}`;
			}
			// Reset attach toggle
			this.attachNote = false;
			this.attachBtn?.toggleClass("active", false);
			if (this.attachBtn) this.attachBtn.textContent = "Attach note";
		}

		this.displayMessages.push({ role: "user", content: text });
		this.apiMessages.push({ role: "user", content: userContent });
		this.renderMessages();

		// Stream Claude's response
		this.isStreaming = true;
		const assistantMsg: ChatMessage = { role: "assistant", content: "" };
		this.displayMessages.push(assistantMsg);

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
						content: `Tool: ${name}\n${result}`,
					});
					this.renderMessages();
					return result;
				}
			);

			// Append API messages so conversation history stays in sync
			for (const msg of newMessages) {
				this.apiMessages.push(msg);
			}
		} catch (e) {
			if (assistantMsg.content === "") {
				assistantMsg.content =
					"Error: " +
					(e instanceof Error ? e.message : "Something went wrong");
			}
			this.renderMessages();
		} finally {
			this.isStreaming = false;
		}
	}

	private renderMessages() {
		if (!this.messagesContainer) return;
		this.messagesContainer.empty();

		for (const msg of this.displayMessages) {
			const div = this.messagesContainer.createDiv({
				cls: `claude-chat-message ${msg.role}`,
			});
			if (msg.role === "assistant" && msg.content) {
				MarkdownRenderer.render(
					this.app,
					msg.content,
					div,
					"",
					this
				);
			} else {
				div.textContent = msg.content || "...";
			}
		}
	}

	private scrollToBottom() {
		if (this.messagesContainer) {
			this.messagesContainer.scrollTop =
				this.messagesContainer.scrollHeight;
		}
	}
}
