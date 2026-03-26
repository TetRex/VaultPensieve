import type { MessageParam, ContentBlockParam, ToolResultBlockParam, TextBlockParam, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages";
import type { StreamCallbacks, ToolDefinition, ToolExecutor, AIClient } from "./claude-client";

interface OAIToolCall {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
}

interface OAIMessage {
	role: string;
	content: string | null;
	tool_calls?: OAIToolCall[];
	tool_call_id?: string;
}

function anthropicToOAI(messages: MessageParam[]): OAIMessage[] {
	const result: OAIMessage[] = [];

	for (const msg of messages) {
		if (typeof msg.content === "string") {
			result.push({ role: msg.role, content: msg.content });
			continue;
		}

		const blocks = msg.content as ContentBlockParam[];

		if (msg.role === "assistant") {
			let textContent = "";
			const toolCalls: OAIToolCall[] = [];

			for (const block of blocks) {
				if (block.type === "text") {
					textContent += (block as TextBlockParam).text;
				} else if (block.type === "tool_use") {
					const tu = block as ToolUseBlock;
					toolCalls.push({
						id: tu.id,
						type: "function",
						function: {
							name: tu.name,
							arguments: JSON.stringify(tu.input),
						},
					});
				}
			}

			result.push({
				role: "assistant",
				content: textContent || null,
				...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
			});
		} else if (msg.role === "user") {
			const toolResults = blocks.filter(b => b.type === "tool_result") as ToolResultBlockParam[];
			const textBlocks = blocks.filter(b => b.type === "text") as TextBlockParam[];

			if (textBlocks.length > 0) {
				result.push({ role: "user", content: textBlocks.map(b => b.text).join("\n") });
			}

			for (const tr of toolResults) {
				result.push({
					role: "tool",
					tool_call_id: tr.tool_use_id,
					content: typeof tr.content === "string" ? tr.content : JSON.stringify(tr.content ?? ""),
				});
			}
		}
	}

	return result;
}

export class OllamaClient implements AIClient {
	private baseUrl: string;
	private model: string;

	constructor(baseUrl: string, model: string) {
		this.baseUrl = baseUrl.replace(/\/$/, "");
		this.model = model;
	}

	async testConnection(): Promise<void> {
		let response: Response;
		try {
			response = await fetch(`${this.baseUrl}/api/tags`);
		} catch {
			throw new Error(`Cannot connect to Ollama at ${this.baseUrl}. Make sure Ollama is running.`);
		}
		if (!response.ok) {
			throw new Error(`Ollama returned ${response.status}. Make sure Ollama is running.`);
		}
	}

	async streamMessage(
		systemPrompt: string,
		messages: MessageParam[],
		callbacks: StreamCallbacks,
		tools?: ToolDefinition[],
		toolExecutor?: ToolExecutor
	): Promise<MessageParam[]> {
		const newMessages: MessageParam[] = [];
		let continueLoop = true;
		const allMessages = [...messages];

		while (continueLoop) {
			continueLoop = false;

			const oaiMessages: OAIMessage[] = [
				{ role: "system", content: systemPrompt },
				...anthropicToOAI(allMessages),
			];

			const requestBody: Record<string, unknown> = {
				model: this.model,
				messages: oaiMessages,
				stream: true,
			};

			if (tools && tools.length > 0) {
				requestBody.tools = tools.map(t => ({
					type: "function",
					function: {
						name: t.name,
						description: t.description,
						parameters: t.input_schema,
					},
				}));
			}

			let response: Response;
			try {
				response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(requestBody),
				});
			} catch {
				const error = new Error(`Cannot connect to Ollama at ${this.baseUrl}. Make sure Ollama is running.`);
				callbacks.onError?.(error);
				throw error;
			}

			if (!response.ok) {
				const error = new Error(`Ollama error: ${response.status} ${response.statusText}`);
				callbacks.onError?.(error);
				throw error;
			}

			const reader = response.body?.getReader();
			if (!reader) throw new Error("No response body from Ollama");

			const decoder = new TextDecoder();
			let fullText = "";
			const toolCallAccum = new Map<number, { id: string; name: string; arguments: string }>();

			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					const chunk = decoder.decode(value, { stream: true });
					for (const line of chunk.split("\n")) {
						if (!line.startsWith("data: ")) continue;
						const data = line.slice(6).trim();
						if (data === "[DONE]") continue;

						let parsed: Record<string, unknown>;
						try {
							parsed = JSON.parse(data);
						} catch {
							continue;
						}

						const choices = parsed.choices as Array<{ delta: Record<string, unknown> }> | undefined;
						const delta = choices?.[0]?.delta;
						if (!delta) continue;

						if (typeof delta.content === "string") {
							fullText += delta.content;
							callbacks.onChunk?.(delta.content);
						}

						const tcs = delta.tool_calls as Array<{
							index?: number;
							id?: string;
							function?: { name?: string; arguments?: string };
						}> | undefined;

						if (tcs) {
							for (const tc of tcs) {
								const idx = tc.index ?? 0;
								if (!toolCallAccum.has(idx)) {
									toolCallAccum.set(idx, { id: "", name: "", arguments: "" });
								}
								const acc = toolCallAccum.get(idx)!;
								if (tc.id) acc.id = tc.id;
								if (tc.function?.name) acc.name = tc.function.name;
								if (tc.function?.arguments) acc.arguments += tc.function.arguments;
							}
						}
					}
				}
			} finally {
				reader.releaseLock();
			}

			// Build assistant message
			const contentBlocks: ContentBlockParam[] = [];
			const toolCalls: ToolUseBlock[] = [];

			if (fullText) {
				contentBlocks.push({ type: "text", text: fullText });
			}

			for (const [, tc] of toolCallAccum) {
				let input: Record<string, unknown> = {};
				try { input = JSON.parse(tc.arguments); } catch { /* leave empty */ }

				const block: ToolUseBlock = {
					type: "tool_use",
					id: tc.id || `call_${Date.now()}_${Math.random().toString(36).slice(2)}`,
					name: tc.name,
					input,
				};
				toolCalls.push(block);
				contentBlocks.push(block);
			}

			if (contentBlocks.length > 0) {
				const assistantMsg: MessageParam = { role: "assistant", content: contentBlocks };
				allMessages.push(assistantMsg);
				newMessages.push(assistantMsg);
			}

			if (toolCalls.length > 0 && toolExecutor) {
				const toolResults: ToolResultBlockParam[] = [];
				for (const tc of toolCalls) {
					try {
						const result = await toolExecutor(tc.name, tc.input as Record<string, unknown>);
						toolResults.push({ type: "tool_result", tool_use_id: tc.id, content: result });
					} catch (e) {
						const errMsg = e instanceof Error ? e.message : "Tool execution failed";
						toolResults.push({ type: "tool_result", tool_use_id: tc.id, content: errMsg, is_error: true });
					}
				}
				const toolMsg: MessageParam = { role: "user", content: toolResults };
				allMessages.push(toolMsg);
				newMessages.push(toolMsg);
				continueLoop = true;
			}

			// Local models have no cost
			callbacks.onUsage?.(0, 0);

			if (!continueLoop && fullText) {
				callbacks.onComplete?.(fullText);
			}
		}

		return newMessages;
	}
}
