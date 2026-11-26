import { generateWithSilentValidation } from "./generationHarness.js";

export async function generateWithLocalSolarFallback({
    prompt,
    localGenerateOnce,
    solarGenerateOnce,
    validationOptions,
}) {
    let localResult = null;
    try {
        // 기본(분량 채우기)에서는 로컬 모델이 짧게 쓰면 부족한 분량만 이어 쓰게 해 두 번 더 기회를 준 뒤
        // 그래도 기준에 못 미칠 때만 Solar로 넘긴다.
        const fillLocalLength = validationOptions?.mode === "record" && !validationOptions?.strictFacts;
        localResult = await generateWithSilentValidation({
            ...validationOptions,
            prompt,
            generateOnce: localGenerateOnce,
            acceptLengthOnlyResult: false,
            preferBestCandidateOnFailure: true,
            preserveTextOnLengthRepair: fillLocalLength,
            maxRepairAttempts: fillLocalLength ? 2 : 1,
        });
    } catch {}

    const localIssueCodes = localResult
        ? localResult.validation.issues.map((issue) => issue.code)
        : ["local_error"];

    if (localResult?.validation.ok) {
        return {
            ...localResult,
            provider: "local",
            usedSolarFallback: false,
        };
    }

    let solarResult = null;
    try {
        solarResult = await generateWithSilentValidation({
            ...validationOptions,
            prompt,
            generateOnce: solarGenerateOnce,
            acceptLengthOnlyResult: false,
            preferBestCandidateOnFailure: true,
            preserveTextOnLengthRepair: true,
            stripExpandedGradeLabels: true,
            maxRepairAttempts: 1,
        });
    } catch (solarError) {
        if (localResult?.text) {
            return {
                ...localResult,
                provider: "local",
                usedSolarFallback: true,
                fallbackFailed: true,
                localIssueCodes,
            };
        }
        throw solarError;
    }

    return {
        ...solarResult,
        provider: "upstage",
        usedSolarFallback: true,
        fallbackFailed: false,
        localIssueCodes,
    };
}

const LENGTH_ISSUE_CODES = new Set(["under_min_bytes", "under_min_chars"]);

// 로컬 모델 결과 대신 Solar Pro 4 결과가 들어갔는지 교사가 화면에서 알 수 있게 안내 문구를 만든다.
export function getSolarFallbackNotice(result) {
    if (!result?.usedSolarFallback) return "";
    const codes = result.localIssueCodes || [];
    const reason = codes.includes("local_error")
        ? "선택한 로컬 모델이 응답하지 않아"
        : codes.length > 0 && codes.every((code) => LENGTH_ISSUE_CODES.has(code))
            ? "선택한 로컬 모델 결과가 권장 분량보다 짧아"
            : "선택한 로컬 모델 결과가 작성 규칙에 맞지 않아";
    if (result.fallbackFailed) {
        return `${reason} Solar Pro 4로 다시 쓰려 했지만 실패해, 로컬 모델 결과를 그대로 보여 줍니다. 분량과 내용을 확인해 주세요.`;
    }
    return `${reason} Solar Pro 4가 대신 작성했습니다.`;
}
