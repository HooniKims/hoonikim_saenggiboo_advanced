import { getMaxTokensForTargetChars } from "./textProcessor.js";

const LMSTUDIO_API_URL = "https://lm.alluser.site";
const LMSTUDIO_API_KEY = "gudgns0411skaluv2018tjdbs130429";
const LMSTUDIO_GEMMA_E4B_MODEL = "google/gemma-4-e4b";
const LMSTUDIO_GEMMA_E2B_MODEL = "google/gemma-4-e2b";
const LMSTUDIO_GEMMA_12B_MODEL = "gemma-4-12b-it";
const LMSTUDIO_GEMMA_26B_MODEL = "gemma-4-26b-a4b-it";

/**
 * 사용 가능한 모델 목록
 * 새 모델 추가 시 여기에만 추가하면 모든 페이지에 반영됩니다.
 */
export const AVAILABLE_MODELS = [
    { id: "gemma4:e4b", name: "Gemma 4 E4B", description: "빠름, 품질 보통", isLightweight: true, provider: "local", apiUrl: LMSTUDIO_API_URL, apiKey: LMSTUDIO_API_KEY, apiModel: LMSTUDIO_GEMMA_E4B_MODEL },
    { id: "gemma4:e2b", name: "Gemma 4 E2B", description: "가장 빠름, 간단 작업용", isLightweight: true, provider: "local", apiUrl: LMSTUDIO_API_URL, apiKey: LMSTUDIO_API_KEY, apiModel: LMSTUDIO_GEMMA_E2B_MODEL },
    { id: "lmstudio:gemma-4-12b-it", name: "Gemma 4 12B", description: "기본 모델, 속도와 품질 균형", isLightweight: false, provider: "local", apiUrl: LMSTUDIO_API_URL, apiKey: LMSTUDIO_API_KEY, apiModel: LMSTUDIO_GEMMA_12B_MODEL },
    { id: "lmstudio:gemma-4-26b-a4b-it-q4ks", name: "Gemma 4 26B Q4", description: "가장 느림, 품질 높음", isLightweight: false, provider: "local", apiUrl: LMSTUDIO_API_URL, apiKey: LMSTUDIO_API_KEY, apiModel: LMSTUDIO_GEMMA_26B_MODEL },
];

export const DEFAULT_LOCAL_MODEL = "lmstudio:gemma-4-12b-it";
export const DEFAULT_MODEL = DEFAULT_LOCAL_MODEL;

export function getModelOptionLabel(model) {
    return `${model.name} - ${model.description}`;
}

export function isNvidiaModel(modelId) {
    return String(modelId || "").startsWith("nvidia:");
}

export function getNvidiaModelId(modelId) {
    return String(modelId || "").replace(/^nvidia:/, "");
}

export function getLocalModelConfig(modelId) {
    const selected = AVAILABLE_MODELS.find((model) => model.id === modelId);
    return {
        apiUrl: selected?.apiUrl || LMSTUDIO_API_URL,
        apiKey: selected?.apiKey || LMSTUDIO_API_KEY,
        apiModel: selected?.apiModel || modelId || DEFAULT_LOCAL_MODEL,
    };
}

export function getLocalLLMRequestHeaders(modelConfig) {
    const origin = modelConfig.apiUrl || LMSTUDIO_API_URL;
    const headers = {
        "Content-Type": "application/json",
        Origin: origin,
        Referer: `${origin}/`,
    };
    if (modelConfig.apiKey) {
        headers["X-API-Key"] = modelConfig.apiKey;
    }
    return headers;
}

/**
 * 모델이 경량 모델인지 확인
 */
export function isLightweightModel(modelId) {
    const model = AVAILABLE_MODELS.find(m => m.id === modelId);
    if (model?.provider === "nvidia") return false;
    return model ? model.isLightweight : modelId.includes("4b") || modelId.includes("1b") || modelId.includes("2b");
}

export function getMaxTokensForLocalModel(modelId, targetChars) {
    const baseTokens = getMaxTokensForTargetChars(targetChars);
    const modelKey = String(modelId || "").toLowerCase();
    const isLmStudioLargeModel = modelKey.startsWith("lmstudio:") && (modelKey.includes("12b") || modelKey.includes("26b"));
    if (modelKey === "gemma4:e4b") return Math.max(3072, baseTokens);
    return isLmStudioLargeModel ? Math.max(4096, baseTokens) : baseTokens;
}

/**
 * 텍스트가 완전한 한국어 문장으로 끝나는지 확인
 */
function endsWithCompleteSentence(text, outputType = "record") {
    if (!text || !text.trim()) return false;
    const trimmed = text.trim();
    if (outputType === "letter") {
        return /(?:습니다|합니다|입니다|됩니다|바랍니다|드립니다|좋겠습니다|필요합니다|응원합니다)[.!?]\s*$/.test(trimmed);
    }
    return /(?:함|음|임|됨|봄|옴|줌|춤|움|늠|름|남|냄|김|짐|님|감|보임|드러남|나타남|돋보임|지님|뛰어남)[.!?]\s*$/.test(trimmed);
}

/**
 * Ollama API 1회 호출
 */
async function callOllamaAPI(systemMessage, userPrompt, model, targetChars) {
    // 경량 모델은 temperature를 약간 올려 다양성 확보
    const localModel = model || DEFAULT_LOCAL_MODEL;
    const modelConfig = getLocalModelConfig(localModel);
    const isLightweight = isLightweightModel(localModel);
    const temperature = isLightweight ? 0.8 : 0.7;
    const maxTokens = getMaxTokensForLocalModel(localModel, targetChars);

    const apiUrl = `${modelConfig.apiUrl}/v1/chat/completions`;
    console.info(`[Local LLM] POST ${apiUrl} model=${modelConfig.apiModel}`);

    const res = await fetch(apiUrl, {
        method: "POST",
        headers: getLocalLLMRequestHeaders(modelConfig),
        body: JSON.stringify({
            model: modelConfig.apiModel,
            messages: [
                { role: "system", content: systemMessage },
                { role: "user", content: userPrompt },
            ],
            temperature,
            max_tokens: maxTokens,
            reasoning_effort: "none",
            stream: false,
        }),
    });

    if (!res.ok) {
        let errorMessage = `로컬 LLM 서버 오류 (${res.status})`;
        try {
            const errorData = await res.json();
            errorMessage = errorData.error || errorMessage;
        } catch {
            // 무시
        }
        throw new Error(errorMessage);
    }

    const data = await res.json();
    if (data.choices?.[0]?.finish_reason === "length") {
        console.warn(`[Ollama] finish_reason=length model=${localModel} max_tokens=${maxTokens}`);
    }
    const choice = data.choices?.[0];
    const content = choice?.message?.content || "";
    if (!content.trim() && choice?.message?.reasoning) {
        console.warn(`[Ollama] reasoning-only response model=${localModel} max_tokens=${maxTokens}`);
    }
    return content;
}

/**
 * 경량 모델용 시스템 메시지 (간결하고 명확한 지시)
 */
function getLightweightSystemMessage() {
    return `학교생활기록부 세특 작성 전문가.

[절대금지 규칙]
1. 과목명/동아리명 출력 금지 (예: "국어시간에", "과학 수업에서", "봉사동아리에서" → 전부 금지)
2. 과거형 금지 (예: ~했음, ~였음, ~되었음, ~보였음 → 전부 금지)
3. '학생은', '이 학생은' 등 주어 금지

[필수 규칙]
4. 반드시 현재형 명사 종결어미만 사용: ~함, ~임, ~음, ~보임, ~드러남
5. 입력된 활동 내용을 모두 빠짐없이 반영
6. 줄바꿈 없이 하나의 문단
7. 요약/마무리 문장 금지. '마지막으로', '끝으로', '마무리하며', '덧붙여', '추가로' 사용 금지
8. 오직 본문만 출력 (메타정보 출력 금지)

❌ 잘못된 예: "국어 시간에 토론 활동을 했음." "과학실험을 수행하였음."
✅ 올바른 예: "토론 활동에서 찬반 입장을 논리적으로 정리하여 발표함." "실험 과정에서 변인을 통제하며 데이터를 분석함."`;
}

/**
 * 일반 모델용 시스템 메시지
 */
function getStandardSystemMessage() {
    return `학교생활기록부 작성 전문가. 반드시 지킬 규칙:
1. 현재형 명사 종결어미(~함, ~임, ~음, ~보임, ~드러남)만 사용. 과거형(~했음, ~였음, ~되었음, ~하였음, ~보였음) 절대 금지
2. '학생은', '이 학생은' 등 주어 없이 활동부터 서술
3. 과목명/프로그램명/동아리명을 출력에 절대 포함하지 않음 (예: "국어시간에", "수학 수업에서" 등 금지)
4. 줄바꿈 없이 하나의 문단으로 작성
5. 마지막 문장도 반드시 구체적 활동 서술로 끝냄
6. 요약, 정리, 결론 문장 작성하지 않음. '마지막으로', '끝으로', '마무리하며', '덧붙여', '추가로' 사용 금지
7. 입력된 활동 외에 사실을 지어내지 않음
8. 입력된 모든 활동 내용을 빠짐없이 반영하여 서술
9. 오직 본문 텍스트만 출력 (글자수, 분석 등 메타정보 출력하지 않음)`;
}

export function getLetterSystemMessage() {
    return `학기말 가정통신문 작성 전문가. 반드시 지킬 규칙:
1. 경어체로 자연스럽게 작성
2. '학생이', 'OO가', '자녀분이' 등 주어 없이 행동이나 성장 내용부터 서술
3. 편지 인사말, 제목, 번호, 글자수 설명, 분석 문구를 출력하지 않음
4. 특정 과목명, 점수, 등수, 기관명, 상호명을 출력하지 않음
5. 줄바꿈 없이 하나의 문단으로 작성
6. 입력된 키워드는 방학 조언 영역으로 사용하고 관찰 사실처럼 꾸며 쓰지 않음
7. 학교생활을 성실하게 수행했다는 일반적이고 따뜻한 평가에서 시작
8. 한 학기 또는 한 해 동안 학교생활을 성실하게 수행한 내용은 과거 경어체(~했습니다, ~였습니다, ~보였습니다, ~돋보였습니다)로 작성
9. 방학 동안 가정에서 지도할 내용은 권유형 경어체(~바랍니다, ~주시기 바랍니다)로 작성
10. 학업 계획, 건강한 생활 리듬, 친구와의 배려 있는 관계, 가족과의 대화나 지지 중 최소 세 가지 이상을 반드시 반영하되 독립 문장으로 나누지 말고 하나의 흐름으로 연결
11. 입력되지 않은 구체적인 활동, 실험, 탐구 주제, 수행 장면은 지어내지 않음
12. 문장 사이에는 "그 과정에서", "이어", "나아가", "이러한 흐름이" 같은 연결 흐름을 자연스럽게 사용하되 반복하지 않음
13. 추가 정보를 요청하지 말고 입력된 키워드만으로 완성
14. 같은 시작 표현과 같은 가정 지도 문장을 반복하지 않고 매번 다른 관점으로 작성
15. 마지막 문장은 반드시 완전한 경어체 문장과 마침표로 끝냄
16. '마지막으로', '끝으로', '마무리하며', '덧붙여', '추가로' 같은 마무리 접속어를 사용하지 않음
17. 오직 가정통신문 본문 텍스트만 출력`;
}

export async function fetchStream(bodyData) {
    const { prompt, additionalInstructions, model, targetChars, outputType = "record" } = bodyData;
    const localModel = model || DEFAULT_LOCAL_MODEL;
    const isLightweight = isLightweightModel(localModel);

    // 모델 유형에 따른 시스템 메시지 선택
    let systemMessage = outputType === "letter"
        ? getLetterSystemMessage()
        : isLightweight ? getLightweightSystemMessage() : getStandardSystemMessage();

    // 추가 지침은 시스템 메시지에도, user 프롬프트의 앞뒤에도 삽입 (Sandwich 기법)
    if (additionalInstructions) {
        systemMessage += `\n\n사용자 추가 규칙 (최우선 준수):\n${additionalInstructions}`;
    }

    // user 프롬프트에 추가 지침을 앞뒤로 감싸기
    let finalPrompt = prompt;
    if (additionalInstructions && additionalInstructions.trim()) {
        const prefix = `[최우선 규칙] 다음 규칙을 반드시 지켜서 작성하라: ${additionalInstructions}\n\n`;
        const suffix = `\n\n[다시 한번 강조] 위 본문 작성 시 반드시 적용할 규칙: ${additionalInstructions}`;
        finalPrompt = prefix + prompt + suffix;
    }

    // 1차 시도
    let content = await callOllamaAPI(systemMessage, finalPrompt, localModel, targetChars);

    if (!content.trim()) {
        throw new Error("AI 응답이 비어있습니다.");
    }

    // 완전한 문장으로 끝나는지 확인 → 아니면 재시도 (최대 2회)
    const MAX_RETRIES = 2;
    const endingInstruction = outputType === "letter"
        ? "학교생활을 성실하게 수행했다는 일반적인 평가를 '~했습니다.', '~였습니다.', '~돋보였습니다.' 같은 과거 경어체로 쓰고, 입력된 키워드는 방학 조언 영역으로만 자연스럽게 연결하세요. 가정 지도 내용은 '~바랍니다.' 같은 권유형 경어체와 마침표로 끝내세요."
        : "반드시 '~함.', '~음.', '~임.' 등 종결어미와 마침표로 끝내세요.";

    for (let retry = 0; retry < MAX_RETRIES; retry++) {
        if (endsWithCompleteSentence(content, outputType)) {
            break; // 완전한 문장으로 끝남 → OK
        }

        console.log(`[재시도 ${retry + 1}/${MAX_RETRIES}] 문장이 불완전하게 끝남: "...${content.slice(-30)}"`);

        // 재시도: 원래 조건을 유지한 채 이전 결과를 완전한 문장으로 보정
        const retryPrompt = `다음 텍스트는 문장이 중간에 끊겼습니다. 아래 원래 작성 조건을 유지하면서 핵심 내용만 남겨 ${targetChars}자 이하의 완전한 문장으로 다시 작성하세요. ${endingInstruction} 줄바꿈 없이 오직 본문만 출력하세요.

[원래 작성 조건]
${finalPrompt}

[불완전한 텍스트]
${content}`;

        const retryContent = await callOllamaAPI(systemMessage, retryPrompt, localModel, targetChars);

        if (retryContent.trim() && endsWithCompleteSentence(retryContent, outputType)) {
            content = retryContent;
            console.log(`[재시도 성공] 완전한 문장으로 수정됨`);
            break;
        } else if (retryContent.trim()) {
            content = retryContent;
        }
    }

    return content;
}
