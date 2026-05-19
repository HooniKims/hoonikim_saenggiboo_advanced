export const OPENAI_MODELS = [
    { id: "gpt-5-mini", name: "GPT-5 mini" },
    { id: "gpt-5.4-mini", name: "GPT-5.4 mini" },
];
export const DEFAULT_OPENAI_MODEL = OPENAI_MODELS[0].id;

export function getOpenAIModelLabel(modelId) {
    return OPENAI_MODELS.find((model) => model.id === modelId)?.name || modelId;
}

export async function fetchOpenAICompletion({ prompt, additionalInstructions, apiKey, targetChars, model, outputType = "record" }) {
    if (!apiKey?.trim()) {
        throw new Error("OpenAI API key가 적용되지 않았습니다.");
    }

    const response = await fetch("/api/openai-generate", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            prompt,
            additionalInstructions,
            apiKey: apiKey.trim(),
            targetChars,
            model: model || DEFAULT_OPENAI_MODEL,
            outputType,
        }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.error || `OpenAI API 오류 (${response.status})`);
    }

    return data.result || "";
}
