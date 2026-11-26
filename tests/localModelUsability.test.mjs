import test from "node:test";
import assert from "node:assert/strict";
import { findRepeatedContent, validateGeneratedText } from "../utils/generationHarness.js";
import { getMaxTokensForLocalModel, getStandardSystemMessage } from "../utils/streamFetch.js";

test("the exported heuristic reports a repeated phrase without blocking a record", () => {
    const text = "열의 이동 실험에서 타이머로 온도 변화를 기록함. 모둠에서 기록 담당을 맡아 측정 시점을 놓치지 않음. 이어서 열의 이동 실험에서 타이머로 온도 변화를 다시 확인함.";
    assert.match(findRepeatedContent(text), /열의 이동 실험에서 타이머로 온도/);
    const validation = validateGeneratedText(text, { targetChars: 300, mode: "record" });
    assert.equal(validation.ok, true);
});

test("repetition check flags nearly identical sentences", () => {
    const text = "측정값을 선그래프로 나타내고 두 물질의 변화 양상을 비교함. 온도계를 읽는 순서를 정해 기록 오류를 줄임. 측정값을 선그래프로 나타내어 두 물질의 변화 양상을 비교함.";
    assert.notEqual(findRepeatedContent(text), "");
});

test("repetition check passes a varied record and ignores letters", () => {
    const varied = "열의 이동 실험에서 타이머로 온도 변화를 기록함. 모둠에서 기록 담당을 맡아 측정 시점을 놓치지 않음. 측정값을 선그래프로 나타내고 두 물질의 차이를 살핌.";
    assert.equal(findRepeatedContent(varied), "");
    const letter = "방학 동안 생활 리듬을 지켜 주시기 바랍니다. 방학 동안 생활 리듬을 지켜 주시기 바랍니다.";
    assert.equal(validateGeneratedText(letter, { targetChars: 300, mode: "letter" }).issues.some(({ code }) => code === "repetition"), false);
});

test("standard system message allows filling scenes by default and forbids it in strict mode", () => {
    assert.match(getStandardSystemMessage(), /핵심어와 성취 수준 범위에서 수행 장면을 보완/);
    assert.doesNotMatch(getStandardSystemMessage(), /입력된 활동 외에 사실을 지어내지 않음/);
    assert.match(getStandardSystemMessage(true), /입력된 활동 외에 사실을 지어내지 않음/);
});

test("12B local models get enough tokens for a 1500byte record", () => {
    assert.equal(getMaxTokensForLocalModel("lmstudio:gemma-4-12b-it", 589), 1536);
    assert.ok(getMaxTokensForLocalModel("lmstudio:gemma-4-12b-it", 589) >= getMaxTokensForLocalModel("lmstudio:gemma-4-12b-it", 393));
});
