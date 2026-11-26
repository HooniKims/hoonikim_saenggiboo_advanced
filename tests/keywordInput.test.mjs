import test from "node:test";
import assert from "node:assert/strict";
import { getCharacterGuideline, getExpansionFrameworkGuideline } from "../utils/textProcessor.js";

test("keyword-only input is expanded into sentences in both writing modes", () => {
    for (const strictFacts of [false, true]) {
        const guideline = getExpansionFrameworkGuideline(strictFacts);
        assert.match(guideline, /짧은 키워드로만 되어 있으면 각 키워드를 학생이 실제로 한 활동이나 느낀 점으로 보고/);
        assert.match(guideline, /느낀 점 키워드\(재미, 뿌듯함, 어려움 등\)는 학생의 흥미, 태도, 깨달음으로 서술/);
    }
});

test("strict keyword expansion stays inside what the keywords point to", () => {
    const guideline = getExpansionFrameworkGuideline(true);
    assert.match(guideline, /키워드가 직접 가리키는 행동과 생각을 완전한 문장으로 풀어 씀/);
    assert.match(guideline, /키워드에 없는 새 활동, 도구, 결과, 수치는 덧붙이지 않음/);
    assert.doesNotMatch(getExpansionFrameworkGuideline(false), /키워드에 없는 새 활동, 도구, 결과, 수치/);
});

test("home letters do not treat advice keywords as student activities", () => {
    assert.doesNotMatch(getExpansionFrameworkGuideline(false, "letter"), /키워드를 학생이 실제로 한 활동/);
    assert.doesNotMatch(getCharacterGuideline(490, 1500, 1275, { mode: "letter" }), /키워드를 학생이 실제로 한 활동/);
    assert.match(getCharacterGuideline(490, 1500, 1275), /키워드를 학생이 실제로 한 활동/);
});
