// OG 메타 추출 헬퍼
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

export async function fetchOG(target) {
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
	return {
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
}
