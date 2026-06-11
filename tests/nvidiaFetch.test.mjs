import test from "node:test";
import assert from "node:assert/strict";

import {
    AVAILABLE_MODELS,
    DEFAULT_MODEL,
    getModelOptionLabel,
    getNvidiaModelId,
    isNvidiaModel,
} from "../utils/streamFetch.js";
import { fetchNvidiaCompletion } from "../utils/nvidiaFetch.js";
import { POST } from "../app/api/nvidia-generate/route.js";

test("AI model list hides NVIDIA cloud models", () => {
    const cloudModels = AVAILABLE_MODELS.filter((model) => model.provider === "nvidia");
    const ids = cloudModels.map((model) => model.id);

    assert.deepEqual(ids, []);
    assert.equal(AVAILABLE_MODELS.some((model) => getModelOptionLabel(model).startsWith("(Cloud) ")), false);
    assert.equal(isNvidiaModel("nvidia:google/gemma-4-31b-it"), true);
    assert.equal(getNvidiaModelId("nvidia:google/gemma-4-31b-it"), "google/gemma-4-31b-it");
});

test("default model uses LM Studio Gemma 4 12B local model", () => {
    assert.equal(DEFAULT_MODEL, "lmstudio:gemma-4-12b-it");
    assert.equal(isNvidiaModel(DEFAULT_MODEL), false);
});

test("fetchNvidiaCompletion sends the selected NVIDIA model to the server route", async () => {
    let requestBody = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url, options) => {
        requestBody = JSON.parse(options.body);
        return Response.json({ result: "자료를 분석하고 구체적인 과정을 서술함." });
    };

    try {
        const result = await fetchNvidiaCompletion({
            prompt: "본문 작성",
            additionalInstructions: "개별 수행 과정 중심",
            targetChars: 100,
            model: "nvidia:google/gemma-4-31b-it",
        });
        assert.equal(result, "자료를 분석하고 구체적인 과정을 서술함.");
    } finally {
        globalThis.fetch = originalFetch;
    }

    assert.equal(requestBody.model, "nvidia:google/gemma-4-31b-it");
    assert.equal(requestBody.additionalInstructions, "개별 수행 과정 중심");
});

test("NVIDIA route calls the OpenAI-compatible NIM endpoint with env key", async () => {
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.NVIDIA_API_KEY;
    const originalUrl = process.env.NVIDIA_API_URL;
    let requestUrl = null;
    let requestHeaders = null;
    let requestBody = null;

    process.env.NVIDIA_API_KEY = "nvapi-test";
    process.env.NVIDIA_API_URL = "https://example.test/v1/chat/completions";
    globalThis.fetch = async (url, options) => {
        requestUrl = url;
        requestHeaders = options.headers;
        requestBody = JSON.parse(options.body);
        return Response.json({
            choices: [
                {
                    message: { content: "관찰 내용을 바탕으로 구체적인 활동 과정을 서술함." },
                    finish_reason: "stop",
                },
            ],
        });
    };

    try {
        const response = await POST(new Request("http://localhost/api/nvidia-generate", {
            method: "POST",
            body: JSON.stringify({
                prompt: "본문 작성",
                additionalInstructions: "개별 수행 과정 중심",
                targetChars: 100,
                model: "nvidia:google/gemma-4-31b-it",
            }),
        }));
        const data = await response.json();
        assert.equal(response.ok, true);
        assert.equal(data.result, "관찰 내용을 바탕으로 구체적인 활동 과정을 서술함.");
    } finally {
        globalThis.fetch = originalFetch;
        process.env.NVIDIA_API_KEY = originalKey;
        process.env.NVIDIA_API_URL = originalUrl;
    }

    assert.equal(requestUrl, "https://example.test/v1/chat/completions");
    assert.equal(requestHeaders.Authorization, "Bearer nvapi-test");
    assert.equal(requestBody.model, "google/gemma-4-31b-it");
    assert.equal(requestBody.max_tokens, 512);
    assert.match(requestBody.messages[0].content, /입력 키워드/);
    assert.match(requestBody.messages[0].content, /첫 응답에서 바로 충분한 분량/);
    assert.match(requestBody.messages[0].content, /사용자 추가 규칙/);
});

test("NVIDIA route ignores unsupported env fallback model", async () => {
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.NVIDIA_API_KEY;
    const originalModel = process.env.NVIDIA_MODEL;
    let requestBody = null;

    process.env.NVIDIA_API_KEY = "nvapi-test";
    process.env.NVIDIA_MODEL = "meta/llama-3.1-8b-instruct";
    globalThis.fetch = async (_url, options) => {
        requestBody = JSON.parse(options.body);
        return Response.json({
            choices: [
                {
                    message: { content: "관찰 내용을 바탕으로 구체적인 활동 과정을 서술함." },
                    finish_reason: "stop",
                },
            ],
        });
    };

    try {
        const response = await POST(new Request("http://localhost/api/nvidia-generate", {
            method: "POST",
            body: JSON.stringify({
                prompt: "본문 작성",
                targetChars: 100,
                model: "not-allowed-model",
            }),
        }));
        assert.equal(response.ok, true);
    } finally {
        globalThis.fetch = originalFetch;
        process.env.NVIDIA_API_KEY = originalKey;
        process.env.NVIDIA_MODEL = originalModel;
    }

    assert.equal(requestBody.model, "google/gemma-4-31b-it");
});

test("NVIDIA route retries transient bad gateway responses", async () => {
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.NVIDIA_API_KEY;
    let calls = 0;

    process.env.NVIDIA_API_KEY = "nvapi-test";
    globalThis.fetch = async () => {
        calls += 1;
        if (calls === 1) {
            return new Response("<html><h1>502 Bad Gateway</h1></html>", {
                status: 502,
                headers: { "Content-Type": "text/html" },
            });
        }
        return Response.json({
            choices: [
                {
                    message: { content: "관찰 내용을 바탕으로 구체적인 활동 과정을 서술함." },
                    finish_reason: "stop",
                },
            ],
        });
    };

    try {
        const response = await POST(new Request("http://localhost/api/nvidia-generate", {
            method: "POST",
            body: JSON.stringify({
                prompt: "본문 작성",
                targetChars: 100,
                model: "nvidia:google/gemma-4-31b-it",
            }),
        }));
        const data = await response.json();
        assert.equal(response.ok, true);
        assert.equal(data.result, "관찰 내용을 바탕으로 구체적인 활동 과정을 서술함.");
    } finally {
        globalThis.fetch = originalFetch;
        process.env.NVIDIA_API_KEY = originalKey;
    }

    assert.equal(calls, 2);
});
