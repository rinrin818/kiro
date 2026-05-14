import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "../lib/system-prompt.js";

const client = new Anthropic();

export default async function handler(req, res) {
	if (req.method !== "POST") {
		res.status(405).json({ error: "POST only" });
		return;
	}

	try {
		const { input } = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
		if (!input || typeof input !== "string") {
			res.status(400).json({ error: "input 문자열이 필요합니다." });
			return;
		}

		const result = await client.messages.create({
			model: "claude-haiku-4-5",
			max_tokens: 2048,
			system: SYSTEM_PROMPT,
			messages: [
				{ role: "user", content: `<user_input>\n${input}\n</user_input>` },
			],
		});

		const textBlock = result.content.find((b) => b.type === "text");
		res.status(200).json({ text: textBlock?.text ?? "" });
	} catch (err) {
		console.error("classify 오류:", err);
		res.status(500).json({ error: err.message ?? "서버 오류" });
	}
}
