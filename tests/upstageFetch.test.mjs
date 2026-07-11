import test from "node:test";
import assert from "node:assert/strict";

import { fetchUpstageCompletion } from "../utils/upstageFetch.js";

test("fetchUpstageCompletion sends generation inputs to the server route", async () => {
    const originalFetch = globalThis.fetch;
    let requestUrl = "";
    let requestBody = null;

    globalThis.fetch = async (url, options) => {
        requestUrl = url;
        requestBody = JSON.parse(options.body);
        return Response.json({ result: "자료를 분석하고 결과를 발표함.", model: "solar-pro2" });
    };

    try {
        const result = await fetchUpstageCompletion({
            prompt: "과세특을 작성하세요.",
            additionalInstructions: "입력 사실만 사용",
            targetChars: 393,
            outputType: "record",
        });

        assert.equal(result, "자료를 분석하고 결과를 발표함.");
    } finally {
        globalThis.fetch = originalFetch;
    }

    assert.equal(requestUrl, "/api/upstage-generate");
    assert.deepEqual(requestBody, {
        prompt: "과세특을 작성하세요.",
        additionalInstructions: "입력 사실만 사용",
        targetChars: 393,
        outputType: "record",
    });
});
