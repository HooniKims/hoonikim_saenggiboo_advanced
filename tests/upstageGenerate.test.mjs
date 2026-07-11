import test from "node:test";
import assert from "node:assert/strict";

import { POST } from "../app/api/upstage-generate/route.js";

function jsonRequest(body) {
    return new Request("http://localhost/api/upstage-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

function restoreEnv(name, value) {
    if (value === undefined) {
        delete process.env[name];
    } else {
        process.env[name] = value;
    }
}

test("Upstage route asks for UPSTAGE_API_KEY when the env key is empty", async () => {
    const originalApiKey = process.env.UPSTAGE_API_KEY;
    delete process.env.UPSTAGE_API_KEY;

    try {
        const response = await POST(jsonRequest({
            prompt: "과세특 본문을 작성하세요.",
            targetChars: 490,
        }));
        const data = await response.json();

        assert.equal(response.status, 400);
        assert.match(data.error, /UPSTAGE_API_KEY/);
    } finally {
        restoreEnv("UPSTAGE_API_KEY", originalApiKey);
    }
});

test("Upstage route sends Solar Pro 2 with stable reasoning effort and priority instructions", async () => {
    const originalFetch = globalThis.fetch;
    const originalApiKey = process.env.UPSTAGE_API_KEY;
    const originalApiUrl = process.env.UPSTAGE_API_URL;
    const originalModel = process.env.UPSTAGE_MODEL;
    const originalEffort = process.env.UPSTAGE_REASONING_EFFORT;
    const originalMaxTokens = process.env.UPSTAGE_MAX_TOKENS;
    let requestUrl = "";
    let requestHeaders = null;
    let requestBody = null;

    process.env.UPSTAGE_API_KEY = "upstage-test-key";
    delete process.env.UPSTAGE_API_URL;
    delete process.env.UPSTAGE_MODEL;
    delete process.env.UPSTAGE_REASONING_EFFORT;
    delete process.env.UPSTAGE_MAX_TOKENS;

    globalThis.fetch = async (url, options) => {
        requestUrl = url;
        requestHeaders = options.headers;
        requestBody = JSON.parse(options.body);
        return Response.json({
            choices: [
                {
                    message: { content: "자료 조사 과정에서 핵심 정보를 정리하고 발표함." },
                },
            ],
        });
    };

    try {
        const response = await POST(jsonRequest({
            prompt: "과세특 본문을 작성하세요.",
            additionalInstructions: "개인별 수행 내용을 기준으로 작성",
            targetChars: 490,
        }));
        const data = await response.json();

        assert.equal(response.status, 200);
        assert.equal(data.model, "solar-pro2");
    } finally {
        globalThis.fetch = originalFetch;
        restoreEnv("UPSTAGE_API_KEY", originalApiKey);
        restoreEnv("UPSTAGE_API_URL", originalApiUrl);
        restoreEnv("UPSTAGE_MODEL", originalModel);
        restoreEnv("UPSTAGE_REASONING_EFFORT", originalEffort);
        restoreEnv("UPSTAGE_MAX_TOKENS", originalMaxTokens);
    }

    assert.equal(requestUrl, "https://api.upstage.ai/v1/chat/completions");
    assert.equal(requestHeaders.Authorization, "Bearer upstage-test-key");
    assert.equal(requestBody.model, "solar-pro2");
    assert.equal(requestBody.max_tokens, 16384);
    assert.equal(requestBody.reasoning_effort, "low");
    assert.equal(requestBody.temperature, 0.1);
    assert.equal(requestBody.stream, false);
    assert.match(requestBody.messages[0].content, /현재형 명사 종결어미/);
    assert.match(requestBody.messages[0].content, /과목명\/프로그램명\/동아리명을 출력에 절대 포함하지 않음/);
    assert.match(requestBody.messages[0].content, /입력된 모든 활동 내용을 빠짐없이 반영/);
    assert.match(requestBody.messages[0].content, /문장이 끝나면 마침표\(\.\)를 찍고 한 칸 띄우며/);
    assert.match(requestBody.messages[0].content, /오직 본문 텍스트만 출력/);
    assert.match(requestBody.messages[0].content, /【최우선 지침】[\s\S]*개인별 수행 내용을 기준으로 작성/);
    assert.match(requestBody.messages[0].content, /지침 충돌[\s\S]*설명하지/);
    assert.match(requestBody.messages[0].content, /주의[\s\S]*시스템 오류[\s\S]*재작성 요청/);
    assert.match(requestBody.messages[0].content, /입력에 없는 사실/);
    assert.match(requestBody.messages[0].content, /각 활동의 핵심 수행과 지정된 성취 수준을 한 문장 안에 통합/);
    assert.match(requestBody.messages[0].content, /모든 활동을 최소 한 문장씩 먼저 완성/);
    assert.match(requestBody.messages[0].content, /전체 활동에 분량을 균등하게 배분/);
    assert.match(requestBody.messages[1].content, /^\[최우선 규칙\].*개인별 수행 내용을 기준으로 작성/s);
    assert.match(requestBody.messages[1].content, /\[다시 한번 강조\].*개인별 수행 내용을 기준으로 작성$/s);
});

test("Upstage route uses the dedicated polite letter system message for home letters", async () => {
    const originalFetch = globalThis.fetch;
    const originalApiKey = process.env.UPSTAGE_API_KEY;
    let requestBody = null;

    process.env.UPSTAGE_API_KEY = "upstage-test-key";

    globalThis.fetch = async (_url, options) => {
        requestBody = JSON.parse(options.body);
        return Response.json({
            choices: [
                {
                    message: { content: "학교생활을 성실하게 수행했으며 방학 동안 건강한 생활 리듬을 이어가기를 바랍니다." },
                },
            ],
        });
    };

    try {
        const response = await POST(jsonRequest({
            prompt: "가정통신문을 작성하세요.",
            targetChars: 490,
            outputType: "letter",
        }));

        assert.equal(response.status, 200);
    } finally {
        globalThis.fetch = originalFetch;
        restoreEnv("UPSTAGE_API_KEY", originalApiKey);
    }

    const systemMessage = requestBody.messages[0].content;
    assert.match(systemMessage, /학기말 가정통신문 작성 전문가/);
    assert.match(systemMessage, /경어체/);
    assert.match(systemMessage, /학교생활을 성실하게 수행한 내용은 과거 경어체/);
    assert.match(systemMessage, /입력된 키워드는 방학 조언 영역으로 사용/);
    assert.match(systemMessage, /학업 계획, 건강한 생활 리듬, 친구와의 배려 있는 관계, 가족과의 대화나 지지 중 최소 세 가지 이상/);
    assert.doesNotMatch(systemMessage, /학교생활기록부와 가정통신문 작성을 도와줍니다/);
});

test("Upstage route replaces contradictory byte instructions and normalizes record punctuation", async () => {
    const originalFetch = globalThis.fetch;
    const originalApiKey = process.env.UPSTAGE_API_KEY;
    let requestBody = null;

    process.env.UPSTAGE_API_KEY = "upstage-test-key";
    globalThis.fetch = async (_url, options) => {
        requestBody = JSON.parse(options.body);
        return Response.json({
            choices: [
                {
                    message: { content: "자료에 관심을 보였으나 자료를 조사했으며 (A) 결과를 발표함\n\n(1497byte / 678자)" },
                },
            ],
        });
    };

    try {
        const response = await POST(jsonRequest({
            prompt: `과세특 본문을 작성하세요.

<분량 제한>
전체 byte: 1500byte 이하 (초과 불가)
목표 byte: 1275byte ~ 1500byte
Target visible length: write 648-677 Korean visible characters for the 1500byte setting.
작성 분량 참고: 한글 기준 약 500자 안팎

작성 방법:
1. 최종 출력은 선택한 byte 제한의 85% 이상을 목표로 작성
2. 문장이 끝나면 마침표를 작성

입력된 활동에서 확인되는 내용만 사용함

<출력 형식>
오직 본문만 출력`,
            targetChars: 589,
        }));
        const data = await response.json();

        assert.equal(response.status, 200);
        assert.equal(data.result, "자료에 관심을 보이나 자료를 조사하며 결과를 발표함.");
    } finally {
        globalThis.fetch = originalFetch;
        restoreEnv("UPSTAGE_API_KEY", originalApiKey);
    }

    const userMessage = requestBody.messages[1].content;
    assert.doesNotMatch(userMessage, /1500byte|1275byte|Target visible length/);
    assert.match(userMessage, /본문은 559~571자 정도를 목표/);
    assert.match(userMessage, /글자수나 byte 수치를 직접 계산하거나 출력하지 않음/);
    assert.match(userMessage, /핵심 키워드의 의미 범위 안에서/);
    assert.match(userMessage, /수행 과정, 참여 태도, 사고 수준, 피드백 반영, 성취 수준/);
    assert.match(userMessage, /같은 활동을 서로 다른 관찰 관점으로 풀어/);
    assert.match(userMessage, /다섯 관점을 각각 별도 문장으로 빠짐없이/);
    assert.match(userMessage, /모든 활동을 한 문장씩 먼저 작성/);
    assert.match(userMessage, /작품명, 수상, 기관, 수치, 도구/);
    assert.match(userMessage, /<출력 형식>/);
});

test("Upstage route retries reasoning-only length responses with the model token budget", async () => {
    const originalFetch = globalThis.fetch;
    const originalApiKey = process.env.UPSTAGE_API_KEY;
    const originalMaxTokens = process.env.UPSTAGE_MAX_TOKENS;
    const calls = [];

    process.env.UPSTAGE_API_KEY = "upstage-test-key";
    delete process.env.UPSTAGE_MAX_TOKENS;

    globalThis.fetch = async (_url, options) => {
        calls.push(JSON.parse(options.body));
        if (calls.length === 1) {
            return Response.json({
                choices: [
                    {
                        message: { content: "", reasoning: "추론 토큰이 길게 생성됨" },
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
        const response = await POST(jsonRequest({
            prompt: "과세특 본문을 작성하세요.",
            targetChars: 236,
        }));
        const data = await response.json();

        assert.equal(response.status, 200);
        assert.equal(data.result, "자료 조사 과정에서 핵심 정보를 정리하고 발표함.");
    } finally {
        globalThis.fetch = originalFetch;
        restoreEnv("UPSTAGE_API_KEY", originalApiKey);
        restoreEnv("UPSTAGE_MAX_TOKENS", originalMaxTokens);
    }

    assert.equal(calls.length, 2);
    assert.equal(calls[0].max_tokens, 16384);
    assert.equal(calls[1].max_tokens, 16384);
    assert.match(calls[1].messages[1].content, /추론은 최소화하고/);
});

test("Upstage route chooses max tokens and reasoning by model", async () => {
    const originalFetch = globalThis.fetch;
    const originalApiKey = process.env.UPSTAGE_API_KEY;
    const originalModel = process.env.UPSTAGE_MODEL;
    const originalEffort = process.env.UPSTAGE_REASONING_EFFORT;
    const originalMaxTokens = process.env.UPSTAGE_MAX_TOKENS;
    const requests = [];

    process.env.UPSTAGE_API_KEY = "upstage-test-key";
    process.env.UPSTAGE_REASONING_EFFORT = "low";
    delete process.env.UPSTAGE_MAX_TOKENS;

    globalThis.fetch = async (_url, options) => {
        requests.push(JSON.parse(options.body));
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
        for (const model of ["solar-mini", "solar-open-2", "solar-pro2", "solar-pro3", "syn-pro"]) {
            process.env.UPSTAGE_MODEL = model;
            const response = await POST(jsonRequest({
                prompt: "과세특 본문을 작성하세요.",
                targetChars: 490,
            }));
            assert.equal(response.status, 200);
        }
    } finally {
        globalThis.fetch = originalFetch;
        restoreEnv("UPSTAGE_API_KEY", originalApiKey);
        restoreEnv("UPSTAGE_MODEL", originalModel);
        restoreEnv("UPSTAGE_REASONING_EFFORT", originalEffort);
        restoreEnv("UPSTAGE_MAX_TOKENS", originalMaxTokens);
    }

    assert.deepEqual(
        requests.map((request) => [request.model, request.max_tokens, request.reasoning_effort]),
        [
            ["solar-mini", 16384, undefined],
            ["solar-open-2", 131072, undefined],
            ["solar-pro2", 16384, "low"],
            ["solar-pro3", 65536, "low"],
            ["syn-pro", 16384, "low"],
        ],
    );
});

test("Upstage route retries one timed-out request", async () => {
    const originalFetch = globalThis.fetch;
    const originalApiKey = process.env.UPSTAGE_API_KEY;
    let calls = 0;

    process.env.UPSTAGE_API_KEY = "upstage-test-key";
    globalThis.fetch = async () => {
        calls += 1;
        if (calls === 1) {
            const error = new Error("aborted");
            error.name = "AbortError";
            throw error;
        }
        return Response.json({
            choices: [{ message: { content: "자료를 정리하고 발표함." } }],
        });
    };

    try {
        const response = await POST(jsonRequest({
            prompt: "과세특 본문을 작성하세요.",
            targetChars: 236,
        }));
        const data = await response.json();

        assert.equal(response.status, 200);
        assert.equal(data.result, "자료를 정리하고 발표함.");
        assert.equal(calls, 2);
    } finally {
        globalThis.fetch = originalFetch;
        restoreEnv("UPSTAGE_API_KEY", originalApiKey);
    }
});
