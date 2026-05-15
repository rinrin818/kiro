// 문서 본문 추출 — 메모리 buffer를 받아 텍스트/메타데이터 반환
// Vercel serverless 호환 (디스크 저장 없음)
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { extractText, getDocumentProxy } from "unpdf";

const MAX_CHARS = 20000;

export async function extractDocumentContent(buffer, fileName = "") {
	const ext = (fileName.split(".").pop() || "").toLowerCase();
	const metadata = { fileName, ext, size: buffer.length };
	let content = "";

	try {
		if (ext === "pdf") {
			const pdf = await getDocumentProxy(new Uint8Array(buffer));
			const result = await extractText(pdf, { mergePages: true });
			content = (result.text || "").trim();
			metadata.pages = result.totalPages;
		} else if (ext === "docx") {
			const result = await mammoth.extractRawText({ buffer });
			content = (result.value || "").trim();
		} else if (ext === "xlsx" || ext === "xls") {
			const wb = XLSX.read(buffer, { type: "buffer" });
			const parts = [];
			for (const name of wb.SheetNames) {
				parts.push(`=== 시트: ${name} ===\n${XLSX.utils.sheet_to_csv(wb.Sheets[name])}`);
			}
			content = parts.join("\n\n").trim();
			metadata.sheetNames = wb.SheetNames;
		} else {
			return {
				status: "unsupported",
				error: `${ext || "확장자 없음"} 포맷은 본문 추출 미지원 (PDF/DOCX/XLSX만 가능)`,
				metadata,
			};
		}

		if (content.length > MAX_CHARS) {
			content = content.slice(0, MAX_CHARS) + "\n\n... (이하 본문 생략 — 길이 초과)";
			metadata.truncated = true;
		}

		return { status: "success", content, metadata };
	} catch (err) {
		return { status: "error", error: err.message ?? String(err), metadata };
	}
}
