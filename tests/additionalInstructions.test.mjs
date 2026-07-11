import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_OPENAI_MODEL, fetchOpenAICompletion, normalizeOpenAIModel, OPENAI_MODELS } from "../utils/openAIFetch.js";
import { AVAILABLE_MODELS, fetchStream, getLocalModelConfig, getMaxTokensForLocalModel, getModelOptionLabel, isUpstageModel } from "../utils/streamFetch.js";
import { POST } from "../app/api/openai-generate/route.js";

test("fetchStream sandwiches additional instructions into system and user messages", async () => {
    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url, options) => {
        const body = JSON.parse(options.body);
        calls.push(body);
        return Response.json({
            choices: [
                {
                    message: { content: "자료 조사 과정에서 핵심 정보를 정리하고 발표함." },
                    finish_reason: "stop",
                },
            ],
        });
    };

    try {
        await fetchStream({
            prompt: "활동 내용을 작성하세요.",
            additionalInstructions: "개인별 수행 내용을 기준으로 작성",
            model: "gemma4:e4b",
            targetChars: 100,
        });
    } finally {
        globalThis.fetch = originalFetch;
    }

    assert.equal(calls.length, 1);
    assert.match(calls[0].messages[0].content, /사용자 추가 규칙 \(최우선 준수\):\n개인별 수행 내용을 기준으로 작성/);
    assert.match(calls[0].messages[1].content, /^\[최우선 규칙\].*개인별 수행 내용을 기준으로 작성/s);
    assert.match(calls[0].messages[1].content, /\[다시 한번 강조\].*개인별 수행 내용을 기준으로 작성$/s);
});

test("fetchStream retry prompt keeps the character limit explicit", async () => {
    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url, options) => {
        const body = JSON.parse(options.body);
        calls.push(body);
        return Response.json({
            choices: [
                {
                    message: {
                        content: calls.length === 1
                            ? "자료 조사 과정에서 핵심 정보를 정리하고 발표"
                            : "자료 조사 과정에서 핵심 정보를 정리하고 발표함.",
                    },
                    finish_reason: calls.length === 1 ? "length" : "stop",
                },
            ],
        });
    };

    try {
        await fetchStream({
            prompt: "활동 내용을 작성하세요.",
            model: "gemma4:e4b",
            targetChars: 100,
        });
    } finally {
        globalThis.fetch = originalFetch;
    }

    assert.equal(calls.length, 2);
    assert.match(calls[1].messages[1].content, /100자 이하/);
    assert.match(calls[1].messages[1].content, /핵심 내용만/);
});

test("fetchStream retry prompt preserves the original writing conditions", async () => {
    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url, options) => {
        const body = JSON.parse(options.body);
        calls.push(body);
        return Response.json({
            choices: [
                {
                    message: {
                        content: calls.length === 1
                            ? "자료 조사 활동은 A 기준으로 심화하고 토론 활동은 C 기준으로 기본 참여를 서술"
                            : "자료 조사 활동은 A 기준으로 심화하고 토론 활동은 C 기준으로 기본 참여를 서술함.",
                    },
                    finish_reason: calls.length === 1 ? "length" : "stop",
                },
            ],
        });
    };

    try {
        await fetchStream({
            prompt: "[활동별 A/B/C 반영 기준]\n- 활동1: A(매우 잘함)\n- 활동2: C(보통)",
            model: "gemma4:e4b",
            targetChars: 120,
        });
    } finally {
        globalThis.fetch = originalFetch;
    }

    assert.equal(calls.length, 2);
    assert.match(calls[1].messages[1].content, /\[원래 작성 조건\]/);
    assert.match(calls[1].messages[1].content, /활동1: A\(매우 잘함\)/);
    assert.match(calls[1].messages[1].content, /활동2: C\(보통\)/);
});

test("fetchStream does not retry complete noun-ending sentences", async () => {
    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url, options) => {
        const body = JSON.parse(options.body);
        calls.push(body);
        return Response.json({
            choices: [
                {
                    message: { content: "드리블 상황에서 움직임을 예술적인 차원으로 끌어올리는 탐구 정신을 지님." },
                    finish_reason: "stop",
                },
            ],
        });
    };

    try {
        await fetchStream({
            prompt: "활동 내용을 작성하세요.",
            model: "gemma4:e4b",
            targetChars: 330,
        });
    } finally {
        globalThis.fetch = originalFetch;
    }

    assert.equal(calls.length, 1);
});

test("fetchStream does not retry complete polite letter sentences", async () => {
    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url, options) => {
        const body = JSON.parse(options.body);
        calls.push(body);
        return Response.json({
            choices: [
                {
                    message: { content: "성실한 태도로 생활하며 스스로 성장하는 알찬 여름방학이 되기를 진심으로 응원하겠습니다." },
                    finish_reason: "stop",
                },
            ],
        });
    };

    try {
        await fetchStream({
            prompt: "가정통신문을 작성하세요.",
            model: "gemma4:e4b",
            targetChars: 490,
            outputType: "letter",
        });
    } finally {
        globalThis.fetch = originalFetch;
    }

    assert.equal(calls.length, 1);
});

test("fetchStream retry prompt uses polite endings for letter output", async () => {
    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url, options) => {
        const body = JSON.parse(options.body);
        calls.push(body);
        return Response.json({
            choices: [
                {
                    message: {
                        content: calls.length === 1
                            ? "방학 동안 규칙적인 생활 습관을 유지하며 건강하게 성장할 수 있도록 가정에서도 꾸준히 격려"
                            : "방학 동안 규칙적인 생활 습관을 유지하며 건강하게 성장할 수 있도록 가정에서도 꾸준히 격려해 주시기 바랍니다.",
                    },
                    finish_reason: calls.length === 1 ? "length" : "stop",
                },
            ],
        });
    };

    try {
        await fetchStream({
            prompt: "가정통신문을 작성하세요.",
            model: "gemma4:e4b",
            targetChars: 490,
            outputType: "letter",
        });
    } finally {
        globalThis.fetch = originalFetch;
    }

    assert.equal(calls.length, 2);
    assert.match(calls[1].messages[1].content, /과거 경어체/);
    assert.doesNotMatch(calls[1].messages[1].content, /'~함\.', '~음\.', '~임\.'/);
});

test("local model list only exposes LM Studio-backed Gemma models", async () => {
    const localModels = AVAILABLE_MODELS.filter((model) => model.provider === "local");
    assert.deepEqual(localModels.map((model) => model.id), [
        "gemma4:e4b",
        "gemma4:e2b",
        "lmstudio:gemma-4-12b-it",
        "lmstudio:gemma-4-26b-a4b-it-q4ks",
    ]);
    assert.deepEqual(localModels.map(getModelOptionLabel), [
        "Gemma 4 E4B - 빠름, 품질 보통",
        "Gemma 4 E2B - 가장 빠름, 간단 작업용",
        "Gemma 4 12B - 기본 모델, 속도와 품질 균형",
        "Gemma 4 26B Q4 - 가장 느림, 품질 높음",
    ]);

    const requests = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
        requests.push({
            url,
            headers: options.headers,
            body: JSON.parse(options.body),
        });
        return Response.json({
            choices: [
                {
                    message: { content: "발표 활동에서 근거 자료를 정리하고 의견을 논리적으로 제시함." },
                    finish_reason: "stop",
                },
            ],
        });
    };

    try {
        for (const model of localModels) {
            await fetchStream({
                prompt: "활동 내용을 작성하세요.",
                model: model.id,
                targetChars: 100,
            });
        }
    } finally {
        globalThis.fetch = originalFetch;
    }

    assert.equal(requests.length, 4);
    assert.deepEqual(requests.map((request) => request.url), [
        "https://lm.alluser.site/v1/chat/completions",
        "https://lm.alluser.site/v1/chat/completions",
        "https://lm.alluser.site/v1/chat/completions",
        "https://lm.alluser.site/v1/chat/completions",
    ]);
    assert.deepEqual(requests.map((request) => request.body.model), [
        "google/gemma-4-e4b",
        "google/gemma-4-e2b",
        "gemma-4-12b-it",
        "gemma-4-26b-a4b-it",
    ]);
    assert.equal(requests.every((request) => request.headers["X-API-Key"] === "gudgns0411skaluv2018tjdbs130429"), true);
    assert.equal(requests.every((request) => request.body.reasoning_effort === "none"), true);
});

test("larger LM Studio local models get expanded max token budget", () => {
    assert.equal(getMaxTokensForLocalModel("gemma4:e2b", 589), 2003);
    assert.equal(getMaxTokensForLocalModel("gemma4:e4b", 589), 3072);
    assert.equal(getMaxTokensForLocalModel("lmstudio:gemma-4-12b-it", 589), 4096);
    assert.equal(getMaxTokensForLocalModel("lmstudio:gemma-4-26b-a4b-it-q4ks", 589), 4096);
});

test("AI model list exposes Upstage Solar Pro 2 as a server-backed option", () => {
    const solar = AVAILABLE_MODELS.find((model) => model.id === "upstage:solar-pro2");

    assert.deepEqual(solar, {
        id: "upstage:solar-pro2",
        name: "Upstage Solar Pro 2",
        description: "다중 활동과 성취 수준 반영에 강함",
        isLightweight: false,
        provider: "upstage",
    });
    assert.equal(isUpstageModel(solar.id), true);
    assert.equal(isUpstageModel("lmstudio:gemma-4-12b-it"), false);
});

test("unknown local model fallback also uses lm.alluser.site", () => {
    const config = getLocalModelConfig("unknown-model");

    assert.equal(config.apiUrl, "https://lm.alluser.site");
});

test("OpenAI model list exposes only GPT-5.4 nano", () => {
    assert.deepEqual(OPENAI_MODELS, [
        { id: "gpt-5.4-nano", name: "GPT-5.4 nano" },
    ]);
    assert.equal(DEFAULT_OPENAI_MODEL, "gpt-5.4-nano");
    assert.equal(normalizeOpenAIModel("gpt-5-mini"), "gpt-5.4-nano");
    assert.equal(normalizeOpenAIModel("gpt-5.4-mini"), "gpt-5.4-nano");
    assert.equal(normalizeOpenAIModel("gpt-5.4-nano"), "gpt-5.4-nano");
});

test("fetchOpenAICompletion sends additional instructions to the OpenAI route", async () => {
    let requestBody = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url, options) => {
        requestBody = JSON.parse(options.body);
        return Response.json({ result: "자료 조사 과정에서 핵심 정보를 정리하고 발표함." });
    };

    try {
        await fetchOpenAICompletion({
            prompt: "활동 내용을 작성하세요.",
            additionalInstructions: "개인별 수행 내용을 기준으로 작성",
            apiKey: "sk-test",
            targetChars: 100,
            model: "gpt-5.4-nano",
        });
    } finally {
        globalThis.fetch = originalFetch;
    }

    assert.equal(requestBody.additionalInstructions, "개인별 수행 내용을 기준으로 작성");
});

test("OpenAI route reinforces additional instructions in both system and user messages", async () => {
    let openAIRequestBody = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url, options) => {
        openAIRequestBody = JSON.parse(options.body);
        return Response.json({
            choices: [
                {
                    message: { content: "자료 조사 과정에서 핵심 정보를 정리하고 발표함." },
                },
            ],
        });
    };

    try {
        const response = await POST(new Request("http://localhost/api/openai-generate", {
            method: "POST",
            body: JSON.stringify({
                prompt: "활동 내용을 작성하세요.",
                additionalInstructions: "개인별 수행 내용을 기준으로 작성",
                apiKey: "sk-test",
                targetChars: 100,
                model: "gpt-5.4-nano",
            }),
        }));
        assert.equal(response.ok, true);
    } finally {
        globalThis.fetch = originalFetch;
    }

    assert.match(openAIRequestBody.messages[0].content, /【최우선 지침】[\s\S]*개인별 수행 내용을 기준으로 작성/);
    assert.match(openAIRequestBody.messages[1].content, /^\[최우선 규칙\].*개인별 수행 내용을 기준으로 작성/s);
    assert.match(openAIRequestBody.messages[1].content, /\[다시 한번 강조\].*개인별 수행 내용을 기준으로 작성$/s);
    assert.equal(openAIRequestBody.reasoning_effort, "none");
    assert.equal(openAIRequestBody.max_completion_tokens, 4096);
});

test("OpenAI route coerces legacy mini model requests to GPT-5.4 nano", async () => {
    let openAIRequestBody = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url, options) => {
        openAIRequestBody = JSON.parse(options.body);
        return Response.json({
            choices: [
                {
                    message: { content: "?먮즺 議곗궗 怨쇱젙?먯꽌 ?듭떖 ?뺣낫瑜??뺣━?섍퀬 諛쒗몴??" },
                },
            ],
        });
    };

    try {
        const response = await POST(new Request("http://localhost/api/openai-generate", {
            method: "POST",
            body: JSON.stringify({
                prompt: "?쒕룞 ?댁슜???묒꽦?섏꽭??",
                apiKey: "sk-test",
                targetChars: 100,
                model: "gpt-5.4-nano",
            }),
        }));
        const data = await response.json();
        assert.equal(response.ok, true);
        assert.equal(data.model, "gpt-5.4-nano");
    } finally {
        globalThis.fetch = originalFetch;
    }

    assert.equal(openAIRequestBody.model, "gpt-5.4-nano");
});

test("OpenAI route retries once when the API returns no visible text", async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
        calls += 1;
        if (calls === 1) {
            return Response.json({
                choices: [
                    {
                        message: { content: "" },
                        finish_reason: "length",
                    },
                ],
            });
        }
        return Response.json({
            choices: [
                {
                    message: { content: "자료 조사 과정에서 핵심 정보를 정리하고 발표함." },
                    finish_reason: "stop",
                },
            ],
        });
    };

    try {
        const response = await POST(new Request("http://localhost/api/openai-generate", {
            method: "POST",
            body: JSON.stringify({
                prompt: "활동 내용을 작성하세요.",
                apiKey: "sk-test",
                targetChars: 100,
                model: "gpt-5-mini",
            }),
        }));
        const data = await response.json();
        assert.equal(response.ok, true);
        assert.equal(data.result, "자료 조사 과정에서 핵심 정보를 정리하고 발표함.");
    } finally {
        globalThis.fetch = originalFetch;
    }

    assert.equal(calls, 2);
});
