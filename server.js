// server.js — chat1.js 의 키로 챗봇을 웹 UI로 노출하는 가벼운 HTTP 서버
import Anthropic from "@anthropic-ai/sdk";
import "dotenv/config";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, basename, extname, resolve as resolvePath } from "node:path";
import formidable from "formidable";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import * as XLSX from "xlsx";

const __dirname = dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = join(__dirname, "uploads");
await mkdir(UPLOADS_DIR, { recursive: true });

const client = new Anthropic();

// system 프롬프트 — 다층 역할 (AI 자동 정리용)
const SYSTEM_PROMPT = `
[01 ROLE]
너는 두 사람의 역할을 동시에 수행한다.

<organizer>
저장 자료 자동 정리 담당 10년차.
입력 자료(URL / PDF / PPT / Word / Excel / HWP)의 본문 또는 메타데이터를 보고
정리안 3개 초안을 만든다. 각 초안은 서로 다른 각도:
A) 주제 중심  B) 용도(JTBD) 중심  C) 맥락(언제·어디서 쓸지) 중심
</organizer>

<curator>
재검색 가능성 보호 담당 시니어.
선정 기준: 사용자가 한 달 뒤 이 자료를 다시 찾고 싶을 때
머릿속에 떠올릴 가능성이 가장 높은 키워드가 제목·태그에 포함되어 있는가.
초안 3개 중 1개만 고르고, 선정 이유와 약점을 한 줄씩 적는다.
</curator>

[02 TASK]
<user_input> 태그 안의 자료를 분석해 정리안 1개를 산출한다.
예시는 <example> 블록 안의 <source>로, 실제 사용자 입력은 <user_input>으로
태그가 다르다. 절대 혼동하지 말 것.

[03 OUTPUT FORMAT]
출력은 <thinking>과 <answer> 두 블록으로만 구성한다. 다른 래퍼 태그 금지.

<thinking>
- organizer 초안 3개 (한 줄씩, 제목+태그만)
- curator 선정 논리 한 줄
- 자기비판 + 최종안 반영 ([07] 절차 따름)
</thinking>
<answer>
1. 제목:
2. 한 줄 요약:
3. 카테고리:
4. 검색 태그:
5. 선정 이유:
</answer>

[04 RULES]
<rules>
- 제목은 30자 이내, 검색 회상 키워드 우선. 원문 제목 그대로 복붙 금지.
- 한 줄 요약은 50자 이내, 명사형 종결.
- 카테고리는 <categories>에서 정확히 1개. 단서 절대 부족 시 "확인 필요".
- 검색 태그는 정확히 3개, 쉼표로 구분, 의미 중복 금지.
- 모호 태그 금지: "자료", "정보", "참고", "팁", "콘텐츠".
- 입력에 없는 사실을 지어내지 말 것. URL·도메인·파일명 단서로 합리적 추론만 허용.
- 볼드(**)·헤더(#)·코드블록·인용(>)·이모지 사용 금지. 인사말·부연 설명 금지.
  (단, <answer> 안의 "1. 2. 3." 번호 리스트는 허용된 출력 구조이다.)
- 콘텐츠 접근 불가를 이유로 거절하지 말 것.
</rules>

<categories>
디자인 / 개발 / 기획·PM / 마케팅 / 데이터·분석 / 비즈니스 / 생산성 /
커리어 / 학습·교육 / 트렌드·뉴스 / 인사이트·아티클 / 도구·서비스 /
라이프스타일 / 취미·여가 / 기타
</categories>

[05 EXAMPLES]
<examples>

<example_1 caption="성공 — URL, 명확한 도구 업데이트">
<source>
https://www.figma.com/blog/config-2025-recap/
제목: Config 2025 Recap — What's new in Figma
</source>
<thinking>
- A(주제): "Figma Config 2025 발표 요약" / figma, config, 컨퍼런스
- B(용도): "최신 Figma 기능 업데이트 체크" / figma, 신기능, 업데이트
- C(맥락): "디자인 트렌드 참고 컨퍼런스" / 디자인트렌드, figma, 2025
- 선정: B. "피그마 뭐 새로 나왔지" 회상 확률 최고.
- 자기비판: ①AI 발표 태그 누락 ②"업데이트"가 다소 일반적 ③연도 미포함 → "업데이트"를 "config2025"로 교체.
</thinking>
<answer>
1. 제목: 최신 Figma 기능 업데이트 체크
2. 한 줄 요약: Config 2025에서 공개된 Figma 신기능 정리
3. 카테고리: 도구·서비스
4. 검색 태그: figma, 신기능, config2025
5. 선정 이유: "피그마 뭐 새로 나왔지" 회상 키워드 적중
</answer>
</example_1>

<example_2 caption="애매 — 카테고리 경계가 모호한 케이스">
<source>
파일명: 노션_세컨드브레인_템플릿_v3.pdf
첫 페이지: PARA 분류법 기반 개인 지식관리 시스템, 자기개발 워크북 포함
</source>
<thinking>
- A(주제): "노션 세컨드브레인 템플릿" / 노션, PKM, 템플릿
- B(용도): "지식관리 시스템 구축" / 세컨드브레인, PARA, 노션
- C(맥락): "자기개발 루틴 참고" / 자기개발, 지식관리, 노션템플릿
- 카테고리 후보: 생산성 vs 학습·교육 vs 도구·서비스 — 셋 다 걸침.
- 선정: B. PKM 도구 활용 회상이 강함 → 생산성으로 분류.
- 자기비판: ①자기개발 측면 누락 ②"PARA" 영문만 있어 한글검색 누락 ③제목에 "PKM" 키워드 부재 → 태그는 유지, 제목에 "지식관리" 보강.
</thinking>
<answer>
1. 제목: 노션 세컨드브레인 지식관리 템플릿
2. 한 줄 요약: PARA 분류법 기반 노션 지식관리 시스템
3. 카테고리: 생산성
4. 검색 태그: 세컨드브레인, PARA, 노션템플릿
5. 선정 이유: PKM 도구 회상 키워드 정확
</answer>
</example_2>

<example_3 caption="엣지 — 본문 없음, '확인 필요' 출력">
<source>
https://news.hada.io/topic?id=15234
(본문 미제공, URL·도메인만 있음)
</source>
<thinking>
- hada.io = GeekNews, 개발/IT 큐레이션으로 추론.
- 본문 없음 → 구체 주제 단정 불가. 회상 키워드 확보 어려움.
- A(주제): "GeekNews 스크랩"
- B(용도): "개발 트렌드 북마크" ← 선정
- C(맥락): "IT 뉴스 참고"
- 본문 단서 부재 → 태그 1개는 "확인필요"로 명시.
- 자기비판: ①구체 주제 0개 ②"개발트렌드" 너무 광범위 ③나중에 다시 찾을 단서 부족 → 그대로 둠. 본문 없이 더 좁히면 환각 위험.
</thinking>
<answer>
1. 제목: GeekNews 개발 트렌드 스크랩
2. 한 줄 요약: 본문 미확인 — 추후 직접 열어 보강 필요
3. 카테고리: 트렌드·뉴스
4. 검색 태그: geeknews, 개발트렌드, 확인필요
5. 선정 이유: 도메인 기반 최소 회상 키워드 확보
</answer>
</example_3>

</examples>

[06 FORMAT CHECK]
<answer>를 출력하기 직전 형식만 1회 점검한다:
1) 제목 30자 / 요약 50자 / 태그 정확히 3개인가?
2) 태그에 모호어("자료/정보/참고/팁/콘텐츠")가 없는가?
3) 카테고리가 <categories> 목록에 있는 값인가?
4) <thinking>과 <answer> 둘 다 있고, 그 외 래퍼 태그가 없는가?
어긋난 항목 있으면 1회 수정 후 출력.

[07 SELF-CRITIQUE]
curator 선정이 끝난 뒤, <answer> 작성 전에 머릿속에서 한 번 더 깐다.

1. curator가 고른 안을 그대로 떠올린다.
2. 아래 3기준으로 약점 3가지를 점검한다:
   - 한 달 뒤 사용자가 떠올릴 검색어가 제목·태그에 빠졌는가?
   - 태그가 너무 일반적이라 회상에 안 걸리지는 않는가?
   - 카테고리가 자료의 실제 사용 맥락과 어긋나지는 않는가?
3. 약점을 반영해 최종안으로 다듬는다.
   단, 본문 단서가 없는데 무리해 좁히지는 말 것 (환각 방지).

<thinking>에는 "자기비판: ①…②…③… → 반영 결과 한 줄" 형태로만 적는다.
<answer>는 다듬어진 최종안만 옮긴다. 약점은 사용자에게 노출하지 않는다.

[08 USER INPUT]
사용자 입력은 별도의 user 메시지로 <user_input>...</user_input> 태그에 감싸 전달된다.

[09 TOOL USE]
사용자 메시지에 "[파일: <경로>]" 형태로 파일 경로가 포함되어 있으면,
6필드 정리 전에 반드시 extract_document_content 도구를 먼저 호출해 본문을 받아온다.
도구 호출 결과(tool_result)로 받은 content/metadata는 <user_input>과 동일하게 취급한다.
status가 "error" 또는 "unsupported"여도 거절하지 말고 파일명·메타데이터만으로 합리적 추론하여 정리안을 만든다.
`;

const TOOLS = [
	{
		name: "extract_document_content",
		description:
			"업로드된 문서(PDF/DOCX/XLSX)에서 본문과 메타데이터를 추출. 사용자가 파일을 정리/요약/태깅 요청할 때 6필드 정리 전에 반드시 먼저 호출. 본문이 비어도 거절 금지.",
		input_schema: {
			type: "object",
			properties: {
				file_path: {
					type: "string",
					description: "업로드된 파일의 절대 경로. 사용자 메시지의 '[파일: ...]' 안에 적힌 값을 그대로 사용한다.",
				},
			},
			required: ["file_path"],
		},
	},
];

async function extractDocumentContent(filePath) {
	try {
		const abs = resolvePath(filePath);
		if (!abs.startsWith(UPLOADS_DIR)) {
			return { status: "error", error: "허용되지 않은 경로 (uploads 디렉터리 외부)" };
		}

		const ext = extname(abs).toLowerCase();
		const fileName = basename(abs);
		const buf = await readFile(abs);
		const metadata = { fileName, ext, size: buf.length };
		let content = "";

		if (ext === ".pdf") {
			const parser = new PDFParse({ data: new Uint8Array(buf) });
			try {
				const textResult = await parser.getText();
				content = textResult.text ?? "";
				metadata.pages = textResult.total;
				try {
					const infoResult = await parser.getInfo();
					const info = infoResult?.info ?? infoResult;
					if (info?.Title) metadata.title = info.Title;
					if (info?.Author) metadata.author = info.Author;
				} catch {}
			} finally {
				await parser.destroy();
			}
		} else if (ext === ".docx") {
			const result = await mammoth.extractRawText({ buffer: buf });
			content = result.value ?? "";
		} else if (ext === ".xlsx" || ext === ".xls") {
			const wb = XLSX.read(buf, { type: "buffer" });
			const parts = [];
			for (const name of wb.SheetNames) {
				parts.push(`=== 시트: ${name} ===\n${XLSX.utils.sheet_to_csv(wb.Sheets[name])}`);
			}
			content = parts.join("\n\n");
			metadata.sheetNames = wb.SheetNames;
		} else {
			return {
				status: "unsupported",
				error: `${ext || "확장자 없음"} 포맷은 현재 추출 미지원 (PDF/DOCX/XLSX만 지원)`,
				metadata,
			};
		}

		const MAX_CHARS = 20000;
		if (content.length > MAX_CHARS) {
			content = content.slice(0, MAX_CHARS) + "\n\n... (이하 본문 생략 — 길이 초과)";
			metadata.truncated = true;
		}

		return { status: "success", content, metadata };
	} catch (err) {
		return { status: "error", error: err.message ?? String(err) };
	}
}

const PORT = process.env.PORT || 3000;

function readJsonBody(req) {
	return new Promise((resolve, reject) => {
		let data = "";
		req.on("data", (chunk) => {
			data += chunk;
			if (data.length > 1e6) {
				req.destroy();
				reject(new Error("payload too large"));
			}
		});
		req.on("end", () => {
			try {
				resolve(data ? JSON.parse(data) : {});
			} catch (e) {
				reject(e);
			}
		});
		req.on("error", reject);
	});
}

const STATIC_FILES = {
	"/": { file: "index.html", type: "text/html; charset=utf-8" },
	"/index.html": { file: "index.html", type: "text/html; charset=utf-8" },
	"/chat.html": { file: "chat.html", type: "text/html; charset=utf-8" },
	"/chat.js": { file: "chat.js", type: "application/javascript; charset=utf-8" },
	"/chat1.js": { file: "chat1.js", type: "application/javascript; charset=utf-8" },
};

function decodeEntities(s) {
	return s
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, " ");
}

function extractMeta(html, key) {
	const patterns = [
		new RegExp(`<meta[^>]*property=["']${key}["'][^>]*content=["']([^"']+)["']`, "i"),
		new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*property=["']${key}["']`, "i"),
		new RegExp(`<meta[^>]*name=["']${key}["'][^>]*content=["']([^"']+)["']`, "i"),
		new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*name=["']${key}["']`, "i"),
	];
	for (const p of patterns) {
		const m = html.match(p);
		if (m) return decodeEntities(m[1].trim());
	}
	return "";
}

const server = createServer(async (req, res) => {
	if (req.method === "GET" && STATIC_FILES[req.url]) {
		const { file, type } = STATIC_FILES[req.url];
		try {
			const body = await readFile(join(__dirname, file));
			res.writeHead(200, {
				"Content-Type": type,
				"Cache-Control": "no-store, must-revalidate",
			});
			res.end(body);
		} catch {
			res.writeHead(500).end(`${file} 을(를) 읽을 수 없습니다.`);
		}
		return;
	}

	if (req.method === "GET" && req.url.startsWith("/api/og")) {
		try {
			const target = new URL(req.url, `http://${req.headers.host}`).searchParams.get("url");
			if (!target || !/^https?:\/\//i.test(target)) {
				res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
				res.end(JSON.stringify({ error: "유효한 url 파라미터가 필요합니다." }));
				return;
			}
			const ctrl = new AbortController();
			const timer = setTimeout(() => ctrl.abort(), 8000);
			let html = "";
			try {
				const r = await fetch(target, {
					headers: {
						"User-Agent":
							"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
						Accept: "text/html,application/xhtml+xml,*/*",
						"Accept-Language": "ko,en;q=0.8",
					},
					redirect: "follow",
					signal: ctrl.signal,
				});
				if (r.ok) html = await r.text();
			} finally {
				clearTimeout(timer);
			}

			const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i);
			const og = {
				title:
					extractMeta(html, "og:title") ||
					extractMeta(html, "twitter:title") ||
					(titleTag ? decodeEntities(titleTag[1].trim()) : ""),
				description:
					extractMeta(html, "og:description") ||
					extractMeta(html, "twitter:description") ||
					extractMeta(html, "description"),
				siteName: extractMeta(html, "og:site_name"),
			};
			res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
			res.end(JSON.stringify(og));
		} catch (err) {
			console.warn("OG 추출 실패:", err.message);
			res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
			res.end(JSON.stringify({ title: "", description: "", siteName: "" }));
		}
		return;
	}

	if (req.method === "POST" && req.url === "/api/classify") {
		try {
			const { input } = await readJsonBody(req);
			if (!input || typeof input !== "string") {
				res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
				res.end(JSON.stringify({ error: "input 문자열이 필요합니다." }));
				return;
			}

			// 파일 마커가 있을 때만 도구를 노출 — URL/텍스트만 있을 때는
			// 도구를 보면 AI가 "본문을 가져와야 한다"고 오인하고 거절할 수 있음
			const hasFile = /\[파일:\s*[^\]]+\]/.test(input);
			const apiBase = {
				model: "claude-haiku-4-5",
				max_tokens: 2048,
				system: SYSTEM_PROMPT,
			};
			if (hasFile) apiBase.tools = TOOLS;

			const working = [
				{ role: "user", content: `<user_input>\n${input}\n</user_input>` },
			];
			let result = await client.messages.create({ ...apiBase, messages: working });

			const MAX_HOPS = 4;
			for (let hop = 0; hop < MAX_HOPS && result.stop_reason === "tool_use"; hop++) {
				const toolUses = result.content.filter((b) => b.type === "tool_use");
				working.push({ role: "assistant", content: result.content });

				const toolResults = [];
				for (const tu of toolUses) {
					let payload;
					if (tu.name === "extract_document_content") {
						payload = await extractDocumentContent(tu.input?.file_path ?? "");
					} else {
						payload = { status: "error", error: `Unknown tool: ${tu.name}` };
					}
					toolResults.push({
						type: "tool_result",
						tool_use_id: tu.id,
						content: JSON.stringify(payload),
					});
				}
				working.push({ role: "user", content: toolResults });

				result = await client.messages.create({ ...apiBase, messages: working });
			}

			const textBlock = result.content.find((b) => b.type === "text");
			res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
			res.end(JSON.stringify({ text: textBlock?.text ?? "" }));
		} catch (err) {
			console.error("classify 오류:", err);
			res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
			res.end(JSON.stringify({ error: err.message ?? "서버 오류" }));
		}
		return;
	}

	if (req.method === "POST" && req.url === "/api/upload") {
		try {
			const form = formidable({
				uploadDir: UPLOADS_DIR,
				keepExtensions: true,
				maxFileSize: 20 * 1024 * 1024,
			});
			const [, files] = await form.parse(req);
			const raw = files.file;
			const file = Array.isArray(raw) ? raw[0] : raw;
			if (!file) {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "file 필드가 필요합니다." }));
				return;
			}
			res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
			res.end(
				JSON.stringify({
					file_path: file.filepath,
					original_name: file.originalFilename,
					size: file.size,
				}),
			);
		} catch (err) {
			console.error("upload 오류:", err);
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: err.message ?? "업로드 오류" }));
		}
		return;
	}

	if (req.method === "POST" && req.url === "/api/chat") {
		try {
			const { messages } = await readJsonBody(req);
			if (!Array.isArray(messages) || messages.length === 0) {
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "messages 배열이 필요합니다." }));
				return;
			}

			const hasFile = messages.some((m) => {
				const c = m.content;
				if (typeof c === "string") return /\[파일:\s*[^\]]+\]/.test(c);
				if (Array.isArray(c)) return c.some((b) => b?.type === "text" && /\[파일:\s*[^\]]+\]/.test(b.text || ""));
				return false;
			});
			const apiBase = {
				model: "claude-haiku-4-5",
				max_tokens: 2048,
				system: SYSTEM_PROMPT,
			};
			if (hasFile) apiBase.tools = TOOLS;

			const working = [...messages];
			let result = await client.messages.create({ ...apiBase, messages: working });

			const MAX_HOPS = 4;
			for (let hop = 0; hop < MAX_HOPS && result.stop_reason === "tool_use"; hop++) {
				const toolUses = result.content.filter((b) => b.type === "tool_use");
				working.push({ role: "assistant", content: result.content });

				const toolResults = [];
				for (const tu of toolUses) {
					let payload;
					if (tu.name === "extract_document_content") {
						payload = await extractDocumentContent(tu.input?.file_path ?? "");
					} else {
						payload = { status: "error", error: `Unknown tool: ${tu.name}` };
					}
					toolResults.push({
						type: "tool_result",
						tool_use_id: tu.id,
						content: JSON.stringify(payload),
					});
				}
				working.push({ role: "user", content: toolResults });

				result = await client.messages.create({ ...apiBase, messages: working });
			}

			const textBlock = result.content.find((b) => b.type === "text");
			res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
			res.end(JSON.stringify({ reply: textBlock?.text ?? "" }));
		} catch (err) {
			console.error(err);
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: err.message ?? "서버 오류" }));
		}
		return;
	}

	res.writeHead(404).end("Not Found");
});

server.listen(PORT, () => {
	console.log(`키로 챗봇 UI: http://localhost:${PORT}`);
});
