export async function fetchUpstageCompletion({ prompt, additionalInstructions, targetChars, outputType = "record" }) {
    const response = await fetch("/api/upstage-generate", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            prompt,
            additionalInstructions,
            targetChars,
            outputType,
        }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.error || `Upstage API 오류 (${response.status})`);
    }

    return data.result || "";
}
