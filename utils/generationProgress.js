const PROVIDER_LABELS = {
    local: "로컬 LLM(lm.alluser.site)",
    nvidia: "NVIDIA Cloud 모델",
    openai: "OpenAI API",
};

const DEFAULT_SLEEP_MS = 350;

function getProviderLabel(provider) {
    return PROVIDER_LABELS[provider] || "AI 모델";
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRepairProgressMessage(previousValidation, attempt, maxRepairAttempts) {
    const codes = new Set((previousValidation?.issues || []).map((issue) => issue.code));
    if (codes.has("under_min_bytes") || codes.has("under_min_chars")) {
        return `분량이 부족해서 내용을 더 채우는 중... ${attempt}/${maxRepairAttempts}`;
    }
    if (codes.has("over_target_bytes") || codes.has("over_target_chars")) {
        return `분량이 길어서 문장을 줄이는 중... ${attempt}/${maxRepairAttempts}`;
    }
    if (codes.has("incomplete_sentence")) {
        return `마지막 문장을 자연스럽게 마무리하는 중... ${attempt}/${maxRepairAttempts}`;
    }
    if (codes.has("forbidden_term") || codes.has("forbidden_subject") || codes.has("past_tense")) {
        return `표현 규칙에 맞게 고치는 중... ${attempt}/${maxRepairAttempts}`;
    }
    return `분량과 문장을 다듬는 중... ${attempt}/${maxRepairAttempts}`;
}

export async function runGenerationWithProgress({
    attempt = 0,
    maxRepairAttempts = 4,
    previousValidation = null,
    provider = "local",
    run,
    setProgress,
    sleep = wait,
    stepDelayMs = DEFAULT_SLEEP_MS,
}) {
    if (typeof run !== "function") {
        throw new Error("run 함수가 필요합니다.");
    }

    if (attempt > 0) {
        setProgress?.(getRepairProgressMessage(previousValidation, attempt, maxRepairAttempts));
        return run();
    }

    const label = getProviderLabel(provider);
    setProgress?.(`${label} 접속 중...`);
    await sleep(stepDelayMs);
    setProgress?.(`${label} 접속 완료, 생성 요청 중...`);
    await sleep(stepDelayMs);
    setProgress?.(`${label} 생성 중...`);
    return run();
}

export function getGenerationProvider({ isNvidiaSelected = false, hasOpenAIKey = false } = {}) {
    if (isNvidiaSelected) return "nvidia";
    if (hasOpenAIKey) return "openai";
    return "local";
}
