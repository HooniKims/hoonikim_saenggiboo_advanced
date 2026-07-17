import test from "node:test";
import assert from "node:assert/strict";
import { generateWithLocalSolarFallback } from "../utils/localSolarFallback.js";

const makeText = (phrase, count) => Array.from(
    { length: count },
    (_, index) => `${phrase} ${index + 1}단계의 핵심 내용을 구체적으로 정리함.`,
).join(" ");
const validationOptions = {
    targetChars: 300,
    minTargetBytes: 200,
    maxTargetBytes: 600,
    mode: "record",
};

test("local Solar fallback exposes its generation entry point", async () => {
    const fallbackModule = await import("../utils/localSolarFallback.js").catch(() => ({}));

    assert.equal(typeof fallbackModule.generateWithLocalSolarFallback, "function");
});

test("local Solar fallback returns valid local output without calling Solar", async () => {
    let solarCalls = 0;

    const result = await generateWithLocalSolarFallback({
        prompt: "자료 조사",
        validationOptions,
        localGenerateOnce: async () => makeText("자료 조사 활동에서", 3),
        solarGenerateOnce: async () => {
            solarCalls += 1;
            return makeText("Solar 보정에서", 3);
        },
    });

    assert.equal(result.provider, "local");
    assert.equal(result.usedSolarFallback, false);
    assert.equal(solarCalls, 0);
});

test("local Solar fallback calls Solar after local output remains invalid", async () => {
    let localCalls = 0;
    let solarCalls = 0;

    const result = await generateWithLocalSolarFallback({
        prompt: "자료 조사",
        validationOptions,
        localGenerateOnce: async () => {
            localCalls += 1;
            return "자료 조사함.";
        },
        solarGenerateOnce: async () => {
            solarCalls += 1;
            return makeText("자료 조사 내용을 Solar로 보완하여", 3);
        },
    });

    assert.equal(localCalls, 2);
    assert.equal(solarCalls, 1);
    assert.equal(result.provider, "upstage");
    assert.equal(result.usedSolarFallback, true);
    assert.equal(result.validation.ok, true);
});

test("local Solar fallback returns the best local output when Solar throws", async () => {
    const localOutputs = [
        makeText("자료 조사 활동을 충실히 수행하여", 3),
        "자료 조사함.",
    ];

    const result = await generateWithLocalSolarFallback({
        prompt: "자료 조사",
        validationOptions: { ...validationOptions, minTargetBytes: 500 },
        localGenerateOnce: async () => localOutputs.shift(),
        solarGenerateOnce: async () => {
            throw new Error("Solar unavailable");
        },
    });

    assert.equal(result.provider, "local");
    assert.equal(result.usedSolarFallback, true);
    assert.equal(result.fallbackFailed, true);
    assert.match(result.text, /충실히 수행하여/);
});

test("local Solar fallback keeps a successful Solar response even when validation still warns", async () => {
    const result = await generateWithLocalSolarFallback({
        prompt: "원본 지침",
        localGenerateOnce: async () => "자료를 정리함.",
        solarGenerateOnce: async () => "자료를 정리하고 핵심 내용을 발표함. 토론 결과를 기록함.",
        validationOptions: { ...validationOptions, minTargetBytes: 500 },
    });

    assert.equal(result.provider, "upstage");
    assert.equal(result.usedSolarFallback, true);
    assert.equal(result.fallbackFailed, false);
    assert.match(result.text, /토론 결과/);
});

test("local Solar fallback throws only when neither provider produced text", async () => {
    await assert.rejects(
        generateWithLocalSolarFallback({
            prompt: "자료 조사",
            validationOptions,
            localGenerateOnce: async () => {
                throw new Error("local unavailable");
            },
            solarGenerateOnce: async () => {
                throw new Error("Solar unavailable");
            },
        }),
        /Solar unavailable/,
    );
});
