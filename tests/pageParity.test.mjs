import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const readPage = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("gwasetuk page keeps search augmentation flow", () => {
    const source = readPage("app/gwasetuk/page.js");

    assert.match(source, /fetchSearchContext/);
    assert.match(source, /useWebSearchContext/);
    assert.match(source, /학생 개별 활동 내용 웹 검색 보강/);
    assert.match(source, /웹 검색 보강 중/);
    assert.match(source, /searchContextText/);
});

test("club page keeps search augmentation flow", () => {
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

test("letter prompt and system message ban direct 해보세요-style advice", () => {
    const source = readPage("app/letter/page.js");
    const streamSource = readPage("utils/streamFetch.js");

    assert.match(source, /해보세요/);
    assert.match(source, /보세요/);
    assert.match(source, /하세요/);
    assert.match(source, /바랍니다/);
    assert.match(streamSource, /해보세요/);
    assert.match(streamSource, /보세요/);
    assert.match(streamSource, /바랍니다/);
    assert.doesNotMatch(source, /가져 보시기 바랍니다/);
});

test("all generation pages require Upstage to repair short output before length-only fallback", () => {
    for (const relativePath of [
        "app/gwasetuk/page.js",
        "app/club/page.js",
        "app/behavior/page.js",
        "app/letter/page.js",
    ]) {
        const source = readPage(relativePath);
        assert.match(source, /generateWithSilentValidation\(\{[\s\S]*?acceptLengthOnlyResult:\s*!isUpstageSelected/);
        assert.match(source, /preserveTextOnLengthRepair:\s*isUpstageSelected/);
        assert.match(source, /stripExpandedGradeLabels:\s*isUpstageSelected/);
        if (relativePath === "app/gwasetuk/page.js") {
            assert.match(source, /requiredContentGroups:\s*solarRequiredContentGroups/);
            assert.match(source, /SOLAR_GRADE_EVIDENCE/);
        }
    }
});

test("record generation pages give Solar extra repair attempts without changing other models", () => {
    for (const relativePath of [
        "app/gwasetuk/page.js",
        "app/club/page.js",
        "app/behavior/page.js",
    ]) {
        const source = readPage(relativePath);
        assert.match(source, /generateWithSilentValidation\(\{[\s\S]*?maxRepairAttempts:\s*isUpstageSelected\s*\?\s*4\s*:\s*2/);
    }
});

test("all generation pages route Solar Pro 2 through the Upstage API", () => {
    for (const relativePath of [
        "app/gwasetuk/page.js",
        "app/club/page.js",
        "app/behavior/page.js",
        "app/letter/page.js",
    ]) {
        const source = readPage(relativePath);
        assert.match(source, /isUpstageSelected/);
        assert.match(source, /fetchUpstageCompletion/);
        assert.match(source, /usesUpstageModel=\{isUpstageSelected\}/);
        assert.match(source, /provider:\s*getGenerationProvider\(\{[\s\S]*?isUpstageSelected/);
        assert.match(source, /isUpstageSelected[\s\S]*?fetchUpstageCompletion/);
        assert.match(source, /<label className="form-label">AI 모델<\/label>/);
    }
});

test("all generation pages automatically fall back from local models to Solar", () => {
    for (const relativePath of [
        "app/gwasetuk/page.js",
        "app/club/page.js",
        "app/behavior/page.js",
        "app/letter/page.js",
    ]) {
        const source = readPage(relativePath);
        assert.match(source, /import \{ generateWithLocalSolarFallback \} from "\.\.\/\.\.\/utils\/localSolarFallback"/);
        assert.match(source, /const isLocalFallbackEligible = !isNvidiaSelected && !isUpstageSelected && !appliedOpenAIKey;/);
        assert.match(source, /generateWithLocalSolarFallback\(\{/);
        assert.match(source, /solarGenerateOnce:[\s\S]*?fetchUpstageCompletion/);
    }
});

test("subject and club local fallback validates every selected activity", () => {
    for (const relativePath of ["app/gwasetuk/page.js", "app/club/page.js"]) {
        const source = readPage(relativePath);
        assert.match(source, /const solarRequiredContentGroups = isUpstageSelected \|\| isLocalFallbackEligible/);
        assert.match(source, /selectedActivityEntries\.map\(\(entry, index\) => \(\{/);
        assert.match(source, /requiredContentGroups:\s*solarRequiredContentGroups/);
    }
});

test("all generation pages show provider-neutral generation status copy", () => {
    for (const relativePath of [
        "app/gwasetuk/page.js",
        "app/club/page.js",
        "app/behavior/page.js",
        "app/letter/page.js",
    ]) {
        const source = readPage(relativePath);
        assert.match(source, /const generationStatusText = "AI로 생성 중\.\.\.";/);
        assert.doesNotMatch(source, /(?:NVIDIA|Upstage|OpenAI).*생성 중\.\.\./);
        assert.doesNotMatch(source, /취소해도.*비용.*청구/);
    }
});

test("model guidance recommends Solar when the default local model is slow or errors", () => {
    const source = readPage("components/OpenAIKeyControl.js");

    assert.match(source, /생성이 느리거나 오류가 나는 경우에는 Solar 모델을 선택하고 생성해보세요!/);
});

test("gwasetuk gives Solar an activity-first equal-allocation plan", () => {
    const source = readPage("app/gwasetuk/page.js");

    assert.match(source, /<Solar 다중 활동 작성 순서>/);
    assert.match(source, /활동1부터 활동\$\{totalActivities\}까지 각각 최소 한 문장씩/);
    assert.match(source, /\$\{activityAllocation\} 기준으로 균등하게 배분/);
    assert.match(source, /모든 활동을 반영한 뒤에만 남은 분량/);
});

test("gwasetuk asks Solar to repair missing content and uses a byte-realistic character ceiling", () => {
    const source = readPage("app/gwasetuk/page.js");

    assert.match(source, /requiredContentGroups:\s*solarRequiredContentGroups/);
    assert.match(source, /fetchUpstageCompletion\(\{ prompt: nextPrompt/);
    assert.match(source, /Math\.ceil\(targetBytes \/ 2\.7\)/);
});

test("gwasetuk sends every Solar repair attempt back to Upstage", () => {
    // Given
    const source = readPage("app/gwasetuk/page.js");

    // When
    const generationFlow = source.match(/generateWithSilentValidation\(\{[\s\S]*?\n\s*\}\);/)?.[0] || "";

    // Then
    assert.match(generationFlow, /isUpstageSelected[\s\S]*?fetchUpstageCompletion\(\{ prompt: nextPrompt/);
    assert.doesNotMatch(generationFlow, /Promise\.resolve\((?:restoreMissingSolarActivities|expandSolarPreviousText)/);
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
