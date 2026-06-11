import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const readPage = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("club page keeps 과세특 search augmentation flow", () => {
    const source = readPage("app/club/page.js");

    assert.match(source, /fetchSearchContext/);
    assert.match(source, /useWebSearchContext/);
    assert.match(source, /학생 개별 활동 내용 웹 검색 보강/);
    assert.match(source, /웹 검색 보강 중/);
    assert.match(source, /searchContextText/);
});

test("behavior page keeps 과세특 instruction and search augmentation flow", () => {
    const source = readPage("app/behavior/page.js");

    assert.match(source, /additionalInstructions/);
    assert.match(source, /fetchSearchContext/);
    assert.match(source, /useWebSearchContext/);
    assert.match(source, /행동 관찰 내용 웹 검색 보강/);
    assert.match(source, /웹 검색 보강 중/);
    assert.match(source, /searchContextText/);
});

test("letter page keeps home-letter search augmentation flow", () => {
    const source = readPage("app/letter/page.js");

    assert.match(source, /fetchSearchContext/);
    assert.match(source, /useWebSearchContext/);
    assert.match(source, /가정통신문 키워드 웹 검색 보강/);
    assert.match(source, /웹 검색 보강 중/);
    assert.match(source, /searchContextText/);
});

test("club prompt applies advanced content-quality guidance only for high school", () => {
    const source = readPage("app/club/page.js");

    assert.match(source, /getClubHighSchoolQualityGuidance/);
    assert.match(source, /getClubHighSchoolQualityGuidance\(schoolLevel\)/);
    assert.match(source, /highSchoolQualityText/);
});

test("behavior prompt applies advanced content-quality guidance only for high school", () => {
    const source = readPage("app/behavior/page.js");

    assert.match(source, /schoolLevel/);
    assert.match(source, /getBehaviorHighSchoolQualityGuidance/);
    assert.match(source, /getBehaviorHighSchoolQualityGuidance\(schoolLevel\)/);
    assert.match(source, /highSchoolQualityText/);
});
