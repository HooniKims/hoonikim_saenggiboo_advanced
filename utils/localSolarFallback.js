import { generateWithSilentValidation } from "./generationHarness.js";

export async function generateWithLocalSolarFallback({
    prompt,
    localGenerateOnce,
    solarGenerateOnce,
    validationOptions,
}) {
    let localResult = null;
    try {
        localResult = await generateWithSilentValidation({
            ...validationOptions,
            prompt,
            generateOnce: localGenerateOnce,
            acceptLengthOnlyResult: false,
            preferBestCandidateOnFailure: true,
            maxRepairAttempts: 1,
        });
    } catch {}

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
            };
        }
        throw solarError;
    }

    return {
        ...solarResult,
        provider: "upstage",
        usedSolarFallback: true,
        fallbackFailed: false,
    };
}
