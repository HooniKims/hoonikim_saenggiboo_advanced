function normalizeTavilyUrl(rawUrl) {
    const fallback = "https://api.tavily.com";
    const trimmed = (rawUrl || fallback).trim().replace(/\/+$/, "");
    return trimmed.replace(/\/v1$/, "").replace(/\/search$/, "");
}

function compactText(value, maxLength = 1200) {
    return String(value || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxLength);
}

function buildQuery({ subjectName, commonActivities, individualActivity }) {
    const subject = compactText(subjectName, 80);
    const common = (Array.isArray(commonActivities) ? commonActivities : [])
        .map((item) => compactText(item, 80))
        .filter(Boolean)
        .slice(0, 3)
        .join(" ");
    const individual = compactText(individualActivity, 220);

    return [subject, common, individual, "핵심 내용 주제 쟁점 의미 배경"]
        .filter(Boolean)
        .join(" ");
}

function buildContext({ query, data }) {
    const answer = compactText(data?.answer, 1200);
    const results = Array.isArray(data?.results) ? data.results.slice(0, 5) : [];
    const sourceLines = results
        .map((result, index) => {
            const title = compactText(result.title, 120);
            const content = compactText(result.content, 500);
            const url = compactText(result.url, 220);
            return `${index + 1}. ${title}\n- 요약: ${content}\n- 출처: ${url}`;
        })
        .join("\n");

    return [
        "[웹 검색 보강 자료]",
        `검색어: ${query}`,
        answer ? `검색 요약: ${answer}` : "",
        sourceLines ? `검색 결과:\n${sourceLines}` : "",
        "",
        "[활용 규칙]",
        "- 위 자료는 입력 내용을 이해하기 위한 배경 맥락으로만 사용한다.",
        "- 학생이 직접 했다고 입력하지 않은 실험, 발표, 토론, 후속 활동, 관찰 사실은 새로 만들지 않는다.",
        "- 작품, 논문, 연구, 사회 쟁점, 생활 지도 관점의 핵심 개념만 입력 내용과 자연스럽게 연결한다.",
        "- 문학작품을 언급할 때는 반드시 작품명(작가명) 형식만 사용한다. 예: 소나기(황순원), 운수좋은 날(현진건).",
        "- 최종 생성 문장에는 URL, 출처명, 검색했다는 말, 참고자료 목록을 쓰지 않는다.",
    ].filter(Boolean).join("\n");
}

export async function POST(req) {
    try {
        const apiKey = process.env.TAVILY_API_KEY;
        if (!apiKey?.trim()) {
            return Response.json({ error: "TAVILY_API_KEY가 설정되어 있지 않습니다." }, { status: 400 });
        }

        const body = await req.json();
        const { subjectName = "", commonActivities = [], individualActivity = "" } = body;

        if (!String(individualActivity || "").trim()) {
            return Response.json({ context: "", sources: [], query: "" });
        }

        const query = buildQuery({ subjectName, commonActivities, individualActivity });
        const tavilyUrl = `${normalizeTavilyUrl(process.env.TAVILY_API_URL)}/search`;

        const response = await fetch(tavilyUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey.trim()}`,
            },
            body: JSON.stringify({
                query,
                search_depth: "basic",
                topic: "general",
                max_results: 5,
                include_answer: true,
                include_raw_content: false,
            }),
        });

        const rawText = await response.text();
        let data = {};
        try {
            data = rawText ? JSON.parse(rawText) : {};
        } catch {
            data = { error: rawText };
        }

        if (!response.ok) {
            const message = data?.error || data?.message || rawText || "Tavily 검색 요청에 실패했습니다.";
            return Response.json({ error: `Tavily API 오류 (${response.status}): ${message}` }, { status: response.status });
        }

        const sources = Array.isArray(data?.results)
            ? data.results.slice(0, 5).map((result) => ({
                title: result.title || "",
                url: result.url || "",
                content: compactText(result.content, 500),
            }))
            : [];

        return Response.json({
            query,
            context: buildContext({ query, data }),
            sources,
        });
    } catch (error) {
        return Response.json({ error: `검색 보강 서버 오류: ${error.message}` }, { status: 500 });
    }
}
