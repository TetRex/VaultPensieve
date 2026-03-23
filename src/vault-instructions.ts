import { App, TFile } from "obsidian";

const INSTRUCTION_FILE = "CLAUDE.md";

export class VaultInstructions {
	private app: App;
	private cache: Map<string, { content: string; mtime: number }> = new Map();

	constructor(app: App) {
		this.app = app;
	}

	/**
	 * Load and merge CLAUDE.md files from vault root through every parent
	 * folder of the active file. Global instructions come first, local last.
	 */
	async getInstructions(activeFilePath?: string): Promise<string> {
		const paths = this.getInstructionPaths(activeFilePath);
		const sections: string[] = [];

		for (const path of paths) {
			const content = await this.readCachedInstruction(path);
			if (content !== null) {
				sections.push(content);
			}
		}

		return sections.join("\n\n---\n\n");
	}

	/**
	 * Returns true if at least one CLAUDE.md exists in the vault.
	 */
	hasInstructions(): boolean {
		return this.app.vault.getAbstractFileByPath(INSTRUCTION_FILE) instanceof TFile;
	}

	/**
	 * Create a starter .claude.md at vault root.
	 * Returns false if the file already exists.
	 */
	async createStarterTemplate(): Promise<boolean> {
		if (this.app.vault.getAbstractFileByPath(INSTRUCTION_FILE)) {
			return false;
		}

		const template = `# Claude Instructions

These instructions are automatically loaded by the Claude Assistant plugin on every request.
Edit this file to customise how Claude behaves in your vault.

---

## About this vault
- Purpose: [describe what this vault is for]
- Main topics: [e.g. research, journaling, project management]
- Primary language: [e.g. English]

## Writing style
- Be concise and clear
- Use active voice
- Match the tone already present in the note
- Keep paragraphs short (3–4 sentences max)
- Prefer plain language over jargon

## Formatting rules
- Use Markdown headings (##, ###) to organise content
- Use [[wikilinks]] for internal references, never plain URLs
- Preserve existing YAML frontmatter — do not add or remove keys
- Do not change formatting or structure unless explicitly asked
- Bullet lists for enumerations; numbered lists only for steps

## Behaviour
- When rewriting or improving text, preserve the original meaning
- When summarising, include the key points and any action items
- When continuing text, match the existing style and voice
- If a task is ambiguous, ask a clarifying question before proceeding
- Do not add disclaimers, caveats, or filler phrases like "Certainly!" or "Great question!"

## Vault tools
- You may read and search notes when relevant context is needed
- Always show a summary of changes before creating or modifying files
- Prefer editing existing notes over creating new ones unless asked

## Vault structure
- Maintain an up-to-date mental map of the vault folder structure by observing it at the start of every session and whenever a new folder is created
- When a new folder is created, immediately update your understanding of the vault structure so subsequent decisions reflect the latest layout
- Before creating a new note, search the existing folder structure for a folder whose name or purpose matches the note's topic; if a matching folder is found, place the new note inside it
- Only create a new folder for a note if no existing folder is relevant to the note's topic
- When in doubt about folder placement, suggest the most relevant existing folder and ask for confirmation before creating a new one

## Off-limits
- Do not delete notes or folders unless explicitly instructed
- Do not share or reference content from one note in another without permission
`;

		await this.app.vault.create(INSTRUCTION_FILE, template);
		return true;
	}

	private getInstructionPaths(activeFilePath?: string): string[] {
		const paths: string[] = [INSTRUCTION_FILE]; // vault root always first

		if (activeFilePath) {
			const parts = activeFilePath.split("/");
			// Remove the filename, keep only folder segments
			parts.pop();
			let current = "";
			for (const part of parts) {
				current = current ? `${current}/${part}` : part;
				const instructionPath = `${current}/${INSTRUCTION_FILE}`;
				if (instructionPath !== INSTRUCTION_FILE) {
					paths.push(instructionPath);
				}
			}
		}

		return paths;
	}

	private async readCachedInstruction(path: string): Promise<string | null> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!file || !(file instanceof TFile)) {
			this.cache.delete(path);
			return null;
		}

		const cached = this.cache.get(path);
		if (cached && cached.mtime === file.stat.mtime) {
			return cached.content;
		}

		const content = await this.app.vault.read(file);
		this.cache.set(path, { content, mtime: file.stat.mtime });
		return content;
	}
}
