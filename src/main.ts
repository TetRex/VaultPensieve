import { Notice, Plugin } from "obsidian";
import {
	ClaudeAssistantSettings,
	ClaudeSettingTab,
	DEFAULT_SETTINGS,
} from "./settings";
import { ClaudeClient } from "./claude-client";
import { ClaudeChatView, CHAT_VIEW_TYPE } from "./chat-view";
import { VaultInstructions } from "./vault-instructions";
import { continueWriting } from "./commands/continue-writing";
import { summarizeNote } from "./commands/summarize-note";
import { improveRewrite } from "./commands/improve-rewrite";

export default class ClaudeAssistantPlugin extends Plugin {
	settings: ClaudeAssistantSettings = DEFAULT_SETTINGS;
	private client: ClaudeClient | null = null;
	private vaultInstructions: VaultInstructions | null = null;

	async onload() {
		await this.loadSettings();
		this.vaultInstructions = new VaultInstructions(this.app);

		this.addSettingTab(new ClaudeSettingTab(this.app, this));

		// Register chat sidebar view
		this.registerView(CHAT_VIEW_TYPE, (leaf) => new ClaudeChatView(leaf, this));

		// Ribbon icon to open chat
		this.addRibbonIcon("message-square", "Open Claude Chat", () => {
			this.activateChatView();
		});

		// Command: open chat
		this.addCommand({
			id: "open-chat",
			name: "Open Claude Chat",
			callback: () => this.activateChatView(),
		});

		// Command: continue writing
		this.addCommand({
			id: "continue-writing",
			name: "Continue writing",
			editorCallback: (editor) => continueWriting(this, editor),
		});

		// Command: summarize note
		this.addCommand({
			id: "summarize-note",
			name: "Summarize note",
			editorCallback: (editor) => summarizeNote(this, editor),
		});

		// Command: improve/rewrite selection
		this.addCommand({
			id: "improve-rewrite",
			name: "Improve/rewrite selection",
			editorCallback: (editor) => improveRewrite(this, editor),
		});

		// Offer to create CLAUDE.md if none exists
		this.app.workspace.onLayoutReady(() => {
			if (!this.vaultInstructions?.hasInstructions()) {
				new Notice(
					"Claude Assistant: No CLAUDE.md found. Create one in settings or manually at vault root.",
					8000
				);
			}
		});
	}

	async onunload() {
		this.client = null;
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.client = null;
	}

	getClient(): ClaudeClient {
		if (!this.client) {
			if (!this.settings.apiKey) {
				throw new Error(
					"API key not configured. Please set it in plugin settings."
				);
			}
			this.client = new ClaudeClient(
				this.settings.apiKey,
				this.settings.model
			);
		}
		return this.client;
	}

	async buildSystemPrompt(): Promise<string> {
		const parts: string[] = [
			"You are Claude, an AI assistant integrated into Obsidian. You help the user with writing, organizing, and managing their notes. You have access to vault tools to read and modify files when asked.",
		];

		// Load CLAUDE.md instructions
		if (this.vaultInstructions) {
			const activeFile = this.app.workspace.getActiveFile();
			const instructions = await this.vaultInstructions.getInstructions(
				activeFile?.path
			);
			if (instructions) {
				parts.push("## User Instructions\n\n" + instructions);
			}
		}

		// Custom system prompt from settings
		if (this.settings.customSystemPrompt.trim()) {
			parts.push(
				"## Additional Instructions\n\n" +
					this.settings.customSystemPrompt
			);
		}

		return parts.join("\n\n");
	}

	private async activateChatView() {
		const existing = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE);
		if (existing.length > 0) {
			this.app.workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({ type: CHAT_VIEW_TYPE, active: true });
			this.app.workspace.revealLeaf(leaf);
		}
	}
}
