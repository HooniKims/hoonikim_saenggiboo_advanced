import test from "node:test";
import assert from "node:assert/strict";

import {
    buildLetterVariationInstruction,
    buildLetterRuleTermInstruction,
    buildShuffledKeywordContext,
    getLetterBannedTerms,
    getLetterRequiredTerms,
    parseKeywordList,
    shuffleKeywordList,
} from "../utils/letterKeywords.js";

test("parseKeywordList trims comma-separated letter keywords", () => {
    assert.deepEqual(
        parseKeywordList("학업, 건강,, 친구관계, 가족관계 "),
        ["학업", "건강", "친구관계", "가족관계"],
    );
});

test("shuffleKeywordList can change letter keyword order without adding terms", () => {
    const keywords = ["학업", "건강", "친구관계", "가족관계"];
    const shuffled = shuffleKeywordList(keywords, () => 0);

    assert.deepEqual(shuffled, ["건강", "친구관계", "가족관계", "학업"]);
    assert.deepEqual([...shuffled].sort(), [...keywords].sort());
});

test("buildShuffledKeywordContext formats shuffled letter keywords", () => {
    assert.equal(
        buildShuffledKeywordContext("학업, 건강, 친구관계, 가족관계", () => 0),
        "방학 조언 영역: 건강, 친구관계, 가족관계, 학업",
    );
});

test("buildShuffledKeywordContext falls back to default letter keywords", () => {
    assert.equal(
        buildShuffledKeywordContext("", () => 0),
        "방학 조언 영역: 건강, 친구관계, 가족관계, 학업",
    );
});

test("getLetterRequiredTerms locks season and keyword settings", () => {
    assert.deepEqual(
        getLetterRequiredTerms({ season: "summer", keywords: "학업, 건강" }),
        ["여름방학"],
    );
    assert.deepEqual(
        getLetterRequiredTerms({ season: "winter", keywords: "친구관계, 가족관계" }),
        ["겨울방학", "새 학기"],
    );
});

test("getLetterBannedTerms blocks the opposite season", () => {
    assert.deepEqual(getLetterBannedTerms("summer"), ["겨울방학", "새 학기"]);
    assert.deepEqual(getLetterBannedTerms("winter"), ["여름방학"]);
});

test("buildLetterRuleTermInstruction makes saved settings explicit in the prompt", () => {
    assert.equal(
        buildLetterRuleTermInstruction({ season: "winter", keywords: "학업, 건강" }),
        "학기 구분 필수 용어: 겨울방학, 새 학기\n조언 영역 활용: 학업, 건강\n금지 용어: 여름방학\n조언 영역은 관찰 사실처럼 꾸며 쓰지 말고 방학 중 가정에서 살필 방향에 자연스럽게 반영할 것",
    );
});

test("buildLetterVariationInstruction changes the generation focus", () => {
    const first = buildLetterVariationInstruction(() => 0);
    const second = buildLetterVariationInstruction(() => 0.8);

    assert.notEqual(first, second);
    assert.match(first, /이번 생성 방향/);
    assert.match(first, /성실한 학교생활|방학 생활 조언/);
    assert.match(second, /같은 시작과 같은 가정 지도 문장을 반복하지 말 것/);
});
