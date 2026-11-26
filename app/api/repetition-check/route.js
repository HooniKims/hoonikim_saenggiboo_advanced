import {
    REPETITION_JUDGE_MIN_SENTENCES,
    REPETITION_JUDGE_MODEL,
    buildRepetitionJudgeMessages,
    describeRepetitionPairs,
    parseRepetitionPairs,
    splitJudgeSentences,
} from "../../../utils/repetitionJudge.js";

const DEFAULT_UPSTAGE_API_URL = "https://api.upstage.ai/v1/chat/completions";
const JUDGE_TIMEOUT_MS = 8000;

// 같은 내용을 다른 말로 되풀이한 문장을 Solar Mini로 짚는다.
// 판정에 실패해도 생성 흐름을 막지 않도록 항상 200과 빈 결과를 돌려준다.
export async function POST(req) {
    try {
        const body = await req.json();
        const sentences = splitJudgeSentences(body?.text);
        const apiKey = process.env.UPSTAGE_API_KEY?.trim() || "";
        if (!apiKey || sentences.length < REPETITION_JUDGE_MIN_SENTENCES) {
            return Response.json({ pairs: [], detail: "" });
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), JUDGE_TIMEOUT_MS);
        let response;
        try {
            response = await fetch(process.env.UPSTAGE_API_URL?.trim() || DEFAULT_UPSTAGE_API_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
                body: JSON.stringify({
                    model: REPETITION_JUDGE_MODEL,
                    messages: buildRepetitionJudgeMessages(sentences),
                    temperature: 0,
                    max_tokens: 512,
                    reasoning_effort: "none",
                    stream: false,
                }),
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timeout);
        }
        if (!response.ok) {
            return Response.json({ pairs: [], detail: "", skipped: `upstage ${response.status}` });
        }
        const data = await response.json();
        const pairs = parseRepetitionPairs(data?.choices?.[0]?.message?.content, sentences.length);
        return Response.json({ pairs, detail: describeRepetitionPairs(pairs, sentences) });
    } catch (error) {
        return Response.json({ pairs: [], detail: "", skipped: error?.message || "error" });
    }
}
