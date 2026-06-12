/**
 * AI 생성 텍스트 후처리 유틸리티
 * - 선택한 글자수/byte 제한 절대 초과 불가
 * - 100자 같은 극소 글자수도 완전한 문장으로 마무리
 */

// byte 제한이 실제 기준이며, 글자수는 모델에게 분량을 유도하는 보조 기준입니다.
const MAX_CHARS = 650;
const MAX_BYTES = 1500;
const AVG_KOREAN_BYTES_WITH_SPACES = 2.55;

function clampTargetChars(targetChars) {
    const numeric = Number(targetChars);
    if (!Number.isFinite(numeric)) return MAX_CHARS;
    return Math.min(Math.max(Math.floor(numeric), 1), MAX_CHARS);
}

export function normalizeTargetChars(textLength, manualLength = "") {
    const byteLimit = normalizeTargetBytes(textLength, manualLength);
    return clampTargetChars(Math.ceil(byteLimit / AVG_KOREAN_BYTES_WITH_SPACES));
}

export function normalizeTargetBytes(textLength, manualLength = "") {
    if (textLength === "1500") return 1500;
    if (textLength === "1000") return 1000;
    if (textLength === "600") return 600;
    if (textLength === "manual" && String(manualLength || "").trim() === "") return MAX_BYTES;
    const numeric = Number(textLength === "manual" ? manualLength : textLength);
    if (!Number.isFinite(numeric)) return MAX_BYTES;
    return Math.min(Math.max(Math.floor(numeric), 1), MAX_BYTES);
}

export function getUtf8ByteLength(text) {
    const value = String(text || "");
    if (typeof TextEncoder !== "undefined") {
        return new TextEncoder().encode(value).length;
    }

    return Array.from(value).reduce((total, char) => {
        const codePoint = char.codePointAt(0);
        if (codePoint <= 0x7f) return total + 1;
        if (codePoint <= 0x7ff) return total + 2;
        if (codePoint <= 0xffff) return total + 3;
        return total + 4;
    }, 0);
}

/**
 * 글자수에 따른 동적 버퍼 비율 계산
 * 짧은 글자수일수록 더 많은 여유 공간 확보
 */
function getBufferRatio(targetChars) {
    return 0.85;
}

/**
 * AI에게 보낼 프롬프트용 글자수 계산
 * @param {number} userRequestedChars - 사용자가 요청한 글자수
 * @returns {number} AI에게 요청할 글자수
 */
export function getPromptCharLimit(userRequestedChars) {
    const targetChars = clampTargetChars(userRequestedChars);
    const bufferRatio = getBufferRatio(targetChars);
    return Math.floor(targetChars * bufferRatio);
}

export function getMinimumTargetChars(userRequestedChars) {
    const targetChars = clampTargetChars(userRequestedChars);
    return Math.floor(targetChars * 0.85);
}

export function getMinimumTargetBytes(byteLimit) {
    const numeric = Number(byteLimit);
    const normalizedBytes = Number.isFinite(numeric)
        ? Math.min(Math.max(Math.floor(numeric), 1), MAX_BYTES)
        : MAX_BYTES;
    return Math.floor(normalizedBytes * 0.85);
}

export function getMaxTokensForTargetChars(targetChars) {
    const cappedChars = clampTargetChars(targetChars);
    // 토큰 한도는 글자수 제한보다 넉넉하게 잡고, 최종 글자수는 후처리/검증에서 강제한다.
    return Math.max(512, Math.min(2048, Math.ceil(cappedChars * 3.4)));
}

export function getExpansionFrameworkGuideline() {
    return `<내용 확장 방식: Why-How-What-Learn>
- Why(동기): 입력된 활동에서 드러난 관심, 문제의식, 참여 이유를 짧게 드러냄
- How(과정): 조사, 토의, 발표, 제작, 실험, 피드백 반영 등 수행 과정을 구체화함
- What(결과): 완성한 산출물, 발표 내용, 정리한 근거, 변화한 행동 등 관찰 가능한 결과를 서술함
- Learn(성장): 태도, 사고력, 협업, 표현력, 자기주도성 등 성장 단서를 현재형으로 연결함
- 새 활동, 새 작품, 새 수상, 새 기관, 새 실험 결과를 지어내지 않고 입력된 활동의 단서만 확장함`;
}

/**
 * 글자수별 프롬프트 지침 생성
 * @param {number} targetChars - 목표 글자수
 * @returns {string} 프롬프트에 추가할 글자수 지침
 */
export function getCharacterGuideline(targetChars, targetBytes = 0, minTargetBytes = 0) {
    const promptLimit = getPromptCharLimit(targetChars);
    const maxAllowed = clampTargetChars(targetChars);
    const maxAllowedBytes = Number(targetBytes) > 0 ? Math.min(Math.floor(Number(targetBytes)), MAX_BYTES) : 0;
    const minAllowedBytes = Number(minTargetBytes) > 0 ? Math.floor(Number(minTargetBytes)) : 0;
    const expansionFramework = getExpansionFrameworkGuideline();

    if (maxAllowedBytes > 0) {
        return `
<분량 제한>
전체 byte: ${maxAllowedBytes}byte 이하 (초과 불가)
목표 byte: ${minAllowedBytes || Math.floor(maxAllowedBytes * 0.85)}byte ~ ${maxAllowedBytes}byte
Target visible length: write 430-500 Korean visible characters for the 1500byte setting.
작성 분량 참고: 한글 기준 약 ${promptLimit}자 안팎, 공백과 문장부호에 따라 달라질 수 있음

작성 방법:
1. 최종 출력은 선택한 byte 제한의 85% 이상을 목표로 충분히 구체적으로 작성
2. 분량이 부족하지 않도록 활동의 과정, 근거, 태도, 변화, 구체적 수행 장면을 촘촘하게 서술
3. 초과가 우려되면 마지막 문장 하나를 줄이되, 문장이 중간에 끊기지 않도록 작성
4. 모든 문장은 완전한 종결어미와 마침표로 끝냄
5. 줄바꿈 없이 하나의 문단으로 작성

${expansionFramework}
`;
    }

    if (targetChars <= 100) {
        return `
<글자수 제한>
전체 글자수: ${maxAllowed}자 이하 (공백 포함, 초과 불가)
목표: ${promptLimit}자 내외

작성 방법:
1. 2~3개의 온전한 문장으로 작성
2. 각 문장에 구체적인 활동 내용을 포함 (예: "~활동에서 ~하여 ~함.")
3. "깊이 있게 읽음." 같은 내용 없는 짧은 문장은 사용하지 않음
4. 모든 문장은 '~함.', '~음.', '~임.' 등 완전한 종결어미로 끝냄
5. 최종 출력은 ${maxAllowed}자 이하, 완전한 문장으로 끝냄

${expansionFramework}
`;
    } else if (targetChars <= 200) {
        return `
<글자수 제한>
전체 글자수: ${maxAllowed}자 이하 (공백 포함, 초과 불가)
목표: ${promptLimit}자 ~ ${maxAllowed}자

작성 방법:
1. 3~4개의 온전한 문장으로 작성
2. 각 문장에 구체적인 활동, 과정, 결과를 포함하여 의미 있게 서술
3. "깊이 있게 읽음.", "논리적으로 글을 씀." 같은 내용 없는 짧은 문장은 사용하지 않음
4. 문장 예시: "환경 문제에 대한 조사 활동에서 미세먼지의 원인과 대책을 분석하고 발표 자료를 체계적으로 구성함."
5. 모든 문장은 완전한 종결어미(~함, ~음, ~임)와 마침표로 끝냄
6. 최종 출력은 ${maxAllowed}자 이하, 완전한 문장으로 끝냄

${expansionFramework}
`;
    } else {
        return `
<글자수 제한>
전체 글자수: ${maxAllowed}자 이하 (공백 포함, 초과 불가)
목표: ${promptLimit}자 ~ ${maxAllowed}자

작성 방법:
1. ${maxAllowed}자 제한을 인지하고 계획적으로 작성
2. 초과하면 문장을 줄여서 다시 작성
3. 각 문장에 구체적인 활동, 과정, 결과를 포함하여 의미 있게 서술
4. 모든 문장은 완전한 종결어미로 끝냄. 마지막 문장이 중간에 끊기지 않도록 함
5. 최종 출력은 ${maxAllowed}자 이하, 완전한 문장으로 끝냄

${expansionFramework}
`;
    }
}

/**
 * AI 출력에서 메타 정보(글자수, 분석 내용 등) 제거
 * @param {string} text - AI 생성 텍스트
 * @returns {string} 정제된 텍스트
 */
export function cleanMetaInfo(text) {
    if (!text) return text;

    // 괄호 안의 메타 정보 제거: (자세한 내용 포함, 330자), (약 490자), (글자수: 330) 등
    let cleaned = text.replace(/\s*\([^)]*\d+자[^)]*\)/g, '');
    cleaned = cleaned.replace(/\s*\([^)]*글자[^)]*\)/g, '');
    cleaned = cleaned.replace(/\s*\([^)]*자세한[^)]*\)/g, '');
    cleaned = cleaned.replace(/\s*\([^)]*내용\s*포함[^)]*\)/g, '');

    // 끝부분의 메타 정보 제거: "--- 330자" 또는 "[330자]" 등
    cleaned = cleaned.replace(/\s*[-─]+\s*\d+자\s*$/g, '');
    cleaned = cleaned.replace(/\s*\[\d+자\]\s*$/g, '');
    cleaned = cleaned.replace(/\s*\d+자\s*$/g, '');

    // 분석/검증 관련 문구 제거
    cleaned = cleaned.replace(/\s*\[분석[^\]]*\]/g, '');
    cleaned = cleaned.replace(/\s*\[검증[^\]]*\]/g, '');

    return cleaned.trim();
}

/**
 * 문장이 완전한 한국어 종결어미로 끝나는지 확인
 * @param {string} text - 텍스트
 * @returns {boolean}
 */
function isCompleteSentence(text) {
    if (!text) return false;
    const trimmed = text.trim();
    // 한국어 종결 패턴: ~함, ~음, ~임, ~됨, ~봄, ~옴, ~다, ~요 + 마침표/느낌표/물음표
    return /(?:함|음|임|됨|봄|옴|줌|춤|움|늠|름|남|냄|김|짐|님|감|다|요|까|니|보임|드러남|나타남|돋보임|지님|뛰어남)[.!?]\s*$/.test(trimmed);
}

/**
 * 텍스트를 문장 단위로 분리
 * @param {string} text - 텍스트
 * @returns {string[]} 문장 배열
 */
function splitIntoSentences(text) {
    if (!text) return [];
    // 마침표, 느낌표, 물음표 뒤에서 분리 (단, 뒤에 공백이나 문자열 끝이 있을 때)
    return text.split(/(?<=[.!?])\s+/).filter(s => s.trim());
}

/**
 * 글자수 초과시 마지막 완전한 문장까지만 잘라내는 후처리 함수
 * @param {string} text - AI 생성 텍스트
 * @param {number} targetChars - 목표 글자수
 * @returns {string} 처리된 텍스트
 */
export function truncateToCompleteSentence(text, targetChars) {
    // 먼저 메타 정보 제거
    let cleaned = cleanMetaInfo(text);

    if (!cleaned) return '';

    // 절대 상한선 적용
    const maxAllowed = clampTargetChars(targetChars);

    // 이미 제한 내이고 완전한 문장으로 끝나면 그대로 반환
    if (cleaned.length <= maxAllowed && isCompleteSentence(cleaned)) {
        return cleaned.trim();
    }

    // 문장 단위로 분리
    const sentences = splitIntoSentences(cleaned);

    if (sentences.length === 0) {
        return cleaned.length <= maxAllowed ? cleaned.trim() : '';
    }

    let result = '';

    for (const sentence of sentences) {
        const trimmedSentence = sentence.trim();

        // 문장이 마침표로 끝나지 않으면 추가
        const completeSentence = trimmedSentence.endsWith('.') ||
            trimmedSentence.endsWith('!') ||
            trimmedSentence.endsWith('?')
            ? trimmedSentence
            : trimmedSentence + '.';

        const candidate = result + (result ? ' ' : '') + completeSentence;

        if (candidate.length <= maxAllowed) {
            result = candidate;
        } else {
            // 더 추가하면 초과 → 여기서 중단
            break;
        }
    }

    // 결과가 너무 짧으면 (목표의 50% 미만) 첫 문장이라도 확보
    const minAcceptable = maxAllowed * 0.5;
    if (result.length < minAcceptable && sentences.length > 0) {
        const firstSentence = sentences[0].trim();
        const completeFirst = firstSentence.endsWith('.') ||
            firstSentence.endsWith('!') ||
            firstSentence.endsWith('?')
            ? firstSentence
            : firstSentence + '.';

        if (completeFirst.length <= maxAllowed) {
            result = completeFirst;
        }
    }

    // 결과가 여전히 비어있으면 강제로 마지막 마침표까지만 자르기
    if (!result && cleaned.length > 0) {
        let truncated = cleaned.substring(0, maxAllowed);

        // 마지막 완전한 문장(마침표)까지 찾기
        const lastPeriodIndex = truncated.lastIndexOf('.');

        if (lastPeriodIndex > truncated.length * 0.5) {
            result = truncated.substring(0, lastPeriodIndex + 1);
        } else {
            // 마침표가 너무 앞에 있으면 종결어미 패턴으로 자르기
            const match = truncated.match(/.*(?:함|음|임|됨|봄|옴|줌|춤|움|늠|름|남|냄|김|짐|님|감|다|요|까|니|보임|드러남|나타남|돋보임|지님|뛰어남)/);
            if (match) {
                result = match[0] + '.';
            } else {
                // 최후의 수단: 그냥 자르고 마침표 추가
                const lastSpaceIndex = truncated.lastIndexOf(' ');
                if (lastSpaceIndex > truncated.length * 0.7) {
                    result = truncated.substring(0, lastSpaceIndex).replace(/[,\s]+$/, '') + '.';
                } else {
                    result = truncated.replace(/[,\s]+$/, '') + '.';
                }
            }
        }
    }

    return result.trim();
}

/**
 * 레거시 호환용: 기존 truncateToCharLimit 함수와 동일한 인터페이스 제공
 * @param {string} text - AI 생성 텍스트
 * @param {number} maxChars - 최대 글자수
 * @returns {string} 처리된 텍스트
 */
export function truncateToCharLimit(text, maxChars) {
    return truncateToCompleteSentence(text, maxChars);
}
