import test from "node:test";
import assert from "node:assert/strict";

import { getGenerationProvider, runGenerationWithProgress } from "../utils/generationProgress.js";

test("runGenerationWithProgress shows provider-neutral connection and generation stages", async () => {
    const messages = [];
    const result = await runGenerationWithProgress({
        provider: "nvidia",
        attempt: 0,
        maxRepairAttempts: 4,
        setProgress: (message) => messages.push(message),
        sleep: async () => undefined,
        run: async () => "done",
    });

    assert.equal(result, "done");
    assert.deepEqual(messages, [
        "AI 연결 중...",
        "AI 연결 완료, 생성 요청 중...",
        "AI로 생성 중...",
    ]);
});

test("runGenerationWithProgress shows OpenAI connection and generation stages separately", async () => {
    const messages = [];
    await runGenerationWithProgress({
        provider: "openai",
        attempt: 0,
        maxRepairAttempts: 4,
        setProgress: (message) => messages.push(message),
        sleep: async () => undefined,
        run: async () => "done",
    });

    assert.deepEqual(messages, [
        "AI 연결 중...",
        "AI 연결 완료, 생성 요청 중...",
        "AI로 생성 중...",
    ]);
});

test("runGenerationWithProgress shows local LLM connection and generation stages separately", async () => {
    const messages = [];
    await runGenerationWithProgress({
        provider: "local",
        attempt: 0,
        maxRepairAttempts: 4,
        setProgress: (message) => messages.push(message),
        sleep: async () => undefined,
        run: async () => "done",
    });

    assert.deepEqual(messages, [
        "AI 연결 중...",
        "AI 연결 완료, 생성 요청 중...",
        "AI로 생성 중...",
    ]);
});

test("runGenerationWithProgress shows Upstage connection and generation stages separately", async () => {
    const messages = [];
    await runGenerationWithProgress({
        provider: "upstage",
        setProgress: (message) => messages.push(message),
        sleep: async () => undefined,
        run: async () => "done",
    });

    assert.deepEqual(messages, [
        "AI 연결 중...",
        "AI 연결 완료, 생성 요청 중...",
        "AI로 생성 중...",
    ]);
});

test("getGenerationProvider prioritizes an explicitly selected Upstage model", () => {
    assert.equal(getGenerationProvider({ isUpstageSelected: true, hasOpenAIKey: true }), "upstage");
});

test("runGenerationWithProgress uses user-friendly repair retry wording", async () => {
    const messages = [];
    await runGenerationWithProgress({
        provider: "nvidia",
        attempt: 2,
        maxRepairAttempts: 4,
        setProgress: (message) => messages.push(message),
        sleep: async () => undefined,
        run: async () => "done",
    });

    assert.deepEqual(messages, ["분량과 문장을 다듬는 중... 2/4"]);
});

test("runGenerationWithProgress explains short-output repair in plain Korean", async () => {
    const messages = [];
    await runGenerationWithProgress({
        provider: "nvidia",
        attempt: 1,
        maxRepairAttempts: 4,
        previousValidation: {
            issues: [{ code: "under_min_bytes" }],
        },
        setProgress: (message) => messages.push(message),
        sleep: async () => undefined,
        run: async () => "done",
    });

    assert.deepEqual(messages, ["분량이 부족해서 내용을 더 채우는 중... 1/4"]);
});
