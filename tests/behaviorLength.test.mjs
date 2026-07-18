import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getBehaviorLengthTargets } from "../utils/behaviorLength.js";

test("행발 분량은 기본값과 직접 입력 모두 900byte를 넘지 않는다", () => {
    // Given / When
    const defaultTargets = getBehaviorLengthTargets("900");
    const manualTargets = getBehaviorLengthTargets("manual", "1200");

    // Then
    assert.deepEqual(defaultTargets, { targetBytes: 900, targetChars: 353, minTargetBytes: 765 });
    assert.deepEqual(manualTargets, defaultTargets);
});

test("행발 화면은 900byte를 기본 선택지로 표시하고 전용 제한값을 사용한다", () => {
    // Given
    const source = readFileSync(new URL("../app/behavior/page.js", import.meta.url), "utf8");

    // When / Then
    assert.match(source, /useState\("900"\)/);
    assert.match(source, /<option value="900">900byte/);
    assert.match(source, /getBehaviorLengthTargets\(textLength, manualLength\)/);
    assert.match(source, /max="900"/);
});
