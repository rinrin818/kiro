import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "../lib/system-prompt.js";
import { extractDocumentContent } from "../lib/extract.js";

const client = new Anthropic();

export default async function handler(req, res) {
	if (req.method !== "POST") {
		res.status(405).json({ error: "POST only" });
		return;
	}

	try {
		const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
		let { input } = body;
		const { fileData, fileName } = body;

		// 파일(base64)이 함께 오면 메모리에서 추출해 input에 합침
		if (fileData && fileName) {
			const buffer = Buffer.from(fileData, "base64");
			const extracted = await extractDocumentContent(buffer, fileName);
			const memoLine = input && input.trim() ? `사용자 메모: ${input.trim()}\n` : "";
			if (extracted.status === "success") {
				input = `${memoLine}파일명: ${fileName}\n[문서 본문]\n${extracted.content}`;
			} else {
				// 추출 실패/미지원 — 파일명만으로 추론하도록 (거절 금지)
				input = `${memoLine}파일명: ${fileName}\n(본문 추출 불가: ${extracted.error})`;
			}
		}

		if (!input || typeof input !== "string") {
			res.status(400).json({ error: "input 문자열 또는 파일이 필요합니다." });
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
