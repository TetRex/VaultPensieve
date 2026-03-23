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
	 * Create a starter CLAUDE.md at vault root.
	 */
	async createStarterTemplate(): Promise<void> {
		const template = `# Claude Instructions

## Writing style
- Write in a clear, concise style
- Use active voice
- Keep paragraphs short

## Context
- This vault is about: [describe your vault's purpose]

## Rules
- Do not change existing formatting unless asked
- Preserve frontmatter in notes
- Use wikilinks for internal references
`;
		await this.app.vault.create(INSTRUCTION_FILE, template);
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
