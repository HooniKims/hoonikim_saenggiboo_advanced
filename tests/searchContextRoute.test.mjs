import test from "node:test";
import assert from "node:assert/strict";

import { POST } from "../app/api/search-context/route.js";

test("search context guidance uses generic final-output wording", async () => {
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.TAVILY_API_KEY;
    process.env.TAVILY_API_KEY = "tvly-test";
    globalThis.fetch = async () => Response.json({
        answer: "방학 생활 지도는 학습 계획과 건강한 생활 리듬을 함께 살피는 것이 중요합니다.",
        results: [
            {
                title: "방학 생활 지도",
                content: "방학 중 학습 계획, 건강, 가족 대화, 친구 관계를 균형 있게 살핍니다.",
                url: "https://example.test/guide",
            },
        ],
    });

    try {
        const response = await POST(new Request("http://localhost/api/search-context", {
            method: "POST",
            body: JSON.stringify({
                subjectName: "가정통신문",
                commonActivities: ["여름방학 생활 지도"],
                individualActivity: "학업, 건강, 친구관계, 가족관계",
            }),
        }));
        const data = await response.json();

        assert.equal(response.ok, true);
        assert.match(data.context, /최종 생성 문장/);
        assert.doesNotMatch(data.context, /최종 세특 문장/);
    } finally {
        globalThis.fetch = originalFetch;
        process.env.TAVILY_API_KEY = originalKey;
    }
});
