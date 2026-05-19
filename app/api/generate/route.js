import { DEFAULT_LOCAL_MODEL, getLetterSystemMessage, getLocalLLMRequestHeaders, getLocalModelConfig, getMaxTokensForLocalModel } from "../../../utils/streamFetch.js";

export async function POST(req) {
    try {
        const body = await req.json();
        const { prompt, additionalInstructions, targetChars, outputType = "record" } = body;
        const maxTokens = getMaxTokensForLocalModel(DEFAULT_LOCAL_MODEL, targetChars);
        const modelConfig = getLocalModelConfig(DEFAULT_LOCAL_MODEL);

        const localApiUrl = modelConfig.apiUrl;
        const localApiKey = modelConfig.apiKey;

        console.log("[DEBUG] LOCAL_LLM_API_URL:", localApiUrl);
        console.log("[DEBUG] LOCAL_LLM_API_KEY exists:", !!localApiKey);

        if (!localApiUrl) {
            return Response.json(
                { error: "로컬 LLM API URL이 설정되지 않았습니다." },
                { status: 500 }
            );
        }

        // 메시지 구성
        let systemMessage = outputType === "letter"
            ? getLetterSystemMessage()
            : "선생님을 돕는 전문가로서 학생들의 학교생활기록부 작성을 도와줍니다.";
        if (additionalInstructions) {
            systemMessage += `\n\n【🚨 최우선 지침】\n${additionalInstructions}`;
        }

        // 단순 비스트리밍 요청 (디버깅용)
        const apiUrl = `${localApiUrl}/v1/chat/completions`;
        console.log("[DEBUG] Calling:", apiUrl);

        const headers = getLocalLLMRequestHeaders(modelConfig);

        const apiResponse = await fetch(apiUrl, {
            method: "POST",
            headers,
            body: JSON.stringify({
                model: modelConfig.apiModel,
                messages: [
                    { role: "system", content: systemMessage },
                    { role: "user", content: prompt },
                ],
                temperature: 0.7,
                max_tokens: maxTokens,
                reasoning_effort: "none",
                stream: false,
            }),
        });

        console.log("[DEBUG] Response status:", apiResponse.status);

        if (!apiResponse.ok) {
            const errorText = await apiResponse.text();
            console.error("[DEBUG] API Error:", errorText);
            return Response.json(
                { error: `로컬 LLM API 오류 (${apiResponse.status}): ${errorText}` },
                { status: 500 }
            );
        }

        const data = await apiResponse.json();
        console.log("[DEBUG] Response received, choices:", data.choices?.length);

        const content = data.choices?.[0]?.message?.content || "";

        return Response.json({ result: content });

    } catch (error) {
        console.error("[DEBUG] Catch error:", error.message, error.cause);
        return Response.json(
            { error: `서버 오류: ${error.message}` },
            { status: 500 }
        );
    }
}
