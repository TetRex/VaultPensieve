# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Development build with watch mode
npm run build    # Production build (minified)
```

No test framework is configured. There is no lint script.

## Architecture

**Claudesidian** is an Obsidian plugin that integrates Claude AI into the note editor. The plugin is desktop-only (`manifest.json`) and bundles to a single `main.js` via esbuild from `src/main.ts`.

### Core Components

- **`src/main.ts`** — Plugin entry point (`ClaudeAssistantPlugin extends Plugin`). Registers the chat view, ribbon icon, editor commands, settings tab, and handles cost tracking + monthly spending limits.
- **`src/claude-client.ts`** — Wraps the Anthropic SDK. Handles streaming responses and the agentic tool-use loop (Claude calls vault tools → results fed back → loop continues until no more tool calls).
- **`src/chat-view.ts`** — The persistent right-sidebar chat UI (`CHAT_VIEW_TYPE = "claude-chat-view"`). Handles message rendering, streaming display, model switching, and note attachment.
- **`src/vault-tools.ts`** — Defines 6 vault tools (`list_files`, `read_note`, `create_note`, `update_note`, `search_notes`, `get_vault_structure`) and their executor against `app.vault`. File-modifying tools show Obsidian Notices on execution.
- **`src/vault-instructions.ts`** — Loads and caches `CLAUDE.md` files from the vault root through all parent folders of the active note. Merged hierarchically (global → local) and injected into the system prompt.
- **`src/preview-modal.ts`** — Modal for writing commands showing original vs. suggested text with Accept/Retry/Cancel.
- **`src/commands/`** — Three editor commands: `continue-writing`, `summarize-note`, `improve-rewrite`. Each builds a prompt from note/selection context, streams to Claude, and shows the result in `PreviewModal`.
- **`src/settings.ts`** — Settings UI for API key, model selection, custom system prompt, and monthly spending limit.

### Message Flow

1. User sends message → spending limit checked
2. System prompt assembled: base instructions + `CLAUDE.md` hierarchy + custom prompt
3. Streamed to Anthropic API with vault tools available
4. If Claude invokes vault tools → execute → feed results back → repeat (agentic loop)
5. Token usage recorded → dollars accumulated → monthly counter updated → usage bar refreshed

### Cost Tracking

Model pricing is hardcoded in `main.ts`. Usage resets on the first of each month. The monthly limit (if set) is enforced before sending each message. `data.json` (Obsidian's persisted settings) stores `usageMonth`, `usageDollars`, and the API key — it is gitignored.

### Build

- Entry: `src/main.ts` → Output: `main.js` (CommonJS, ES2018 target)
- External: `obsidian`, `electron`, CodeMirror packages, Node builtins
- Dev: inline sourcemaps; Production: minified, no sourcemaps
