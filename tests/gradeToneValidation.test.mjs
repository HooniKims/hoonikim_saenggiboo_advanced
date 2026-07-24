import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildRepairPrompt, validateGeneratedText } from "../utils/generationHarness.js";

const pageSource = readFileSync(new URL("../app/gwasetuk/page.js", import.meta.url), "utf8");

function extractGradeEvidence() {
    const start = pageSource.indexOf("const SOLAR_GRADE_EVIDENCE = {");
    const end = pageSource.indexOf("};", start);
    const factory = new Function(`${pageSource.slice(start, end + 2)}\nreturn SOLAR_GRADE_EVIDENCE;`);
    return factory();
}

const SOLAR_GRADE_EVIDENCE = extractGradeEvidence();

const ACTIVITY1 = "소설 소나기(황순원)를 읽고 인물의 심리 변화를 분석하여 모둠 토의에서 의견을 나눔";
const ACTIVITY2 = "주장하는 글쓰기 활동에서 매체 자료를 근거로 논설문을 작성하고 고쳐쓰기를 함";

const toneRules = (grade1, grade2) => [
    { label: "활동1", grade: grade1, anchors: ["소설 소나기", "소나기(황순원)를 읽고"], evidence: SOLAR_GRADE_EVIDENCE[grade1] },
    { label: "활동2", grade: grade2, anchors: ["주장하는 글쓰기", "논설문을 작성"], evidence: SOLAR_GRADE_EVIDENCE[grade2] },
];

const GOOD_MIX_CE = "소설 소나기(황순원)를 읽고 인물의 심리 변화를 분석하여 모둠 토의에서 의견을 나눔. "
    + "인물의 복합적인 심리 상태를 해석하는 부분에서 기초 이해를 더 보완할 필요가 있으며 표현의 구체성을 높이기 위한 연습이 요구됨. "
    + "주장하는 글쓰기 활동에서 매체 자료를 근거로 논설문을 작성하고 고쳐쓰기를 함. "
    + "글의 구조를 잡는 과정에서 기본 요건을 충족하는 데 어려움이 크며 지속적인 개별 지도와 기초 학습 지원이 필요한 지점이 뚜렷함.";

test("grade tone evidence terms do not nest across grades", () => {
    const grades = Object.keys(SOLAR_GRADE_EVIDENCE);
    for (const left of grades) {
        for (const right of grades) {
            if (left === right) continue;
            for (const leftTerm of SOLAR_GRADE_EVIDENCE[left]) {
                for (const rightTerm of SOLAR_GRADE_EVIDENCE[right]) {
                    assert.ok(
                        !leftTerm.includes(rightTerm) && !rightTerm.includes(leftTerm),
                        `증거어 중첩: ${left}:"${leftTerm}" ↔ ${right}:"${rightTerm}"`,
                    );
                }
            }
        }
    }
});

test("grade tone validation passes a correct C/E mixed record", () => {
    const validation = validateGeneratedText(GOOD_MIX_CE, {
        mode: "record",
        targetChars: 650,
        activityToneRules: toneRules("C", "E"),
    });
    assert.deepEqual(validation.issues.filter((issue) => issue.code === "grade_tone_mismatch"), []);
});

test("grade tone validation flags an E activity written as praise (e4b regression)", () => {
    const praiseE = "소설 소나기(황순원)를 읽고 인물의 심리 변화를 깊이 있게 분석하며 모둠 토의에 참여함. "
        + "논지를 전개하며 높은 수준의 이해도를 드러내고 근거를 확보하려는 노력이 돋보임.";
    const validation = validateGeneratedText(praiseE, {
        mode: "record",
        targetChars: 650,
        activityToneRules: [
            { label: "활동1", grade: "E", anchors: ["소설 소나기"], evidence: SOLAR_GRADE_EVIDENCE.E },
        ],
    });
    const details = validation.issues.filter((issue) => issue.code === "grade_tone_mismatch").map((issue) => issue.detail);
    assert.ok(details.some((detail) => detail.includes("E 수준 표현 누락")), `누락 검출 실패: ${details}`);
    assert.ok(details.some((detail) => detail.includes("최상위 칭찬")), `칭찬 검출 실패: ${details}`);
});

test("grade tone validation flags E-level phrasing inside a C activity", () => {
    const harshC = "소설 소나기(황순원)를 읽고 인물의 심리 변화를 분석하여 모둠 토의에서 의견을 나눔. "
        + "참여 과정과 결과 완성 모두에서 매우 많은 보완이 요구되며 지속적인 개별 지도가 필요함. "
        + "주장하는 글쓰기 활동에서 매체 자료를 근거로 논설문을 작성하고 고쳐쓰기를 함. "
        + "글의 구조를 잡는 과정에서 기본 요건을 충족하는 데 어려움이 큼.";
    const validation = validateGeneratedText(harshC, {
        mode: "record",
        targetChars: 650,
        activityToneRules: toneRules("C", "E"),
    });
    const details = validation.issues.filter((issue) => issue.code === "grade_tone_mismatch").map((issue) => issue.detail);
    assert.ok(details.some((detail) => detail.startsWith("활동1(C)") && detail.includes("E 수준 보완")), `C 구간 E 표현 검출 실패: ${details}`);
});

test("grade tone validation follows activity order in the text (E first)", () => {
    const goodMixEC = "소설 소나기(황순원)를 읽고 인물의 심리 변화를 분석하여 모둠 토의에서 의견을 나눔. "
        + "감정의 흐름을 파악하는 과정에서 기본 요건을 충족하는 데 어려움이 크며 지속적인 개별 지도와 기초 학습 지원이 필요한 지점이 뚜렷함. "
        + "주장하는 글쓰기 활동에서 매체 자료를 근거로 논설문을 작성하고 고쳐쓰기를 함. "
        + "핵심 정보를 문장으로 연결하는 표현의 구체성을 높일 여지가 있어 단계적인 연습이 요구됨.";
    const validation = validateGeneratedText(goodMixEC, {
        mode: "record",
        targetChars: 650,
        activityToneRules: toneRules("E", "C"),
    });
    assert.deepEqual(validation.issues.filter((issue) => issue.code === "grade_tone_mismatch"), []);
});

test("grade tone rules skip activities whose anchors are missing", () => {
    const onlyFirst = "소설 소나기(황순원)를 읽고 인물의 심리 변화를 분석함. 표현의 구체성을 높일 여지가 있어 연습이 요구됨.";
    const validation = validateGeneratedText(onlyFirst, {
        mode: "record",
        targetChars: 650,
        activityToneRules: toneRules("C", "E"),
    });
    const details = validation.issues.filter((issue) => issue.code === "grade_tone_mismatch");
    assert.deepEqual(details, []);
});

test("buildRepairPrompt spells out per-activity tone rules", () => {
    const prompt = buildRepairPrompt({
        text: "본문",
        issues: [{ code: "grade_tone_mismatch", message: "활동별 성취 수준 표현 불일치", detail: "활동1(C): E 수준 보완 표현 '매우 많은 보완' 사용 금지" }],
        targetChars: 650,
        mode: "record",
        activityToneRules: toneRules("C", "E"),
    });
    assert.match(prompt, /활동1\(C\)/);
    assert.match(prompt, /활동2\(E\)/);
    assert.match(prompt, /해당 활동을 다루는 문장 안/);
    assert.match(prompt, /기본 요건을 충족하는 데 어려움/);
});

test("gwasetuk prompt includes per-activity mandatory and forbidden tone phrases", () => {
    assert.match(pageSource, /활동별 필수\/금지 표현 - 반드시 준수/);
    assert.match(pageSource, /GRADE_TONE_AVOID/);
    assert.match(pageSource, /const activityToneRules = selectedActivityEntries\.map/);
    assert.match(pageSource, /activityToneRules,\s*\n\s*\};/);
});

test("grade tone validation flags harsh deficit phrasing inside a C activity", () => {
    const harshDeficitC = "소설 소나기(황순원)를 읽고 인물의 심리 변화를 분석하여 모둠 토의에서 의견을 나눔. "
        + "일부 기준점에 도달하지 못한 부분이 있어 연습이 요구됨.";
    const validation = validateGeneratedText(harshDeficitC, {
        mode: "record",
        targetChars: 650,
        activityToneRules: [
            { label: "활동1", grade: "C", anchors: ["소설 소나기"], evidence: SOLAR_GRADE_EVIDENCE.C },
        ],
    });
    const details = validation.issues.filter((issue) => issue.code === "grade_tone_mismatch").map((issue) => issue.detail);
    assert.ok(details.some((detail) => detail.includes("직접 결핍 서술")), `결핍 서술 검출 실패: ${details}`);
});

test("prompt and repair prompt forbid copy-pasting the same required phrase frame across activities", () => {
    assert.match(pageSource, /같은 문장 틀을 활동마다 그대로 복사하듯 반복하지 않음/);
    const prompt = buildRepairPrompt({
        text: "본문",
        issues: [],
        targetChars: 650,
        mode: "record",
        activityToneRules: toneRules("C", "E"),
    });
    assert.match(prompt, /필수 표현은 활동마다 같은 문장 틀로 반복하지 말고/);
});
