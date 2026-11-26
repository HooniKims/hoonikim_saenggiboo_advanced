import { getLetterSystemMessage, getStandardSystemMessage } from "../../../utils/streamFetch.js";
import { finalizeGeneratedText } from "../../../utils/generationHarness.js";
import { getExpansionFrameworkGuideline } from "../../../utils/textProcessor.js";

const DEFAULT_UPSTAGE_API_URL = "https://api.upstage.ai/v1/chat/completions";
const DEFAULT_UPSTAGE_MODEL = "solar-pro4";
const DEFAULT_UPSTAGE_REASONING_EFFORT = "low";
const DEFAULT_UPSTAGE_MAX_TOKENS = 16384;
const DEFAULT_UPSTAGE_TIMEOUT_MS = 8000;
const DEFAULT_UPSTAGE_TEMPERATURE = 0.1;
const SELECTABLE_UPSTAGE_MODEL_IDS = new Set(["solar-pro4", "solar-mini-4-5-preview"]);
const FACT_CHECKED_MODEL_IDS = new Set(["solar-pro4", "solar-mini-4-5-preview"]);
const MODEL_MAX_TOKENS = {
    "solar-mini": 16384,
    "solar-mini-250422": 16384,
    "solar-mini-4-5-preview": 16384,
    "solar-pro2": 16384,
    "solar-pro2-251215": 16384,
    "solar-pro3": 65536,
    "solar-pro3-260323": 65536,
    "solar-pro4": 4096,
    "solar-pro4-260806": 4096,
    "syn-pro": 16384,
    "syn-pro-251021": 16384,
};
const REASONING_MODEL_IDS = new Set([
    "solar-mini-4-5-preview",
    "solar-pro2",
    "solar-pro2-251215",
    "solar-pro3",
    "solar-pro3-260323",
    "solar-pro4",
    "solar-pro4-260806",
    "syn-pro",
    "syn-pro-251021",
]);
// 기본(분량 채우기): 입력 키워드와 성취 수준 범위에서 관찰 문장을 창작·보완해 분량을 채운다.
const OUTPUT_ONLY_INSTRUCTION = `【출력 원칙】
- 지침 충돌을 설명하지 말고 최우선 지침을 적용한 최종 본문만 출력합니다.
- '주의', '시스템 오류', '재작성 요청', '사용자 추가 지침' 같은 메타 설명을 출력하지 않습니다.
- 개인별 활동 내용이 있으면 그 수행, 역할, 관찰 단서를 우선 활용해 구체화합니다.
- 입력된 핵심 키워드와 성취 수준의 범위 안에서 수행 과정, 사고 수준, 참여 태도, 피드백 반영을 자연스럽게 창작·보완하여 다양한 관찰 문장으로 전개합니다.
- 활동이 여러 개이면 각 활동의 핵심 수행과 지정된 성취 수준을 한 문장 안에 통합하고, 입력 순서대로 모든 활동을 최소 한 문장씩 먼저 완성합니다.
- 앞 활동만 길게 확장하지 말고 전체 활동에 분량을 균등하게 배분하며, 모든 활동을 반영한 뒤 남은 분량에서만 관찰 관점을 추가합니다.
- 같은 활동을 다시 쓸 때는 앞에 없던 새 관찰을 담고 이미 쓴 내용을 다른 말로 되풀이하지 않으며, 입력에 없는 사실인 작품명, 수상, 기관, 수치, 도구, 실험 결과, 점수 같은 검증 불가능한 구체 사실은 만들지 않습니다.`;
// 입력한 활동만으로 작성(체크 시): 입력 사실만 쓰고 분량보다 사실을 우선한다.
const STRICT_FACTS_OUTPUT_ONLY_INSTRUCTION = `【출력 원칙】
- 지침 충돌을 설명하지 말고 최우선 지침을 적용한 최종 본문만 출력합니다.
- '주의', '시스템 오류', '재작성 요청', '사용자 추가 지침' 같은 메타 설명을 출력하지 않습니다.
- 개인별 활동 내용이 있으면 그 수행, 역할, 관찰 단서를 우선 활용해 구체화합니다.
- 활동이 여러 개이면 각 활동의 핵심 수행과 지정된 성취 수준을 한 문장 안에 통합하고, 입력 순서대로 모든 활동을 최소 한 문장씩 먼저 완성합니다.
- 검색 자료는 배경 설명에만 활용합니다. 검색 자료, 예시, 성취 수준 설명, 이전 초안에 등장한 내용을 학생이 직접 한 활동의 근거로 삼지 않습니다.`;

function getConfiguredMaxTokens(model) {
    if (model === "solar-pro4" || model === "solar-pro4-260806") return MODEL_MAX_TOKENS[model];
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

function getConfiguredTemperature(model) {
    const parsed = Number(process.env.UPSTAGE_TEMPERATURE);
    if (!Number.isFinite(parsed)) return DEFAULT_UPSTAGE_TEMPERATURE;
    return Math.min(Math.max(parsed, 0), 2);
}

function getUpstageConfig(requestedModel = "") {
    const model = requestedModel || process.env.UPSTAGE_MODEL?.trim() || DEFAULT_UPSTAGE_MODEL;
    // Solar Mini 4.5는 reasoning을 켜면 응답이 20배 가까이 느려져 항상 끈다.
    const reasoningEffort = model === "solar-mini-4-5-preview" || model === "solar-pro4" || model === "solar-pro4-260806"
        ? "none"
        : process.env.UPSTAGE_REASONING_EFFORT?.trim() || DEFAULT_UPSTAGE_REASONING_EFFORT;
    return {
        apiKey: process.env.UPSTAGE_API_KEY?.trim() || "",
        apiUrl: process.env.UPSTAGE_API_URL?.trim() || DEFAULT_UPSTAGE_API_URL,
        model,
        reasoningEffort: supportsReasoning(model) ? reasoningEffort : "",
        maxTokens: getConfiguredMaxTokens(model),
        temperature: getConfiguredTemperature(model),
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

function buildSystemMessage(additionalInstructions, outputType = "record", strictFacts = false) {
    let systemMessage = outputType === "letter"
        ? getLetterSystemMessage()
        : getStandardSystemMessage(strictFacts);

    systemMessage += `\n\n${strictFacts ? STRICT_FACTS_OUTPUT_ONLY_INSTRUCTION : OUTPUT_ONLY_INSTRUCTION}`;

    if (additionalInstructions?.trim()) {
        systemMessage += strictFacts
            ? `\n\n【최우선 지침】\n학생 활동의 사실을 유지하는 범위에서 아래 사용자 추가 지침을 기본 문체와 표현 규칙보다 우선 적용하세요.\n${additionalInstructions.trim()}`
            : `\n\n【최우선 지침】\n아래 사용자 추가 지침은 기본 작성 규칙보다 우선합니다. 충돌 시 사용자 추가 지침을 우선 적용하세요.\n${additionalInstructions.trim()}`;
    }

    return strictFacts ? `${systemMessage}\n\n${getExpansionFrameworkGuideline(true)}` : systemMessage;
}

function normalizeSolarPrompt(prompt, targetChars, strictFacts, outputType) {
    const source = String(prompt || "");
    if (strictFacts && source.startsWith("아래 글은 내부 규칙 검증에서 실패했습니다.")) return source;

    const numericTarget = Number(targetChars);
    const maxChars = Number.isFinite(numericTarget)
        ? Math.min(Math.max(Math.floor(numericTarget), 1), 650)
        : 490;
    const minChars = Math.floor(maxChars * 0.95);
    const preferredMaxChars = Math.max(minChars, Math.floor(maxChars * 0.97));
    const expansionCoverage = maxChars >= 500
        ? outputType === "record"
            ? "- 활동이 여러 개이면 활동마다 핵심 수행·성취 한 문장과 서로 다른 관찰을 담은 세부 과정 한두 문장을 균등하게 작성함. 목표 분량에 맞춰 전체를 보통 8~11문장으로 구성함.\n- 같은 행동을 표현만 바꿔 되풀이하지 않고 자료 선택, 작업 방법, 어려움과 해결, 피드백 반영 등 관찰 지점이 다른 장면을 골라 씀."
            : "- 활동이 네 개이면 활동마다 핵심 수행·성취를 담은 문장과 과정·태도·피드백을 구체화한 문장을 각각 작성해 활동당 최소 두 문장으로 균등하게 서술함.\n- 수행 과정, 참여 태도, 사고 수준, 피드백 반영, 성취 수준 가운데 입력과 어울리는 관점을 골라 문장마다 서로 다른 내용을 담음."
        : maxChars >= 300
            ? "- 수행 과정, 사고 수준, 성취 수준의 세 관점을 각각 구분해 서술함."
            : "- 핵심 수행 과정과 성취 수준을 우선하여 간결하게 서술함.";
    const conciseLengthInstruction = strictFacts
        ? `<분량 지침>
- 본문은 ${minChars}~${preferredMaxChars}자 정도를 목표로 충분히 구체적으로 작성함.
- 글자수나 byte 수치를 직접 계산하거나 출력하지 않음.
- 여러 활동이 입력되면 모든 활동의 핵심 수행과 성취 수준을 한 문장씩 먼저 작성함.
- 분량이 남으면 입력에 명시된 개인별 수행과 관찰 내용을 구체화함. 자료가 적으면 분량 목표보다 사실에 맞는 서술을 우선함.
- 모든 문장은 완전한 종결어미와 마침표로 끝냄.`
        : `<분량 지침>
- 본문은 ${minChars}~${preferredMaxChars}자 정도를 목표로 충분히 구체적으로 작성함.
- 글자수나 byte 수치를 직접 계산하거나 출력하지 않음.
- 분량이 부족하면 핵심 키워드의 의미 범위 안에서 성취 수준을 기준으로 수행 과정, 사고 수준, 참여 태도, 피드백 반영을 자연스럽게 창작·보완함.
- 같은 활동을 다시 쓸 때는 앞에서 쓰지 않은 새 관찰(동기, 방법, 어려움과 해결, 변화, 배운 점)을 담고, 이미 쓴 내용을 다른 말로 되풀이하지 않음.
${expansionCoverage}
- 여러 활동이 입력되면 각 활동의 핵심 수행과 성취 수준을 한 문장에 통합하고 모든 활동을 한 문장씩 먼저 작성한 뒤 남은 분량만 균등하게 확장함.
- 입력에 없는 작품명, 수상, 기관, 수치, 도구, 실험 결과, 점수 같은 검증 불가능한 구체 사실은 만들지 않음.
- 모든 문장은 완전한 종결어미와 마침표로 끝냄.`;

    return source.replace(
        /<분량 제한>[\s\S]*?(?=\n\s*(?:<출력 형식>|\[출력 형식\]|<좋은 예시>|\[좋은 예시\])|\s*$)/,
        conciseLengthInstruction,
    );
}

function buildUserMessage(prompt, additionalInstructions, targetChars, strictFacts, outputType) {
    const normalizedPrompt = normalizeSolarPrompt(prompt, targetChars, strictFacts, outputType);
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

async function callUpstage({ prompt, additionalInstructions, targetChars, model, outputType, review, strictFacts = false }) {
    const config = getUpstageConfig(model);
    const messages = review ? [
        {
            role: "system",
            content: `학교생활기록부 초안의 사실관계를 교정하세요.
- 초안의 행동, 방법, 결과, 기간을 관찰 기록과 절 단위로 대조하세요. 근거가 없는 부분만 삭제하거나 기록과 일치하게 고치세요. 비교했다는 기록만으로 어느 쪽이 더 빨랐는지, 얼마나 달랐는지, 어떤 원인을 찾아냈는지 단정하지 마세요. 한 번의 관찰을 반복된 행동이나 한 해 동안의 변화로 쓰지 마세요.
- 관찰 기록이 짧은 키워드로만 되어 있으면 키워드가 직접 가리키는 행동과 느낀 점을 문장으로 풀어 쓴 부분은 근거가 있는 것으로 보고 유지하세요. 키워드에 없는 다른 활동, 도구, 결과, 협력 장면은 근거가 없는 것으로 보세요.
- '수행이 돋보임', '이해가 뛰어남', '연습이 더해지면 향상이 기대됨'처럼 새로운 행동이나 결과를 주장하지 않는 성취도 평가는 유지하세요. 근거 없는 행동에 평가가 붙어 있으면 평가를 버리지 말고 기록에 있는 해당 활동에 연결하세요.
- mustKeep에 있는 평가 표현은 지우거나 바꾸지 말고 초안에서 붙어 있던 활동 문장 안에 그대로 남기세요.
- 초안에서 근거가 있는 표현과 활동의 순서를 유지하세요. 여러 활동을 한 문장에 나열하는 식으로 합치지 말고 활동별 문장을 유지하세요. 관찰 사실을 전부 나열하는 문장으로 바꾸지 마세요. 추가 지침은 사실을 바꾸지 않는 범위에서 지키세요.
- 현재형 명사 종결어미와 마침표를 사용하고 한 문단의 교정 본문만 출력하세요. 입력 사실을 늘리거나 권장 분량에 맞추려 하지 마세요.`,
        },
        { role: "user", content: JSON.stringify(review) },
    ] : [
        { role: "system", content: buildSystemMessage(additionalInstructions, outputType, strictFacts) },
        { role: "user", content: buildUserMessage(prompt, additionalInstructions, targetChars, strictFacts, outputType) },
    ];
    const requestBody = {
        model: config.model,
        messages,
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
        // '입력한 활동만으로 작성'을 체크했을 때만 사실 우선 지침과 사실 대조를 적용한다.
        const strictFacts = body.strictFacts === true;
        const requestedModel = String(body.model || "").trim();
        if (requestedModel && !SELECTABLE_UPSTAGE_MODEL_IDS.has(requestedModel)) {
            return Response.json({ error: `지원하지 않는 Upstage 모델입니다: ${requestedModel}` }, { status: 400 });
        }
        const config = getUpstageConfig(requestedModel);

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
            model: requestedModel,
            outputType,
            strictFacts,
        });

        if (response.ok && !extractContent(data)) {
            const retry = await callUpstage({
                prompt: `${prompt}\n\n[분량 보정] 이전 응답에서 표시 가능한 본문이 생성되지 않았습니다. 추론은 최소화하고, message.content에 들어갈 본문 텍스트만 바로 출력하세요. reasoning만 작성하지 말고 반드시 최종 본문을 출력하세요.`,
                additionalInstructions,
                targetChars: Math.ceil((Number(targetChars) || 490) * 1.2),
                model: requestedModel,
                outputType,
                strictFacts,
            });
            response = retry.response;
            data = retry.data;
            model = retry.model;
        }

        if (!response.ok) {
            const message = data?.error?.message || "Upstage API 요청에 실패했습니다.";
            return Response.json({ error: `Upstage API 오류 (${response.status}): ${message}` }, { status: response.status });
        }

        let content = extractContent(data);
        if (!content) {
            const finishReason = data?.choices?.[0]?.finish_reason;
            return Response.json({
                error: `Upstage API 응답에서 생성 텍스트를 찾지 못했습니다.${finishReason ? ` finish_reason=${finishReason}` : ""}`,
            }, { status: 502 });
        }

        const sourceFacts = Array.isArray(body.sourceFacts)
            ? body.sourceFacts.filter((fact) => typeof fact === "string" && fact.trim())
            : [];
        if (strictFacts && FACT_CHECKED_MODEL_IDS.has(model) && outputType === "record" && sourceFacts.length) {
            // 성취도 평가 표현(예: 돋보임, 향상이 기대됨)은 사실 대조에서 지워지면 안 된다.
            const keepTerms = Array.isArray(body.keepTerms)
                ? body.keepTerms.filter((term) => typeof term === "string" && term.trim())
                : [];
            const draft = content;
            const mustKeep = keepTerms.filter((term) => draft.includes(term));
            const checked = await callUpstage({
                model,
                review: { sourceFacts, additionalInstructions, mustKeep, draft },
            });
            const reviewed = checked.response.ok ? extractContent(checked.data) : "";
            if (!reviewed) {
                return Response.json({ error: "Solar가 초안의 사실관계를 확인하지 못했습니다. 다시 생성해 주세요." }, { status: 502 });
            }
            const lostTerms = mustKeep.filter((term) => !reviewed.includes(term));
            if (lostTerms.length) {
                console.warn(`[사실 대조] 평가 표현이 지워져 대조 전 초안을 사용함: ${lostTerms.join(", ")}`);
            }
            content = lostTerms.length ? draft : reviewed;
        }

        const result = finalizeGeneratedText(content, targetChars, 0, outputType);
        if (!result) {
            return Response.json({ error: "Upstage API 응답에서 생성 본문을 찾지 못했습니다." }, { status: 502 });
        }
        return Response.json({ result, model });
    } catch (error) {
        return Response.json({ error: `서버 오류: ${error.message}` }, { status: 500 });
    }
}
