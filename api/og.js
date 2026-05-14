import { fetchOG } from "../lib/og.js";

export default async function handler(req, res) {
	if (req.method !== "GET") {
		res.status(405).json({ error: "GET only" });
		return;
	}

	try {
		const target = req.query?.url;
		if (!target || !/^https?:\/\//i.test(target)) {
			res.status(400).json({ error: "유효한 url 파라미터가 필요합니다." });
			return;
		}
		const og = await fetchOG(target);
		res.status(200).json(og);
	} catch (err) {
		console.warn("OG 추출 실패:", err.message);
		res.status(200).json({ title: "", description: "", siteName: "" });
	}
}
