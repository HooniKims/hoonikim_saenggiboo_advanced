import { getMaxTokensForTargetChars } from "../../../utils/textProcessor.js";
import { AVAILABLE_MODELS, getLetterSystemMessage, getNvidiaModelId, isNvidiaModel } from "../../../utils/streamFetch.js";

const DEFAULT_NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const DEFAULT_NVIDIA_MODEL = "google/gemma-4-31b-it";
const KEYWORD_EXPANSION_GUIDE = `

[핵심 생성 방식]
- 사용자가 입력한 내용은 완성문이 아니라 학생 활동 키워드, 짧은 메모, 관찰 단서일 수 있다.
- 입력 키워드를 그대로 나열하지 말고 교사가 관찰한 실제 행동으로 해석해 자연스럽게 확장한다.
- 첫 응답에서 바로 충분한 분량을 만든다. 나중에 보정으로 채우는 방식에 기대지 않는다.
- 짧은 키워드는 동기, 과정, 태도, 결과, 성장의 흐름으로 풀어 쓴다.
- 입력에 없는 구체적인 대회명, 과목명, 기관명, 수상 실적은 지어내지 않는다.
- 최종 출력은 사용자가 바로 붙여 넣을 수 있는 본문 한 문단만 작성한다.
`;

function buildSystemMessage(additionalInstructions, outputType = "record") {
    let systemMessage = outputType === "letter"
        ? getLetterSystemMessage()
        : "선생님을 돕는 전문가로서 학생들의 학교생활기록부와 가정통신문 작성을 도와줍니다.";
    if (outputType !== "letter") {
        systemMessage += KEYWORD_EXPANSION_GUIDE;
    }
    if (additionalInstructions) {
        systemMessage += `\n\n사용자 추가 규칙 (최우선 준수):\n${additionalInstructions}`;
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
    const content = data?.choices?.[0]?.message?.content;
    if (Array.isArray(content)) {
        return content.map((part) => part.text || "").join("").trim();
    }
    return (content || "").trim();
}

function getAllowedNvidiaModelIds() {
    return AVAILABLE_MODELS
        .filter((option) => option.provider === "nvidia")
        .map((option) => getNvidiaModelId(option.id));
}

function normalizeModel(model) {
    const requestedModel = isNvidiaModel(model) ? getNvidiaModelId(model) : model;
    const allowedModelIds = getAllowedNvidiaModelIds();
    if (allowedModelIds.includes(requestedModel)) return requestedModel;
    const envModel = process.env.NVIDIA_MODEL || "";
    return allowedModelIds.includes(envModel) ? envModel : DEFAULT_NVIDIA_MODEL;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
    return status === 429 || status === 502 || status === 503 || status === 504;
}

async function callNvidia({ usedModel, prompt, additionalInstructions, targetChars, outputType, signal }) {
    const maxTokens = getMaxTokensForTargetChars(targetChars);
    const response = await fetch(process.env.NVIDIA_API_URL || DEFAULT_NVIDIA_API_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.NVIDIA_API_KEY.trim()}`,
        },
        signal,
        body: JSON.stringify({
            model: usedModel,
            messages: [
                { role: "system", content: buildSystemMessage(additionalInstructions, outputType) },
                { role: "user", content: buildUserMessage(prompt, additionalInstructions) },
            ],
            max_tokens: maxTokens,
            temperature: 0.7,
            stream: false,
        }),
    });

    const rawText = await response.text();
    let data = {};
    try {
        data = rawText ? JSON.parse(rawText) : {};
    } catch {
        data = { error: { message: rawText.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() } };
    }

    return { response, data };
}

async function callNvidiaWithRetry(args) {
    let lastResult = null;
    let lastError = null;
    const maxAttempts = 3;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 180000);
        try {
            const result = await callNvidia({ ...args, signal: controller.signal });
            lastResult = result;
            if (!isRetryableStatus(result.response.status)) {
                return result;
            }
        } catch (error) {
            lastError = error;
            if (error.name !== "AbortError" && attempt === maxAttempts - 1) {
                throw error;
            }
        } finally {
            clearTimeout(timeout);
        }

        if (attempt < maxAttempts - 1) {
            await sleep(600 * (attempt + 1));
        }
    }

    if (lastResult) return lastResult;
    throw lastError || new Error("NVIDIA API 요청에 실패했습니다.");
}

export async function POST(req) {
    try {
        const body = await req.json();
        const { prompt, additionalInstructions, targetChars, model, outputType = "record" } = body;

        if (!process.env.NVIDIA_API_KEY?.trim()) {
            return Response.json({ error: "NVIDIA_API_KEY 환경 변수가 필요합니다." }, { status: 400 });
        }
        if (!prompt?.trim()) {
            return Response.json({ error: "생성할 프롬프트가 비어 있습니다." }, { status: 400 });
        }

        const usedModel = normalizeModel(model);
        const { response, data } = await callNvidiaWithRetry({
            usedModel,
            prompt,
            additionalInstructions,
            targetChars,
            outputType,
        });

        if (!response.ok) {
            const message = data?.error?.message || "NVIDIA API 요청에 실패했습니다.";
            return Response.json({ error: `NVIDIA API 오류 (${response.status}): ${message}` }, { status: response.status });
        }

        const content = extractContent(data);
        if (!content) {
            return Response.json({ error: "NVIDIA API 응답에서 생성 텍스트를 찾지 못했습니다." }, { status: 502 });
        }

        return Response.json({ result: content, model: usedModel });
    } catch (error) {
        if (error.name === "AbortError") {
            return Response.json({
                error: "NVIDIA API 응답 시간이 180초를 초과했습니다. 더 빠른 NVIDIA 모델을 선택하거나 입력 학생 수를 줄여 다시 시도하세요.",
            }, { status: 504 });
        }
        return Response.json({ error: `서버 오류: ${error.message}` }, { status: 500 });
    }
}
