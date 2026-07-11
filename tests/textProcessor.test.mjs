import test from "node:test";
import assert from "node:assert/strict";

import {
    cleanMetaInfo,
    getCharacterGuideline,
    getMinimumTargetChars,
    getMinimumTargetBytes,
    getMaxTokensForTargetChars,
    getPromptCharLimit,
    getUtf8ByteLength,
    normalizeTargetBytes,
    normalizeTargetChars,
    truncateToCompleteSentence,
} from "../utils/textProcessor.js";

test("cleanMetaInfo removes trailing model compliance notes", () => {
    const recordText = "토론 활동에서 근거를 정리하고 발표함. ※ 주의: 시스템 오류로 재작성 요청 필요 ※.";
    const letterText = "여름방학 동안 가족 대화 시간을 마련해 주시기 바랍니다. (※ 주의: 지침 충돌로 포함되었습니다.";
    const byteText = "친구의 의견을 경청하고 핵심을 정리함. (1499byte)";

    assert.equal(cleanMetaInfo(recordText), "토론 활동에서 근거를 정리하고 발표함.");
    assert.equal(cleanMetaInfo(letterText), "여름방학 동안 가족 대화 시간을 마련해 주시기 바랍니다.");
    assert.equal(cleanMetaInfo(byteText), "친구의 의견을 경청하고 핵심을 정리함.");
});

test("cleanMetaInfo removes trailing procedural narration", () => {
    const text = "토론 활동에서 근거를 정리하고 발표함. 전체 서술은 1275~1500byte 범위로 작성함. 마지막 문장을 마침표로 종료함.";
    const bracketed = "토론 활동에서 근거를 정리하고 발표함. [시스템 오류] 필수 표현이 누락되어 재작성 요청합니다.";
    const byteRatio = "토론 활동에서 근거를 정리하고 발표함. (Byte: 448 / 1000)";

    assert.equal(cleanMetaInfo(text), "토론 활동에서 근거를 정리하고 발표함.");
    assert.equal(cleanMetaInfo(bracketed), "토론 활동에서 근거를 정리하고 발표함.");
    assert.equal(cleanMetaInfo(byteRatio), "토론 활동에서 근거를 정리하고 발표함.");
});

test("normalizeTargetChars maps presets and clamps manual values", () => {
    assert.equal(normalizeTargetChars("1500"), 589);
    assert.equal(normalizeTargetChars("1000"), 393);
    assert.equal(normalizeTargetChars("600"), 236);
    assert.equal(normalizeTargetChars("manual", "800"), 314);
    assert.equal(normalizeTargetChars("manual", "9999"), 589);
    assert.equal(normalizeTargetChars("manual", "-10"), 1);
    assert.equal(normalizeTargetChars("manual", ""), 589);
});

test("normalizeTargetBytes maps presets and clamps manual byte values", () => {
    assert.equal(normalizeTargetBytes("1500"), 1500);
    assert.equal(normalizeTargetBytes("1000"), 1000);
    assert.equal(normalizeTargetBytes("600"), 600);
    assert.equal(normalizeTargetBytes("manual", "800"), 800);
    assert.equal(normalizeTargetBytes("manual", "9999"), 1500);
    assert.equal(normalizeTargetBytes("manual", ""), 1500);
});

test("truncateToCompleteSentence never exceeds the requested character limit", () => {
    const longText = "토론 활동에서 근거 자료를 수집하고 의견을 논리적으로 정리하여 발표함. 발표 이후 친구들의 질문을 듣고 답변함.";
    const result = truncateToCompleteSentence(longText, 40);

    assert.ok(result.length <= 40, `${result.length}자: ${result}`);
});

test("getMaxTokensForTargetChars leaves enough room to finish Korean sentences", () => {
    assert.equal(getMaxTokensForTargetChars(100), 512);
    assert.equal(getMaxTokensForTargetChars(200), 680);
    assert.equal(getMaxTokensForTargetChars(normalizeTargetChars("manual", "250")), 512);
    assert.equal(getMaxTokensForTargetChars(393), 1337);
    assert.equal(getMaxTokensForTargetChars(589), 2003);
});

test("getMinimumTargetChars enforces at least 85 percent of the selected limit", () => {
    assert.equal(getMinimumTargetChars(100), 85);
    assert.equal(getMinimumTargetChars(200), 170);
    assert.equal(getMinimumTargetChars(393), 334);
    assert.equal(getMinimumTargetChars(589), 500);
});

test("getMinimumTargetBytes enforces at least 85 percent of the selected byte limit", () => {
    assert.equal(getMinimumTargetBytes(600), 510);
    assert.equal(getMinimumTargetBytes(1000), 850);
    assert.equal(getMinimumTargetBytes(1500), 1275);
});

test("getPromptCharLimit asks the model for at least 85 percent on every limit", () => {
    assert.equal(getPromptCharLimit(100), 85);
    assert.equal(getPromptCharLimit(200), 170);
    assert.equal(getPromptCharLimit(250), 212);
    assert.equal(getPromptCharLimit(393), 334);
    assert.equal(getPromptCharLimit(589), 500);
});

test("getCharacterGuideline uses a dynamic visible-length band without framework labels", () => {
    const guideline1500 = getCharacterGuideline(589, 1500, 1275);
    const guideline1000 = getCharacterGuideline(393, 1000, 850);
    const guideline600 = getCharacterGuideline(236, 600, 510);

    assert.match(guideline1500, /648-678 Korean visible characters/);
    assert.match(guideline1000, /433-452 Korean visible characters/);
    assert.match(guideline600, /260-272 Korean visible characters/);
    assert.match(guideline1500, /동기/);
    assert.match(guideline1500, /수행 과정/);
    assert.match(guideline1500, /관찰 가능한 결과/);
    assert.match(guideline1500, /성장 단서/);
    assert.match(guideline1500, /입력된 활동/);
    assert.match(guideline1500, /새 활동.*지어내지/);
    assert.doesNotMatch(guideline1500, /Why-How-What-Learn/);
});

test("getUtf8ByteLength counts Korean text by UTF-8 bytes", () => {
    assert.equal(getUtf8ByteLength("abc"), 3);
    assert.equal(getUtf8ByteLength("가"), 3);
    assert.equal(getUtf8ByteLength("가a "), 5);
});
