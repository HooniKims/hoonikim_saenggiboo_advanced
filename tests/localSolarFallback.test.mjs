import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateWithLocalSolarFallback, getSolarFallbackNotice } from "../utils/localSolarFallback.js";
import { isFactCheckedUpstageModel } from "../utils/streamFetch.js";

// 반복 검사에 걸리지 않도록 단계마다 서로 다른 문장을 만든다.
const STEP_SENTENCES = [
    "1단계의 핵심 내용을 구체적으로 정리함.",
    "2단계에서는 조사한 자료의 출처를 비교하며 믿을 만한 근거를 골라냄.",
    "3단계에서 모둠 발표 순서를 정하고 맡은 부분의 설명 흐름을 다듬음.",
];
const makeText = (phrase, count) => Array.from(
    { length: count },
    (_, index) => (index === 0 ? `${phrase} ${STEP_SENTENCES[0]}` : STEP_SENTENCES[index % STEP_SENTENCES.length]),
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

    assert.equal(localCalls, 3, "기본 모드는 로컬 모델에 분량 이어 쓰기 기회를 두 번 더 줌");
    assert.equal(solarCalls, 1);
    assert.equal(result.provider, "upstage");
    assert.equal(result.usedSolarFallback, true);
    assert.equal(result.validation.ok, true);
});

test("local and fallback Solar requests exclude forbidden terms even during length repair", async () => {
    const name = "가명학생";
    const prompts = { local: [], solar: [] };
    const result = await generateWithLocalSolarFallback({
        prompt: `${name}의 자료 조사`,
        validationOptions: { ...validationOptions, forbiddenTerms: [name], privateTerms: [name] },
        localGenerateOnce: async (prompt) => {
            prompts.local.push(prompt);
            return `${name} 자료 조사함.`;
        },
        solarGenerateOnce: async (prompt) => {
            prompts.solar.push(prompt);
            return prompts.solar.length === 1 ? `${name} 자료 조사함.` : makeText("조사 결과를 정리하며", 3);
        },
    });
    assert.equal(result.provider, "upstage");
    assert.equal(prompts.local.length, 3);
    assert.equal(prompts.solar.length, 2);
    assert.ok([...prompts.local, ...prompts.solar].every((prompt) => !prompt.includes(name)));
    assert.ok(!result.text.includes(name));
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

test("Solar fallback notice tells the teacher why Solar Pro 4 wrote the result", async () => {
    const shortResult = await generateWithLocalSolarFallback({
        prompt: "자료 조사",
        validationOptions,
        localGenerateOnce: async () => "자료 조사함.",
        solarGenerateOnce: async () => makeText("자료 조사 내용을 Solar로 보완하여", 3),
    });
    assert.deepEqual([...new Set(shortResult.localIssueCodes)].every((code) => code.startsWith("under_min")), true);
    assert.equal(getSolarFallbackNotice(shortResult), "선택한 로컬 모델 결과가 권장 분량보다 짧아 Solar Pro 4가 대신 작성했습니다.");

    const errorResult = await generateWithLocalSolarFallback({
        prompt: "자료 조사",
        validationOptions,
        localGenerateOnce: async () => { throw new Error("로컬 서버 응답 없음"); },
        solarGenerateOnce: async () => makeText("자료 조사 내용을 Solar로 보완하여", 3),
    });
    assert.match(getSolarFallbackNotice(errorResult), /^선택한 로컬 모델이 응답하지 않아 Solar Pro 4가 대신 작성했습니다\.$/);

    assert.match(
        getSolarFallbackNotice({ usedSolarFallback: true, fallbackFailed: true, localIssueCodes: ["banned_term"] }),
        /작성 규칙에 맞지 않아 .*로컬 모델 결과를 그대로 보여 줍니다/,
    );
    assert.equal(getSolarFallbackNotice({ usedSolarFallback: false }), "");
});

test("every generation page shows the Solar fallback notice under the result", () => {
    for (const route of ["gwasetuk", "club", "behavior", "letter"]) {
        const source = readFileSync(new URL(`../app/${route}/page.js`, import.meta.url), "utf8");
        assert.match(source, /updateStudent\(student\.id, "fallbackNotice", getSolarFallbackNotice\(generationResult\)\)/, route);
        assert.match(source, /updateStudent\(student\.id, "fallbackNotice", ""\)/, route);
        assert.match(source, /className="fallback-notice"/, route);
    }
});

test("Solar Pro 4 and Solar Mini 4.5 share the no-padding, fact-checked path", () => {
    assert.equal(isFactCheckedUpstageModel("upstage:solar-pro4"), true);
    assert.equal(isFactCheckedUpstageModel("upstage:solar-mini-4-5-preview"), true);
    assert.equal(isFactCheckedUpstageModel("lmstudio:gemma-4-12b-it"), false);
});

test("local model appends the missing length before falling back to Solar", async () => {
    const prompts = [];
    const result = await generateWithLocalSolarFallback({
        prompt: "자료 조사",
        validationOptions,
        localGenerateOnce: async (prompt) => {
            prompts.push(prompt);
            return prompts.length === 1 ? makeText("자료 조사 활동에서", 1) : `${STEP_SENTENCES[1]} ${STEP_SENTENCES[2]}`;
        },
        solarGenerateOnce: async () => {
            throw new Error("Solar should not be called");
        },
    });

    assert.equal(result.provider, "local");
    assert.equal(result.usedSolarFallback, false);
    assert.match(prompts[1], /기존 본문은 시스템이 유지합니다/);
    assert.match(result.text, /자료 조사 활동에서 1단계/);
});

test("strict-fact local generation keeps a single repair before Solar", async () => {
    let localCalls = 0;
    await generateWithLocalSolarFallback({
        prompt: "자료 조사",
        validationOptions: { ...validationOptions, strictFacts: true },
        localGenerateOnce: async () => {
            localCalls += 1;
            return "자료 조사함.";
        },
        solarGenerateOnce: async () => makeText("자료 조사 내용을 Solar로 보완하여", 3),
    });
    assert.equal(localCalls, 2);
});
