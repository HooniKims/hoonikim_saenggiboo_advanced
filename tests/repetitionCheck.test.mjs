import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateWithSilentValidation } from "../utils/generationHarness.js";
import { getUtf8ByteLength } from "../utils/textProcessor.js";
import { parseRepetitionPairs, describeRepetitionPairs } from "../utils/repetitionJudge.js";
import { POST } from "../app/api/repetition-check/route.js";

const DRAFT = "열의 이동 실험에서 온도 변화를 기록함. 온도계 눈금을 일정한 간격으로 읽어 수치를 적음. 측정값을 선그래프로 나타내고 두 물질을 비교함. 측정한 온도를 그래프로 옮겨 두 물질의 변화를 견주어 봄.";
const REVISED = "열의 이동 실험에서 온도 변화를 기록함. 온도계 눈금을 일정한 간격으로 읽어 수치를 적음. 측정값을 선그래프로 나타내고 두 물질을 비교함. 기록이 빠진 구간을 다시 확인하며 자료의 정확성을 높임.";

test("judge pairs are parsed, ordered and bounded to the sentence count", () => {
    assert.deepEqual(parseRepetitionPairs('결과: {"pairs": [[4, 3], [1, 9], [2, 2]]}', 4), [[3, 4]]);
    assert.deepEqual(parseRepetitionPairs("반복 없음", 4), []);
    const sentences = DRAFT.split(/(?<=\.)\s+/);
    assert.match(describeRepetitionPairs([[3, 4]], sentences), /^4번째 문장 '측정한 온도를 그래프로.*3번째 문장과 같은 내용을 되풀이함$/);
});

test("a paraphrased sentence found by the judge is removed without regenerating", async () => {
    let calls = 0;
    const result = await generateWithSilentValidation({
        prompt: "과세특을 작성하세요.",
        targetChars: 300,
        mode: "record",
        maxRepairAttempts: 2,
        checkRepetition: async (text) => ({ pairs: text === DRAFT ? [[3, 4]] : [] }),
        generateOnce: async () => {
            calls += 1;
            return DRAFT;
        },
    });

    assert.equal(calls, 1);
    assert.doesNotMatch(result.text, /측정한 온도를 그래프로 옮겨/);
    assert.match(result.text, /측정값을 선그래프로 나타내고 두 물질을 비교함\.$/);
});

test("after removing a repeat, the missing length is filled by appending only new sentences", async () => {
    const prompts = [];
    const appended = "기록이 빠진 구간을 다시 확인하며 자료의 정확성을 높임.";
    const result = await generateWithSilentValidation({
        prompt: "과세특을 작성하세요.",
        targetChars: 300,
        mode: "record",
        maxRepairAttempts: 2,
        minTargetBytes: 250,
        maxTargetBytes: 700,
        acceptLengthOnlyResult: false,
        preserveTextOnLengthRepair: true,
        checkRepetition: async (text) => ({ pairs: text === DRAFT ? [[3, 4]] : [] }),
        generateOnce: async (prompt) => {
            prompts.push(prompt);
            return prompts.length === 1 ? DRAFT : appended;
        },
    });

    assert.equal(prompts.length, 2);
    assert.match(prompts[1], /기존 본문은 시스템이 유지합니다/);
    assert.equal(result.text, REVISED);
});

test("an append response can echo the draft without hiding later new sentences behind the byte cap", async () => {
    const base = DRAFT.slice(0, DRAFT.lastIndexOf(" 측정한"));
    const addition = "기록이 빠진 구간을 다시 확인하며 자료의 정확성을 높임.";
    const expected = `${base} ${addition}`;
    const prompts = [];
    const result = await generateWithSilentValidation({
        prompt: "과세특을 작성하세요.",
        targetChars: 300,
        minTargetBytes: getUtf8ByteLength(expected),
        maxTargetBytes: getUtf8ByteLength(expected) + 10,
        acceptLengthOnlyResult: false,
        preserveTextOnLengthRepair: true,
        maxRepairAttempts: 1,
        generateOnce: async (prompt) => {
            prompts.push(prompt);
            return prompts.length === 1 ? base : expected;
        },
    });
    assert.equal(result.text, expected);
    assert.equal(result.validation.ok, true);
    assert.match(prompts[1], /new text alone has a \d+byte budget/);
});

test("the judge removes the final attempt's repeated sentence and returns a length warning", async () => {
    let checks = 0;
    const result = await generateWithSilentValidation({
        prompt: "과세특을 작성하세요.",
        targetChars: 300,
        mode: "record",
        maxRepairAttempts: 0,
        minTargetBytes: getUtf8ByteLength(DRAFT),
        acceptLengthOnlyResult: false,
        checkRepetition: async () => {
            checks += 1;
            return { pairs: [[3, 4]] };
        },
        generateOnce: async () => DRAFT,
    });
    assert.equal(checks, 1);
    assert.equal(result.text, DRAFT.slice(0, DRAFT.lastIndexOf(" 측정한")));
    assert.equal(result.acceptedWithLengthWarning, true);
    assert.deepEqual(result.validation.issues.map(({ code }) => code), ["under_min_bytes"]);
});

test("local cleanup keeps distinct sentences with a shared phrase and removes near duplicates", async () => {
    const first = "열의 이동 실험에서 측정한 수치를 선그래프로 나타내고 두 물질의 변화를 비교함.";
    const distinct = "열의 이동 실험에서 측정한 수치를 근거로 오차 원인을 토론하고 기록 방식을 수정함.";
    const duplicate = "열의 이동 실험에서 측정한 수치를 선그래프로 나타내어 두 물질의 변화를 비교함.";
    const result = await generateWithSilentValidation({
        prompt: "과세특을 작성하세요.",
        minTargetChars: 0,
        maxRepairAttempts: 0,
        generateOnce: async () => `${first} ${distinct} ${duplicate}`,
        checkRepetition: async () => { throw new Error("429"); },
    });
    assert.equal(result.text, `${first} ${distinct}`);
    assert.equal(result.validation.ok, true);
});

test("the judge is skipped for blocking issues and invalid pairs cannot remove the whole paragraph", async () => {
    let calls = 0;
    const result = await generateWithSilentValidation({
        prompt: "과세특을 작성하세요.",
        minTargetChars: 0,
        maxRepairAttempts: 1,
        requiredContentGroups: [{ label: "비교", terms: ["두 물질"] }],
        generateOnce: async (_prompt, { attempt }) => attempt === 0
            ? "온도 변화를 기록하였음. 측정값을 선그래프로 나타냄."
            : DRAFT,
        checkRepetition: async () => {
            calls += 1;
            return { pairs: [[0, 1], [2, 1], [3, 3], [2, 9]] };
        },
    });
    assert.equal(result.text, DRAFT);
    assert.equal(calls, 1);
});

test("repetition-check route asks Solar Mini with reasoning off and never fails the request", async () => {
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.UPSTAGE_API_KEY;
    const bodies = [];
    process.env.UPSTAGE_API_KEY = "upstage-test-key";
    try {
        globalThis.fetch = async (_url, options) => {
            bodies.push(JSON.parse(options.body));
            return Response.json({ choices: [{ message: { content: '{"pairs": [[3, 4]]}' } }] });
        };
        const ok = await POST(new Request("http://localhost/api/repetition-check", { method: "POST", body: JSON.stringify({ text: DRAFT }) }));
        const data = await ok.json();
        assert.deepEqual(data.pairs, [[3, 4]]);
        assert.match(data.detail, /4번째 문장/);
        assert.equal(bodies[0].model, "solar-mini-4-5-preview");
        assert.equal(bodies[0].reasoning_effort, "none");

        const short = await POST(new Request("http://localhost/api/repetition-check", { method: "POST", body: JSON.stringify({ text: "한 문장만 있음." }) }));
        assert.deepEqual((await short.json()).pairs, []);
        assert.equal(bodies.length, 1, "4문장 미만은 판정하지 않음");

        globalThis.fetch = async () => Response.json({ error: { message: "limit" } }, { status: 429 });
        const limited = await POST(new Request("http://localhost/api/repetition-check", { method: "POST", body: JSON.stringify({ text: DRAFT }) }));
        assert.equal(limited.status, 200);
        assert.equal((await limited.json()).detail, "");
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey === undefined) delete process.env.UPSTAGE_API_KEY; else process.env.UPSTAGE_API_KEY = originalKey;
    }
});

test("record pages pass the repetition judge into generation", () => {
    for (const route of ["gwasetuk", "club", "behavior"]) {
        const source = readFileSync(new URL(`../app/${route}/page.js`, import.meta.url), "utf8");
        assert.match(source, /checkRepetition: fetchRepetitionCheck,/, route);
    }
    const letter = readFileSync(new URL("../app/letter/page.js", import.meta.url), "utf8");
    assert.doesNotMatch(letter, /checkRepetition/);
});

test("record pages redact forbidden terms from inputs that bypass the shared prompt harness", () => {
    for (const route of ["gwasetuk", "club", "behavior"]) {
        const source = readFileSync(new URL(`../app/${route}/page.js`, import.meta.url), "utf8");
        assert.match(source, /const forbiddenTerms = \[[^\]]*student\.name\];/, route);
        assert.match(source, /const privateTerms = \[student\.name\];/, route);
        assert.match(source, /const generationInstructions = redactForbiddenTerms\(additionalInstructions, privateTerms\);/, route);
        assert.match(source, /forbiddenTerms,\s*privateTerms,/, route);
        assert.doesNotMatch(source, /prompt:\s*nextPrompt,\s*additionalInstructions\s*,/, route);
        assert.match(source, /sourceFacts: strictFactMode[\s\S]*?redactForbiddenTerms\(/, route);
    }
});
