import { getMaxTokensForTargetChars } from "../../../utils/textProcessor.js";
import { DEFAULT_OPENAI_MODEL, OPENAI_MODELS } from "../../../utils/openAIFetch.js";
import { getLetterSystemMessage } from "../../../utils/streamFetch.js";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

function buildSystemMessage(additionalInstructions, outputType = "record") {
    let systemMessage = outputType === "letter"
        ? getLetterSystemMessage()
        : "선생님을 돕는 전문가로서 학생들의 학교생활기록부와 가정통신문 작성을 도와줍니다.";
    if (additionalInstructions) {
        systemMessage += `\n\n【최우선 지침】\n아래 사용자 추가 지침은 기본 작성 규칙보다 우선합니다. 충돌 시 사용자 추가 지침을 우선 적용하세요.\n${additionalInstructions}`;
    }
    return systemMessage;
}

function buildUserMessage(prompt, additionalInstructions) {
    if (!additionalInstructions?.trim()) return prompt;
    const instruction = additionalInstructions.trim();
    return `[최우선 규칙] 다음 사용자 추가 지침을 반드시 지켜서 작성하라: ${instruction}

${prompt}

[다시 한번 강조] 위 본문 작성 시 반드시 적용할 사용자 추가 지침: ${instruction}`;
}

function extractContent(data) {
    if (typeof data?.output_text === "string") {
        return data.output_text.trim();
    }
    if (Array.isArray(data?.output)) {
        return data.output
            .flatMap((item) => item.content || [])
            .map((part) => part.text || "")
            .join("")
            .trim();
    }
    const content = data?.choices?.[0]?.message?.content;
    if (Array.isArray(content)) {
        return content.map((part) => part.text || "").join("").trim();
    }
    return (content || "").trim();
}

function getOpenAIMaxCompletionTokens(targetChars) {
    const baseTokens = getMaxTokensForTargetChars(targetChars);
    return Math.max(4096, Math.min(8192, baseTokens * 4));
}

async function callOpenAI({ apiKey, prompt, additionalInstructions, targetChars, model, outputType }) {
    const maxTokens = getOpenAIMaxCompletionTokens(targetChars);
    const response = await fetch(OPENAI_API_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model,
            messages: [
                { role: "system", content: buildSystemMessage(additionalInstructions, outputType) },
                { role: "user", content: buildUserMessage(prompt, additionalInstructions) },
            ],
            max_completion_tokens: maxTokens,
            reasoning_effort: "minimal",
        }),
    });

    const rawText = await response.text();
    let data = {};
    try {
        data = rawText ? JSON.parse(rawText) : {};
    } catch {
        data = { error: { message: rawText } };
    }

    return { response, data };
}

function isModelNotFound(response, data) {
    const message = data?.error?.message || "";
    const code = data?.error?.code || "";
    return response.status === 404 || code === "model_not_found" || /model/i.test(message) && /not found|does not exist/i.test(message);
}

function getFallbackModel(requestedModel) {
    return OPENAI_MODELS.find((option) => option.id !== requestedModel)?.id || DEFAULT_OPENAI_MODEL;
}

export async function POST(req) {
    try {
        const body = await req.json();
        const { prompt, additionalInstructions, apiKey, targetChars, model, outputType = "record" } = body;

        if (!apiKey?.trim()) {
            return Response.json({ error: "OpenAI API key가 필요합니다." }, { status: 400 });
        }
        if (!prompt?.trim()) {
            return Response.json({ error: "생성할 프롬프트가 비어 있습니다." }, { status: 400 });
        }

        const requestedModel = OPENAI_MODELS.some((option) => option.id === model)
            ? model
            : DEFAULT_OPENAI_MODEL;

        let { response, data } = await callOpenAI({
            apiKey: apiKey.trim(),
            prompt,
            additionalInstructions,
            targetChars,
            model: requestedModel,
            outputType,
        });
        let usedModel = requestedModel;

        if (!response.ok && isModelNotFound(response, data)) {
            const fallbackModel = getFallbackModel(requestedModel);
            const retry = await callOpenAI({
                apiKey: apiKey.trim(),
                prompt,
                additionalInstructions,
                targetChars,
                model: fallbackModel,
                outputType,
            });
            response = retry.response;
            data = retry.data;
            usedModel = fallbackModel;
        }

        if (response.ok && !extractContent(data)) {
            const retry = await callOpenAI({
                apiKey: apiKey.trim(),
                prompt: `${prompt}\n\n[분량 보정] 이전 응답에서 표시 가능한 본문이 생성되지 않았습니다. 추론을 짧게 하고, 본문 텍스트만 바로 출력하세요.`,
                additionalInstructions,
                targetChars: Math.ceil((Number(targetChars) || 490) * 1.2),
                model: usedModel,
                outputType,
            });
            response = retry.response;
            data = retry.data;
        }

        if (!response.ok) {
            const message = data?.error?.message || "OpenAI API 요청에 실패했습니다.";
            return Response.json({ error: `OpenAI API 오류 (${response.status}): ${message}` }, { status: response.status });
        }

        const content = extractContent(data);
        if (!content) {
            const finishReason = data?.choices?.[0]?.finish_reason;
            return Response.json({
                error: `OpenAI API 응답에서 생성 텍스트를 찾지 못했습니다.${finishReason ? ` finish_reason=${finishReason}` : ""}`,
            }, { status: 502 });
        }

        return Response.json({ result: content, model: usedModel });
    } catch (error) {
        return Response.json({ error: `서버 오류: ${error.message}` }, { status: 500 });
    }
}
