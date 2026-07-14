import { getLetterSystemMessage, getStandardSystemMessage } from "../../../utils/streamFetch.js";
import { finalizeGeneratedText } from "../../../utils/generationHarness.js";

const DEFAULT_UPSTAGE_API_URL = "https://api.upstage.ai/v1/chat/completions";
const DEFAULT_UPSTAGE_MODEL = "solar-pro2";
const DEFAULT_UPSTAGE_REASONING_EFFORT = "low";
const DEFAULT_UPSTAGE_MAX_TOKENS = 16384;
const DEFAULT_UPSTAGE_TIMEOUT_MS = 8000;
const DEFAULT_UPSTAGE_TEMPERATURE = 0.1;
const MODEL_MAX_TOKENS = {
    "solar-mini": 16384,
    "solar-mini-250422": 16384,
    "solar-open": 131072,
    "solar-open-2": 131072,
    "solar-open2": 131072,
    "solar-pro2": 16384,
    "solar-pro2-251215": 16384,
    "solar-pro3": 65536,
    "solar-pro3-260323": 65536,
    "syn-pro": 16384,
    "syn-pro-251021": 16384,
};
const REASONING_MODEL_IDS = new Set([
    "solar-pro2",
    "solar-pro2-251215",
    "solar-pro3",
    "solar-pro3-260323",
    "syn-pro",
    "syn-pro-251021",
]);
const OUTPUT_ONLY_INSTRUCTION = `【출력 원칙】
- 지침 충돌을 설명하지 말고 최우선 지침을 적용한 최종 본문만 출력합니다.
- '주의', '시스템 오류', '재작성 요청', '사용자 추가 지침' 같은 메타 설명을 출력하지 않습니다.
- 개인별 활동 내용이 있으면 그 수행, 역할, 관찰 단서를 우선 활용해 구체화합니다.
- 입력된 핵심 키워드와 성취 수준의 범위 안에서 수행 과정, 사고 수준, 참여 태도, 피드백 반영을 자연스럽게 창작·보완하여 다양한 관찰 문장으로 전개합니다.
- 활동이 여러 개이면 각 활동의 핵심 수행과 지정된 성취 수준을 한 문장 안에 통합하고, 입력 순서대로 모든 활동을 최소 한 문장씩 먼저 완성합니다.
- 앞 활동만 길게 확장하지 말고 전체 활동에 분량을 균등하게 배분하며, 모든 활동을 반영한 뒤 남은 분량에서만 관찰 관점을 추가합니다.
- 같은 활동을 서로 다른 관찰 관점으로 풀어 쓰는 것은 허용하되, 입력에 없는 사실인 작품명, 수상, 기관, 수치, 도구, 실험 결과, 점수 같은 검증 불가능한 구체 사실은 만들지 않습니다.`;

function getConfiguredMaxTokens(model) {
    const parsed = Number(process.env.UPSTAGE_MAX_TOKENS);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return MODEL_MAX_TOKENS[model] || DEFAULT_UPSTAGE_MAX_TOKENS;
    }
    return Math.floor(parsed);
}

function supportsReasoning(model) {
    return REASONING_MODEL_IDS.has(model);
}

function getConfiguredTimeoutMs() {
    const parsed = Number(process.env.UPSTAGE_TIMEOUT_MS);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_UPSTAGE_TIMEOUT_MS;
    return Math.min(Math.max(Math.floor(parsed), 1000), 60000);
}

function getConfiguredTemperature() {
    const parsed = Number(process.env.UPSTAGE_TEMPERATURE);
    if (!Number.isFinite(parsed)) return DEFAULT_UPSTAGE_TEMPERATURE;
    return Math.min(Math.max(parsed, 0), 2);
}

function getUpstageConfig() {
    const model = process.env.UPSTAGE_MODEL?.trim() || DEFAULT_UPSTAGE_MODEL;
    const reasoningEffort = process.env.UPSTAGE_REASONING_EFFORT?.trim() || DEFAULT_UPSTAGE_REASONING_EFFORT;
    return {
        apiKey: process.env.UPSTAGE_API_KEY?.trim() || "",
        apiUrl: process.env.UPSTAGE_API_URL?.trim() || DEFAULT_UPSTAGE_API_URL,
        model,
        reasoningEffort: supportsReasoning(model) ? reasoningEffort : "",
        maxTokens: getConfiguredMaxTokens(model),
        temperature: getConfiguredTemperature(),
        timeoutMs: getConfiguredTimeoutMs(),
    };
}

async function fetchWithTimeoutRetry(url, options, timeoutMs) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
            return await fetch(url, { ...options, signal: controller.signal });
        } catch (error) {
            if (error?.name !== "AbortError" || attempt === 1) {
                if (error?.name === "AbortError") {
                    throw new Error(`Upstage API 응답 시간 초과(${timeoutMs}ms, 2회 시도)`);
                }
                throw error;
            }
        } finally {
            clearTimeout(timeout);
        }
    }

    throw new Error("Upstage API 재시도에 실패했습니다.");
}

function buildSystemMessage(additionalInstructions, outputType = "record") {
    let systemMessage = outputType === "letter"
        ? getLetterSystemMessage()
        : getStandardSystemMessage();

    systemMessage += `\n\n${OUTPUT_ONLY_INSTRUCTION}`;

    if (additionalInstructions?.trim()) {
        systemMessage += `\n\n【최우선 지침】\n아래 사용자 추가 지침은 기본 작성 규칙보다 우선합니다. 충돌 시 사용자 추가 지침을 우선 적용하세요.\n${additionalInstructions.trim()}`;
    }

    return systemMessage;
}

function normalizeSolarPrompt(prompt, targetChars) {
    const numericTarget = Number(targetChars);
    const maxChars = Number.isFinite(numericTarget)
        ? Math.min(Math.max(Math.floor(numericTarget), 1), 650)
        : 490;
    const minChars = Math.floor(maxChars * 0.95);
    const preferredMaxChars = Math.max(minChars, Math.floor(maxChars * 0.97));
    const expansionCoverage = maxChars >= 500
        ? "- 활동이 네 개이면 활동마다 핵심 수행·성취를 담은 문장과 과정·태도·피드백을 구체화한 문장을 각각 작성해 활동당 최소 두 문장으로 균등하게 서술함.\n- 수행 과정, 참여 태도, 사고 수준, 피드백 반영, 성취 수준의 다섯 관점을 각각 별도 문장으로 빠짐없이 서술함."
        : maxChars >= 300
            ? "- 수행 과정, 사고 수준, 성취 수준의 세 관점을 각각 구분해 서술함."
            : "- 핵심 수행 과정과 성취 수준을 우선하여 간결하게 서술함.";
    const conciseLengthInstruction = `<분량 지침>
- 본문은 ${minChars}~${preferredMaxChars}자 정도를 목표로 충분히 구체적으로 작성함.
- 글자수나 byte 수치를 직접 계산하거나 출력하지 않음.
- 분량이 부족하면 핵심 키워드의 의미 범위 안에서 성취 수준을 기준으로 수행 과정, 사고 수준, 참여 태도, 피드백 반영을 자연스럽게 창작·보완함.
- 같은 활동을 서로 다른 관찰 관점으로 풀어 여러 문장으로 전개하고, 표현과 문장 구조를 반복하지 않음.
${expansionCoverage}
- 여러 활동이 입력되면 각 활동의 핵심 수행과 성취 수준을 한 문장에 통합하고 모든 활동을 한 문장씩 먼저 작성한 뒤 남은 분량만 균등하게 확장함.
- 입력에 없는 작품명, 수상, 기관, 수치, 도구, 실험 결과, 점수 같은 검증 불가능한 구체 사실은 만들지 않음.
- 모든 문장은 완전한 종결어미와 마침표로 끝냄.`;

    return String(prompt || "").replace(
        /<분량 제한>[\s\S]*?(?=\n\s*(?:<출력 형식>|\[출력 형식\]|<좋은 예시>|\[좋은 예시\])|\s*$)/,
        conciseLengthInstruction,
    );
}

function buildUserMessage(prompt, additionalInstructions, targetChars) {
    const normalizedPrompt = normalizeSolarPrompt(prompt, targetChars);
    if (!additionalInstructions?.trim()) return normalizedPrompt;
    const instruction = additionalInstructions.trim();
    return `[최우선 규칙] 다음 사용자 추가 지침을 반드시 지켜서 작성하라: ${instruction}

${normalizedPrompt}

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

async function callUpstage({ prompt, additionalInstructions, targetChars, outputType, forceMaximumTokens = false }) {
    const config = getUpstageConfig();
    const requestBody = {
        model: config.model,
        messages: [
            { role: "system", content: buildSystemMessage(additionalInstructions, outputType) },
            { role: "user", content: buildUserMessage(prompt, additionalInstructions, targetChars) },
        ],
        max_tokens: config.maxTokens,
        temperature: config.temperature,
        stream: false,
    };
    if (config.reasoningEffort) {
        requestBody.reasoning_effort = config.reasoningEffort;
    }

    const response = await fetchWithTimeoutRetry(config.apiUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(requestBody),
    }, config.timeoutMs);

    const rawText = await response.text();
    let data = {};
    try {
        data = rawText ? JSON.parse(rawText) : {};
    } catch {
        data = { error: { message: rawText } };
    }

    return { response, data, model: config.model };
}

export async function POST(req) {
    try {
        const body = await req.json();
        const { prompt, additionalInstructions, targetChars, outputType = "record" } = body;
        const config = getUpstageConfig();

        if (!config.apiKey) {
            return Response.json({ error: ".env의 UPSTAGE_API_KEY 값이 필요합니다." }, { status: 400 });
        }
        if (!prompt?.trim()) {
            return Response.json({ error: "생성할 프롬프트가 비어 있습니다." }, { status: 400 });
        }

        let { response, data, model } = await callUpstage({
            prompt,
            additionalInstructions,
            targetChars,
            outputType,
        });

        if (response.ok && !extractContent(data)) {
            const retry = await callUpstage({
                prompt: `${prompt}\n\n[분량 보정] 이전 응답에서 표시 가능한 본문이 생성되지 않았습니다. 추론은 최소화하고, message.content에 들어갈 본문 텍스트만 바로 출력하세요. reasoning만 작성하지 말고 반드시 최종 본문을 출력하세요.`,
                additionalInstructions,
                targetChars: Math.ceil((Number(targetChars) || 490) * 1.2),
                outputType,
                forceMaximumTokens: true,
            });
            response = retry.response;
            data = retry.data;
            model = retry.model;
        }

        if (!response.ok) {
            const message = data?.error?.message || "Upstage API 요청에 실패했습니다.";
            return Response.json({ error: `Upstage API 오류 (${response.status}): ${message}` }, { status: response.status });
        }

        const content = finalizeGeneratedText(extractContent(data), targetChars, 0, outputType);
        if (!content) {
            const finishReason = data?.choices?.[0]?.finish_reason;
            return Response.json({
                error: `Upstage API 응답에서 생성 텍스트를 찾지 못했습니다.${finishReason ? ` finish_reason=${finishReason}` : ""}`,
            }, { status: 502 });
        }

        return Response.json({ result: content, model });
    } catch (error) {
        return Response.json({ error: `서버 오류: ${error.message}` }, { status: 500 });
    }
}
