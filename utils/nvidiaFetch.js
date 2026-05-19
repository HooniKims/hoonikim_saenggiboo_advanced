export async function fetchNvidiaCompletion({ prompt, additionalInstructions, targetChars, model, outputType = "record" }) {
    const response = await fetch("/api/nvidia-generate", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            prompt,
            additionalInstructions,
            targetChars,
            model,
            outputType,
        }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.error || `NVIDIA API 오류 (${response.status})`);
    }

    return data.result || "";
}
