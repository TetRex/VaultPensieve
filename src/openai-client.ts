import { OpenAICompatibleClient } from "./openai-compatible";

export class OpenAIClient extends OpenAICompatibleClient {
	constructor(apiKey: string, model: string) {
		super({
			baseUrl: "https://api.openai.com/v1",
			model,
			apiKey,
			providerName: "OpenAI",
			requestBody: {
				stream_options: { include_usage: true },
			},
		});
	}
}
