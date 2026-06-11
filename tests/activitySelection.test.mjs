import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
    limitActivitiesByTargetChars,
    shouldSelectRandomFourActivities,
} from "../utils/activitySelection.js";

test("detects additional instruction to randomly select four activities", () => {
    assert.equal(
        shouldSelectRandomFourActivities("활동 내용 중 4개를 랜덤으로 선택한다."),
        true,
    );
    assert.equal(
        shouldSelectRandomFourActivities("활동내용에서 4개를 무작위로 골라 작성"),
        true,
    );
});

test("does not treat ordinary additional instructions as random-four selection", () => {
    assert.equal(shouldSelectRandomFourActivities("토론 활동은 입장을 중심으로 작성"), false);
    assert.equal(shouldSelectRandomFourActivities("4문장으로 작성"), false);
    assert.equal(shouldSelectRandomFourActivities("활동 내용을 모두 반영"), false);
});

test("limits selected activities by target character budget", () => {
    const activities = ["a", "b", "c", "d", "e"];

    assert.deepEqual(limitActivitiesByTargetChars(activities, 79), ["a"]);
    assert.deepEqual(limitActivitiesByTargetChars(activities, 150), ["a", "b"]);
    assert.deepEqual(limitActivitiesByTargetChars(activities, 250), ["a", "b", "c"]);
    assert.deepEqual(limitActivitiesByTargetChars(activities, 350), ["a", "b", "c", "d"]);
    assert.deepEqual(limitActivitiesByTargetChars(activities, 351), activities);
});

test("pages apply random-four instruction before generation prompt is built", () => {
    const gwasetukSource = readFileSync(new URL("../app/gwasetuk/page.js", import.meta.url), "utf8");
    const clubSource = readFileSync(new URL("../app/club/page.js", import.meta.url), "utf8");

    assert.match(gwasetukSource, /shouldSelectRandomFourActivities\(additionalInstructions\)/);
    assert.match(gwasetukSource, /forceRandomFourActivities[\s\S]*selectedActivityEntries\.slice\(0, Math\.min\(4/);
    assert.match(clubSource, /shouldSelectRandomFourActivities\(additionalInstructions\)/);
    assert.match(clubSource, /forceRandomFourActivities[\s\S]*shuffleArray\(validActivities\)\.slice\(0, Math\.min\(4/);
});

test("pages tell the model to start with selected activity one before individual context", () => {
    const gwasetukSource = readFileSync(new URL("../app/gwasetuk/page.js", import.meta.url), "utf8");
    const clubSource = readFileSync(new URL("../app/club/page.js", import.meta.url), "utf8");

    assert.match(gwasetukSource, /첫 문장은 반드시 위 \[활동 내용\]의 활동1 공통 활동으로 시작/);
    assert.match(gwasetukSource, /개별 활동 내용\]이나 검색 보강 자료를 첫 활동처럼 앞세우지 않음/);
    assert.match(clubSource, /첫 문장은 반드시 위 \[활동 내용\]의 활동1 공통 활동으로 시작/);
    assert.match(clubSource, /개별 활동 내용을 첫 문장이나 첫 활동처럼 우선 배치하지 않음/);
});

test("subject and club prompts require individual activity details to be reflected", () => {
    const gwasetukSource = readFileSync(new URL("../app/gwasetuk/page.js", import.meta.url), "utf8");
    const clubSource = readFileSync(new URL("../app/club/page.js", import.meta.url), "utf8");

    assert.match(gwasetukSource, /개별 활동 내용은 반드시 최종 본문에 반영/);
    assert.match(gwasetukSource, /개별 활동의 핵심어와 구체적 수행 내용을 누락하지 않음/);
    assert.match(clubSource, /개별 활동 내용은 반드시 최종 본문에 반영/);
    assert.match(clubSource, /개별 활동의 핵심어와 구체적 수행 내용을 누락하지 않음/);
});

test("club prompt avoids fixed report-writing openings and asks for varied starts", () => {
    const clubSource = readFileSync(new URL("../app/club/page.js", import.meta.url), "utf8");

    assert.match(clubSource, /openingStyleGuides/);
    assert.match(clubSource, /selectedOpeningStyle/);
    assert.match(clubSource, /Math\.floor\(Math\.random\(\) \* openingStyleGuides\.length\)/);
    assert.match(clubSource, /활동1의 핵심 소재는 유지하되 활동명을 그대로 베껴 시작하지 않음/);
    assert.match(clubSource, /첫 문장 시작 방식/);
    assert.match(clubSource, /예시 표현을 그대로 복사하지 말고/);
    assert.match(clubSource, /보고서 작성을 통해/);
    assert.match(clubSource, /탐구하는 과정에서/);
    assert.match(clubSource, /고민을 가지고/);
    assert.match(clubSource, /과학 실험 보고서 작성에서/);
});
