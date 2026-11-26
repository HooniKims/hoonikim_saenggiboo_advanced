import { isUpstageModel } from "./streamFetch.js";

export async function fetchUpstageCompletion({ prompt, additionalInstructions, targetChars, model, outputType = "record", sourceFacts, strictFacts, keepTerms }) {
    const selectedModel = isUpstageModel(model)
        ? String(model).replace(/^upstage:/, "")
        : "solar-pro4";
    const response = await fetch("/api/upstage-generate", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            prompt,
            additionalInstructions,
            targetChars,
            model: selectedModel,
            outputType,
            sourceFacts,
            strictFacts,
            keepTerms,
        }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.error || `Upstage API 오류 (${response.status})`);
    }

    return data.result || "";
}
