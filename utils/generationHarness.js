import {
    cleanMetaInfo,
    getByteTargetVisibleRange,
    getExpansionFrameworkGuideline,
    getMinimumTargetChars,
    getUtf8ByteLength,
    truncateToCompleteSentence,
} from "./textProcessor.js";

const RECORD_ENDINGS = "함|음|임|됨|봄|옴|줌|춤|움|늠|름|남|냄|김|킴|짐|님|감|침|보임|드러남|나타남|돋보임|지님|뛰어남";
const RECORD_SENTENCE_BOUNDARY_ENDINGS = `${RECORD_ENDINGS}|다|요|까|니`;
const LETTER_ENDINGS = "습니다|합니다|입니다|됩니다|바랍니다|드립니다|좋겠습니다|필요합니다|응원합니다";
const RECORD_ENDING_PATTERN = new RegExp(`(?:${RECORD_ENDINGS})\\.\\s*$`);
const LETTER_ENDING_PATTERN = new RegExp(`(?:${LETTER_ENDINGS})\\.\\s*$`);

const RECORD_SUBJECT_PATTERN = /(?:^|\s)(학생은|이 학생은|해당 학생은|학생이|OO는|OO가)\s*/;
const LETTER_SUBJECT_PATTERN = /(?:^|\s)(학생은|학생이|OO가|OO는|자녀분이|자녀가)\s*/;

const PAST_TENSE_PATTERN = /(?:했|하였|였|되었|보였|시켰)(?:음|으며|으나|지만|고|던|다고|다는|기에|어|습니다|다)/;
const SUMMARY_CLOSING_PATTERN = /(^|[.!?]\s*)(이러한|이를 통해|이와 같이|앞으로|향후|결과적으로|종합적으로|요약하면|결론적으로|모든 활동에서|각 활동에서|모든 상황에서)\s*/;
const COMMON_CLOSING_TRANSITION_PATTERN = /(^|[.!?]\s*)(마지막으로|끝으로|마무리하며|덧붙여|추가로)\s*/;
const META_TEXT_PATTERN = /(글자수\s*[:：]?|\d+\s*(?:[bB][yY][tT][eE]|바이트)|분량\s*초과|마지막\s*문장\s*줄임|검증\s*포인트|Why-How-What-Learn|구조를\s*적용해\s*확장|(^|[\r\n])\s*분석\s*[:：]|다음은|작성한\s*내용|본문은|키워드가\s*입력되지|입력해\s*주시면|알려주시면|완성해\s*드리겠습니다|작성해\s*드리겠습니다|즉시\s*작성|※\s*주의|시스템\s*오류|재작성\s*요청|사용자\s*추가\s*지침|지침\s*충돌)/;
const LIST_OR_TITLE_PATTERN = /(^|\n)\s*(?:[-*]|[0-9]+[.)])\s+/;
const RECORD_GRADE_LABEL_PATTERN = /(?:활동\s*\d+\s*)?[\[(]\s*[A-E]\s*[\])]|(?:^|[\s"'“”‘’])(?:[A-E]\s*(?:등급|급)|등급\s*[A-E])(?=$|[\s,.!?)]|[가-힣])/;
const RECORD_GRADE_LABEL_GLOBAL_PATTERN = /(?:활동\s*\d+\s*)?[\[(]\s*[A-E]\s*[\])]|(?:^|[\s"'“”‘’])(?:[A-E]\s*(?:등급|급)|등급\s*[A-E])(?=$|[\s,.!?)]|[가-힣])/g;
const LETTER_DIRECT_ADVICE_PATTERN = /(?:해\s*보세요|보세요|하세요|하십시오)/;
const SENTENCE_SPACING_PATTERN = /[!?]|\s+\.|\. {2,}|(?<!\.)\.(?=\S)/;
const RECORD_MISSING_PERIOD_PATTERN = new RegExp(`(?:${RECORD_SENTENCE_BOUNDARY_ENDINGS})(?![.!?])\\s+(?=[가-힣A-Za-z0-9"'“”‘’(])`);
const LETTER_MISSING_PERIOD_PATTERN = new RegExp(`(?:${LETTER_ENDINGS})(?![.!?])\\s+(?=[가-힣A-Za-z0-9"'“”‘’(])`);
const RECORD_MISSING_PERIOD_GLOBAL_PATTERN = new RegExp(`(${RECORD_SENTENCE_BOUNDARY_ENDINGS})(?![.!?])\\s+(?=[가-힣A-Za-z0-9"'“”‘’(])`, "g");
const LETTER_MISSING_PERIOD_GLOBAL_PATTERN = new RegExp(`(${LETTER_ENDINGS})(?![.!?])\\s+(?=[가-힣A-Za-z0-9"'“”‘’(])`, "g");
const MAX_CHARS = 650;
const NON_BLOCKING_GENERATION_ISSUE_CODES = new Set(["under_min_chars", "under_min_bytes"]);
const NON_BLOCKING_LETTER_ISSUE_CODES = new Set(["under_min_chars", "under_min_bytes"]);
const LETTER_ADVICE_DOMAIN_PATTERNS = [
    { name: "학업", pattern: /(학업|학습|배움|공부|계획)/ },
    { name: "건강", pattern: /(건강|생활\s*리듬|휴식|몸과\s*마음|신체\s*리듬)/ },
    { name: "친구관계", pattern: /(친구|또래|관계|배려|존중|경청|협력)/ },
    { name: "가족관계", pattern: /(가족|가정|대화|지지|격려|관심)/ },
];

const ISSUE_LABELS = {
    empty: "응답이 비어 있음",
    over_target_chars: "글자수 제한 초과",
    line_break: "줄바꿈 포함",
    forbidden_subject: "금지 주어 포함",
    forbidden_term: "출력 금지 용어 포함",
    under_min_chars: "목표 글자수 미달",
    under_min_bytes: "목표 byte 미달",
    over_target_bytes: "byte 제한 초과",
    past_tense: "과거형 표현 포함",
    summary_closing: "요약/마무리 표현 포함",
    meta_text: "메타 설명 포함",
    list_or_title: "목록/제목 형식 포함",
    incomplete_sentence: "문장 종결 불완전",
    sentence_spacing: "문장 마침표/띄어쓰기 오류",
    grade_label: "등급 기호 출력",
    direct_advice: "직접 지시형 표현 포함",
    missing_required_term: "필수 설정 용어 누락",
    missing_required_content: "필수 활동 또는 성취 표현 누락",
    banned_term: "설정과 충돌하는 용어 포함",
    missing_advice_domain: "방학 조언 영역 부족",
};

function clampTargetChars(targetChars) {
    const numeric = Number(targetChars);
    if (!Number.isFinite(numeric)) return MAX_CHARS;
    return Math.min(Math.max(Math.floor(numeric), 1), MAX_CHARS);
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSpaces(text) {
    return String(text || "")
        .replace(/\s*\r?\n+\s*/g, " ")
        .replace(/[ \t]+/g, " ")
        .trim();
}

function getMissingPeriodPattern(mode) {
    return mode === "letter" ? LETTER_MISSING_PERIOD_PATTERN : RECORD_MISSING_PERIOD_PATTERN;
}

function getMissingPeriodGlobalPattern(mode) {
    return mode === "letter" ? LETTER_MISSING_PERIOD_GLOBAL_PATTERN : RECORD_MISSING_PERIOD_GLOBAL_PATTERN;
}

function hasSentenceSpacingIssue(text, mode) {
    const source = String(text || "").trim();
    return SENTENCE_SPACING_PATTERN.test(source) || getMissingPeriodPattern(mode).test(source);
}

function formatSentenceSpacing(text, mode = "record") {
    let result = normalizeSpaces(text)
        .replace(/[!?]/g, ".")
        .replace(getMissingPeriodGlobalPattern(mode), "$1. ")
        .replace(/\s+\./g, ".")
        .replace(/\.{2,}/g, ".")
        .replace(/\.\s*/g, ". ")
        .trim();

    if (result && !result.endsWith(".")) {
        result += ".";
    }

    return result;
}

function addIssue(issues, code, detail = "") {
    issues.push({
        code,
        message: ISSUE_LABELS[code] || code,
        detail,
    });
}

function hasCompleteEnding(text, mode) {
    const trimmed = String(text || "").trim();
    if (!trimmed) return false;
    if (mode === "letter") {
        return LETTER_ENDING_PATTERN.test(trimmed);
    }
    return RECORD_ENDING_PATTERN.test(trimmed);
}

function hasOnlyNonBlockingGenerationIssues(issues, mode = "record") {
    const nonBlockingIssueCodes = mode === "letter"
        ? NON_BLOCKING_LETTER_ISSUE_CODES
        : NON_BLOCKING_GENERATION_ISSUE_CODES;
    return issues.length > 0 && issues.every((issue) => nonBlockingIssueCodes.has(issue.code));
}

function getForbiddenTerms(forbiddenTerms) {
    return (forbiddenTerms || [])
        .map((term) => String(term || "").trim())
        .filter((term) => term.length >= 2);
}

function getRuleTerms(terms) {
    return (terms || [])
        .map((term) => String(term || "").trim())
        .filter((term) => term.length > 0);
}

function getRequiredContentGroups(groups) {
    return (groups || [])
        .map((group) => ({
            label: String(group?.label || "필수 내용").trim(),
            terms: getRuleTerms(group?.terms),
        }))
        .filter((group) => group.terms.length > 0);
}

function getObjectParticle(term) {
    const lastCharacter = Array.from(String(term || "").trim()).at(-1) || "";
    const code = lastCharacter.charCodeAt(0);
    const hasFinalConsonant = code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0;
    return hasFinalConsonant ? "을" : "를";
}

function applyRequiredTerms(text, requiredTerms, mode) {
    let result = normalizeSpaces(text);
    const missingTerms = getMissingRequiredTerms(result, requiredTerms);

    for (const term of missingTerms) {
        if (mode === "record") {
            result = `${term}${getObjectParticle(term)} 바탕으로 ${result}`.trim();
            continue;
        }

        if (term === "여름방학" && /방학/.test(result)) {
            result = result.replace(/방학/, "여름방학");
        } else if (term === "겨울방학" && /방학/.test(result)) {
            result = result.replace(/방학/, "겨울방학");
        } else if (term === "여름방학" || term === "겨울방학") {
            result = `${result} ${term} 동안 학업과 건강의 균형을 살펴봐 주시기 바랍니다.`;
        } else if (term === "가족 대화") {
            result = result
                .replace(/가족과의\s*대화/g, "가족 대화")
                .replace(/가족과\s*대화/g, "가족 대화");
            if (!result.includes(term)) {
                result = `${result} 가족 대화 시간을 마련해 서로의 생각을 나눌 수 있도록 관심을 부탁드립니다.`;
            }
        } else {
            result = `${result} ${term}${getObjectParticle(term)} 생활 속에서 이어 갈 수 있도록 살펴봐 주시기 바랍니다.`;
        }
    }

    return normalizeSpaces(result);
}

function getMissingAdviceDomains(text) {
    return LETTER_ADVICE_DOMAIN_PATTERNS
        .filter(({ pattern }) => !pattern.test(text))
        .map(({ name }) => name);
}

export function validateGeneratedText(text, options = {}) {
    const {
        forbiddenTerms = [],
        maxTargetBytes = 0,
        minTargetBytes = 0,
        minTargetChars = 0,
        mode = "record",
        targetChars = 490,
        requiredTerms = [],
        bannedTerms = [],
        requiredAdviceDomains = false,
        requiredContentGroups = [],
    } = options;
    const source = String(text || "");
    const trimmed = source.trim();
    const issues = [];
    const maxAllowed = clampTargetChars(targetChars);

    if (!trimmed) {
        addIssue(issues, "empty");
        return { ok: false, issues };
    }

    if (trimmed.length > maxAllowed) {
        addIssue(issues, "over_target_chars", `${trimmed.length}/${maxAllowed}자`);
    }

    const minAllowed = Math.max(0, Math.min(Math.floor(Number(minTargetChars) || 0), maxAllowed));
    if (minAllowed > 0 && trimmed.length < minAllowed) {
        addIssue(issues, "under_min_chars", `${trimmed.length}/${minAllowed}자`);
    }

    const minAllowedBytes = Math.max(0, Math.floor(Number(minTargetBytes) || 0));
    const maxAllowedBytes = Math.max(0, Math.floor(Number(maxTargetBytes) || 0));
    const byteLength = getUtf8ByteLength(trimmed);
    if (maxAllowedBytes > 0 && byteLength > maxAllowedBytes) {
        addIssue(issues, "over_target_bytes", `${byteLength}/${maxAllowedBytes}byte`);
    }
    if (minAllowedBytes > 0 && byteLength < minAllowedBytes) {
        addIssue(issues, "under_min_bytes", `${byteLength}/${minAllowedBytes}byte`);
    }

    if (/[\r\n]/.test(source)) {
        addIssue(issues, "line_break");
    }

    const subjectPattern = mode === "letter" ? LETTER_SUBJECT_PATTERN : RECORD_SUBJECT_PATTERN;
    if (subjectPattern.test(trimmed)) {
        addIssue(issues, "forbidden_subject");
    }

    for (const term of getForbiddenTerms(forbiddenTerms)) {
        if (trimmed.includes(term)) {
            addIssue(issues, "forbidden_term", term);
        }
    }

    for (const term of getRuleTerms(requiredTerms)) {
        if (!trimmed.includes(term)) {
            addIssue(issues, "missing_required_term", term);
        }
    }


    for (const group of getRequiredContentGroups(requiredContentGroups)) {
        if (!group.terms.some((term) => trimmed.includes(term))) {
            addIssue(issues, "missing_required_content", `${group.label}: ${group.terms.join(" / ")}`);
        }
    }

    for (const term of getRuleTerms(bannedTerms)) {
        if (trimmed.includes(term)) {
            addIssue(issues, "banned_term", term);
        }
    }

    if (mode === "letter" && requiredAdviceDomains) {
        const missingAdviceDomains = getMissingAdviceDomains(trimmed);
        if (missingAdviceDomains.length > 0) {
            addIssue(issues, "missing_advice_domain", missingAdviceDomains.join(", "));
        }
    }

    if (mode === "record" && PAST_TENSE_PATTERN.test(trimmed)) {
        addIssue(issues, "past_tense");
    }

    if (mode === "record" && RECORD_GRADE_LABEL_PATTERN.test(trimmed)) {
        addIssue(issues, "grade_label");
    }

    if (mode === "letter" && LETTER_DIRECT_ADVICE_PATTERN.test(trimmed)) {
        addIssue(issues, "direct_advice");
    }

    if (hasSentenceSpacingIssue(trimmed, mode)) {
        addIssue(issues, "sentence_spacing");
    }

    if ((mode === "record" && SUMMARY_CLOSING_PATTERN.test(trimmed)) || COMMON_CLOSING_TRANSITION_PATTERN.test(trimmed)) {
        addIssue(issues, "summary_closing");
    }

    if (META_TEXT_PATTERN.test(trimmed)) {
        addIssue(issues, "meta_text");
    }

    if (LIST_OR_TITLE_PATTERN.test(source)) {
        addIssue(issues, "list_or_title");
    }

    if (!hasCompleteEnding(trimmed, mode)) {
        addIssue(issues, "incomplete_sentence");
    }

    return {
        ok: issues.length === 0,
        issues,
    };
}

export function buildRepairPrompt({ text, issues, sourcePrompt = "", targetChars, maxTargetBytes = 0, minTargetBytes = 0, minTargetChars = 0, mode = "record", forbiddenTerms = [], requiredTerms = [], requiredContentGroups = [], bannedTerms = [], preserveTextOnLengthRepair = false }) {
    const maxAllowed = clampTargetChars(targetChars);
    const minAllowed = Math.max(0, Math.min(Math.floor(Number(minTargetChars) || 0), maxAllowed));
    const minAllowedBytes = Math.max(0, Math.floor(Number(minTargetBytes) || 0));
    const maxAllowedBytes = Math.max(0, Math.floor(Number(maxTargetBytes) || 0));
    const currentBytes = getUtf8ByteLength(text);
    const missingBytes = Math.max(0, minAllowedBytes - currentBytes);
    const issueCodes = new Set((issues || []).map((issue) => issue.code));
    const isLengthShortfall = issueCodes.has("under_min_bytes") || issueCodes.has("under_min_chars");
    const visibleRange = getByteTargetVisibleRange(maxAllowed, minAllowedBytes);
    const byteShortfallText = minAllowedBytes > 0 && missingBytes > 0
        ? `\n[Byte shortfall]\n- Current bytes: ${currentBytes}byte\n- Missing bytes: ${missingBytes}byte\n- Write ${visibleRange.min}-${visibleRange.max} Korean visible characters for the ${maxAllowedBytes || maxAllowed}byte setting.\n- Add enough concrete Korean content while staying under ${maxAllowedBytes || maxAllowed}byte.\n`
        : "";
    const issueText = `${(issues || [])
        .map((issue) => `- ${issue.message}${issue.detail ? `: ${issue.detail}` : ""}`)
        .join("\n")}${byteShortfallText}`;
    const forbiddenText = getForbiddenTerms(forbiddenTerms).length
        ? `\n- 다음 용어는 출력하지 않음: ${getForbiddenTerms(forbiddenTerms).join(", ")}`
        : "";
    const requiredText = getRuleTerms(requiredTerms).length
        ? `\n- 다음 설정 용어는 반드시 포함함: ${getRuleTerms(requiredTerms).join(", ")}`
        : "";
    const requiredContentText = getRequiredContentGroups(requiredContentGroups).length
        ? `\n- 다음 각 항목에서 슬래시(/)로 구분된 표현 중 하나 이상을 반드시 포함함: ${getRequiredContentGroups(requiredContentGroups).map((group) => `${group.label}(${group.terms.join(" / ")})`).join(", ")}`
        : "";
    const bannedText = getRuleTerms(bannedTerms).length
        ? `\n- 다음 설정 충돌 용어는 절대 포함하지 않음: ${getRuleTerms(bannedTerms).join(", ")}`
        : "";
    const expansionFramework = getExpansionFrameworkGuideline();
    const endingInstruction = mode === "letter"
        ? "- 경어체 문장으로 작성하고 '~습니다.', '~합니다.', '~바랍니다.'처럼 완전한 문장으로 끝냄"
        : "- 현재형 명사 종결어미(~함, ~음, ~임, ~보임, ~드러남)와 마침표로 끝냄";
    const modeSpecificInstruction = mode === "letter"
        ? "\n- '해보세요', '보세요', '하세요', '하십시오' 같은 직접 지시형 표현을 사용하지 않고 '~바랍니다.', '~주시기 바랍니다.', '~부탁드립니다.'로 정중하게 씀"
        : "\n- A/B/C/D/E, [A], (A), A등급, 활동1[A] 같은 등급 기호와 라벨은 내부 기준일 뿐이며 본문에 출력하지 않음";
    const sentenceSpacingInstruction = "\n- 문장이 끝나면 반드시 마침표(.)를 찍고 한 칸 띄움. 마지막 문장은 마침표(.)를 찍고 바로 종료";

    const hasMissingRequiredContent = issueCodes.has("missing_required_content");
    const shouldPreserveShortfallText = preserveTextOnLengthRepair
        && isLengthShortfall
        && !hasMissingRequiredContent;
    const shortfallRewriteInstruction = shouldPreserveShortfallText
        ? `기존 본문은 시스템이 유지합니다. 기존 본문을 다시 출력하거나 요약하지 말고, 핵심 키워드의 다른 관찰 관점과 성취 수준을 담아 뒤에 추가할 새 문장만 반환하세요.`
        : hasMissingRequiredContent
            ? "누락된 활동이 뒤에서 잘리지 않도록 기존 글을 그대로 이어 붙이지 말고, 모든 필수 활동에 분량을 균등하게 나누어 전체 본문을 다시 작성하세요."
            : "의미는 유지하되 규칙에 맞게 다시 작성하세요.";
    const expansionRules = preserveTextOnLengthRepair
        ? `- 분량이 부족하면 핵심 키워드의 의미 범위 안에서 동기, 수행 과정, 사고 수준, 참여 태도, 피드백 반영을 자연스럽게 창작·보완하고 성취 수준을 구체화함
- 같은 활동을 서로 다른 관찰 관점으로 풀어 여러 문장으로 전개하고 표현과 문장 구조를 반복하지 않음
- 입력된 활동의 동기, 수행 과정, 관찰 가능한 결과, 성장 단서를 자연스럽게 연결함
- 입력에 없는 작품명, 수상, 기관, 점수, 수치, 도구, 실험 결과 같은 검증 불가능한 새 사실은 지어내지 않음`
        : `- 분량이 부족하면 입력 활동의 과정, 근거, 태도, 변화, 구체적 수행 장면을 더 촘촘하게 풀어 씀
- 입력된 활동의 동기, 수행 과정, 관찰 가능한 결과, 성장 단서를 자연스럽게 연결함
- 입력 핵심어 범위에서 수행 과정, 사고 수준, 참여 태도, 피드백 반영을 자연스럽게 창작·보완함
- 입력에 없는 작품명, 수상, 기관, 점수, 수치, 도구, 실험 결과 같은 검증 불가능한 새 사실은 지어내지 않음`;

    return `아래 글은 내부 규칙 검증에서 실패했습니다. ${shortfallRewriteInstruction}

[규칙 위반]
${issueText || "- 규칙 위반"}

[수정 규칙]
- ${minAllowed > 0 ? `${minAllowed}자 이상 ${maxAllowed}자 이하로 작성` : `${maxAllowed}자 이하로 작성`}
- ${maxAllowedBytes > 0 && minAllowedBytes > 0 ? `${minAllowedBytes}byte 이상 ${maxAllowedBytes}byte 이하를 반드시 맞춤` : minAllowedBytes > 0 ? `${minAllowedBytes}byte 이상을 반드시 채움` : "선택한 글자수 제한에 충분히 가깝게 작성"}
${shouldPreserveShortfallText ? "- 기존 본문과 겹치지 않는 새 관찰 문장만 작성해 부족한 분량을 보충함" : ""}
${expansionRules}
- 원래 작성 조건에 개인별 활동 내용이 있으면 그 수행, 역할, 관찰 단서를 우선 활용해 구체화함
- 줄바꿈 없이 하나의 문단으로만 작성
- 제목, 번호, 분석, 글자수 설명 없이 본문만 출력
- 지침 충돌을 설명하지 않고 '주의', '시스템 오류', '재작성 요청', '사용자 추가 지침' 같은 메타 문구를 출력하지 않음
- '마지막으로', '끝으로', '마무리하며', '덧붙여', '추가로' 같은 마무리 접속어를 사용하지 않음
${endingInstruction}${sentenceSpacingInstruction}${modeSpecificInstruction}${forbiddenText}${requiredText}${requiredContentText}${bannedText}

${expansionFramework}

[원래 작성 조건]
${sourcePrompt || "(원래 작성 조건 없음)"}

[수정할 글]
${text}`;
}

function truncateToMaxBytes(text, maxTargetBytes) {
    const maxAllowedBytes = Math.max(0, Math.floor(Number(maxTargetBytes) || 0));
    if (!maxAllowedBytes || getUtf8ByteLength(text) <= maxAllowedBytes) return text;

    const sentences = String(text || "")
        .split(/(?<=[.!?])\s+/)
        .map((sentence) => sentence.trim())
        .filter(Boolean);
    let result = "";
    for (const sentence of sentences) {
        const candidate = result ? `${result} ${sentence}` : sentence;
        if (getUtf8ByteLength(candidate) <= maxAllowedBytes) {
            result = candidate;
        } else {
            break;
        }
    }
    if (result) return result.trim();

    let truncated = String(text || "").trim();
    while (truncated && getUtf8ByteLength(truncated) > maxAllowedBytes) {
        truncated = truncated.slice(0, -1).trimEnd();
    }
    const lastSpaceIndex = truncated.lastIndexOf(" ");
    if (lastSpaceIndex > truncated.length * 0.7) {
        truncated = truncated.slice(0, lastSpaceIndex).replace(/[,\s]+$/, "");
    }
    return truncated.replace(/[.!?,\s]+$/, "") + ".";
}

export function finalizeGeneratedText(text, targetChars, maxTargetBytes = 0, mode = "record", options = {}) {
    const sanitizeOptions = { ...options, mode };
    const normalized = sanitizeByRules(cleanMetaInfo(text || ""), sanitizeOptions);
    const cleaned = sanitizeByRules(formatSentenceSpacing(normalized, mode), sanitizeOptions);
    const truncated = truncateToMaxBytes(truncateToCompleteSentence(cleaned, targetChars), maxTargetBytes);
    const formatted = formatSentenceSpacing(truncated, mode);
    const maxAllowed = clampTargetChars(targetChars);
    const maxAllowedBytes = Math.max(0, Math.floor(Number(maxTargetBytes) || 0));
    const fitsChars = formatted.length <= maxAllowed;
    const fitsBytes = !maxAllowedBytes || getUtf8ByteLength(formatted) <= maxAllowedBytes;
    if (fitsChars && fitsBytes) {
        return formatted;
    }
    return formatSentenceSpacing(
        truncateToMaxBytes(truncateToCompleteSentence(formatted, targetChars), maxTargetBytes),
        mode,
    );
}

function sanitizeByRules(text, options = {}) {
    const {
        bannedTerms = [],
        forbiddenTerms = [],
        mode = "record",
        requiredTerms = [],
        stripExpandedGradeLabels = false,
    } = options;
    let result = normalizeSpaces(text);

    const subjectPattern = mode === "letter"
        ? /(^|\s)(학생은|학생이|OO가|OO는|자녀분이|자녀가)\s*/g
        : /(^|\s)(학생은|이 학생은|해당 학생은|학생이|OO는|OO가)\s*/g;
    result = result.replace(subjectPattern, "$1");

    for (const term of getForbiddenTerms(forbiddenTerms)) {
        result = result.replace(new RegExp(escapeRegExp(term), "g"), "").replace(/\s{2,}/g, " ");
    }

    for (const term of getRuleTerms(bannedTerms)) {
        result = result
            .replace(new RegExp(`${escapeRegExp(term)}(?:을|를|은|는|이|가)?`, "g"), "")
            .replace(/\s{2,}/g, " ");
    }

    if (mode === "record") {
        result = result
            .replace(RECORD_GRADE_LABEL_GLOBAL_PATTERN, "")
            .replace(stripExpandedGradeLabels ? /(^|\s)[A-E]\s*성취\s*수준(?:에\s*따라|을\s*적용해|으로)?\s*/g : /$^/, "$1")
            .replace(/(^|\s)(수행|참여|준비|조정)(?=\s+(?!(?:결과|과정|기간|내용|능력|단계|방법|모습|방식|시|장면|전|중|태도|후))[가-힣]|[.!?]|$)/g, "$1$2함")
            .replace(/(^|\s)(강화|구성|분류|분석|발전|발표|비교|수행|조사|조정|제안|점검|정리|제작|준비|증대|증진|참여|탐구|토의|향상|확산)(?=[.!?]?$)/g, "$1$2함")
            .replace(/드러낸다(?=\.|\s+[가-힣])/g, "드러냄")
            .replace(/보여준다(?=\.|\s+[가-힣])/g, "보여줌")
            .replace(/나타난다(?=\.|\s+[가-힣])/g, "나타남")
            .replace(/보인다(?=\.|\s+[가-힣])/g, "보임")
            .replace(/([가-힣]+)한다(?=\.|\s+[가-힣])/g, "$1함")
            .replace(/([가-힣]+)된다(?=\.|\s+[가-힣])/g, "$1됨")
            .replace(/([가-힣]+)있다(?=\.|\s+[가-힣])/g, "$1있음")
            .replace(/([가-힣]+)이다(?=\.|\s+[가-힣])/g, "$1임")
            .replace(/시켰으나/g, "시키나")
            .replace(/시켰으며/g, "시키며")
            .replace(/시켰지만/g, "시키지만")
            .replace(/시켰고/g, "시키고")
            .replace(/되었으나/g, "되나")
            .replace(/되었으며/g, "되며")
            .replace(/되었지만/g, "되지만")
            .replace(/되었고/g, "되고")
            .replace(/보였으나/g, "보이나")
            .replace(/보였으며/g, "보이며")
            .replace(/보였지만/g, "보이지만")
            .replace(/보였고/g, "보이고")
            .replace(/하였으나/g, "하나")
            .replace(/하였으며/g, "하며")
            .replace(/하였지만/g, "하지만")
            .replace(/하였고/g, "하고")
            .replace(/했으나/g, "하나")
            .replace(/했으며/g, "하며")
            .replace(/했지만/g, "하지만")
            .replace(/했고/g, "하고")
            .replace(/하였음|했음|했습니다|하였습니다/g, "함")
            .replace(/되었음|되었습니다/g, "됨")
            .replace(/보였음|보였습니다/g, "보임")
            .replace(/였음/g, "임");
    } else if (mode === "letter") {
        result = result
            .replace(/해\s*보세요/g, "해 주시기 바랍니다")
            .replace(/보세요/g, "주시기 바랍니다")
            .replace(/하세요/g, "해 주시기 바랍니다")
            .replace(/하십시오/g, "해 주시기 바랍니다");
    }

    result = applyRequiredTerms(result, requiredTerms, mode);

    const sentences = splitCompleteSentences(result);
    if (sentences.length > 1) {
        result = sentences
            .filter((sentence) => !META_TEXT_PATTERN.test(sentence))
            .filter((sentence) => mode !== "record" || !SUMMARY_CLOSING_PATTERN.test(sentence))
            .filter((sentence) => !COMMON_CLOSING_TRANSITION_PATTERN.test(sentence))
            .filter((sentence, index, allSentences) => allSentences.indexOf(sentence) === index)
            .join(" ");
    } else {
        result = result.replace(COMMON_CLOSING_TRANSITION_PATTERN, "$1");
        if (mode === "record") {
            result = result.replace(SUMMARY_CLOSING_PATTERN, "$1");
        }
    }

    return normalizeSpaces(result);
}

function getMissingRequiredTerms(text, requiredTerms = []) {
    const source = String(text || "");
    return getRuleTerms(requiredTerms).filter((term) => !source.includes(term));
}

function splitCompleteSentences(text) {
    return String(text || "")
        .split(/(?<=[.!?])\s+/)
        .map((sentence) => sentence.trim())
        .filter(Boolean);
}

function normalizedSeed(text) {
    return normalizeSpaces(text).slice(0, 160);
}

function hashText(text) {
    let hash = 0;
    for (const char of String(text || "")) {
        hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    }
    return hash;
}

function pickLetterSentence(sentences, seed) {
    if (!sentences.length) return "";
    return sentences[hashText(seed) % sentences.length];
}

function orderLetterSentences(sentences, seed) {
    const offset = sentences.length ? hashText(seed) % sentences.length : 0;
    return [...sentences.slice(offset), ...sentences.slice(0, offset)];
}

function appendLetterSettingTerms(text, missingTerms, targetChars, maxTargetBytes = 0) {
    if (!missingTerms.length) return text;

    const hasSummer = missingTerms.includes("여름방학");
    const hasWinter = missingTerms.includes("겨울방학");
    const hasNewSemester = missingTerms.includes("새 학기");
    const periodText = hasWinter
        ? `겨울방학${hasNewSemester ? "과 새 학기 준비 과정" : ""}에서`
        : hasSummer ? "여름방학 동안" : "방학 동안";
    const settingSentence = pickLetterSentence([
        `${periodText} 학업 계획과 건강한 생활 리듬을 함께 살피며 안정적인 방학을 보낼 수 있도록 도와주시기 바랍니다.`,
        `${periodText} 가족과 대화하는 시간을 마련하고 친구들과도 배려 있는 관계를 이어 갈 수 있도록 관심을 부탁드립니다.`,
        `${periodText} 무리하지 않는 학습 습관과 충분한 휴식을 균형 있게 챙길 수 있도록 살펴봐 주시기 바랍니다.`,
        `${periodText} 학교에서 보여준 성실함이 방학 생활 속 작은 실천으로 이어질 수 있도록 격려해 주시기 바랍니다.`,
        `${periodText} 마음을 편안히 돌보고 주변 사람들과 안정적인 관계를 이어 갈 수 있도록 함께 살펴봐 주시기 바랍니다.`,
    ], `${normalizedSeed(text)}:${periodText}`);
    const maxAllowed = clampTargetChars(targetChars);
    const maxAllowedBytes = Math.max(0, Math.floor(Number(maxTargetBytes) || 0));
    const normalized = normalizeSpaces(text);
    let baseSentences = splitCompleteSentences(normalized);
    if (!baseSentences.length && normalized) {
        baseSentences = [normalized.replace(/[.!?,\s]+$/, "") + "."];
    }

    while (baseSentences.length > 1) {
        const candidate = `${baseSentences.join(" ")} ${settingSentence}`.trim();
        const fitsChars = candidate.length <= maxAllowed;
        const fitsBytes = !maxAllowedBytes || getUtf8ByteLength(candidate) <= maxAllowedBytes;
        if (fitsChars && fitsBytes) return candidate;
        baseSentences.pop();
    }

    const candidate = `${baseSentences.join(" ")} ${settingSentence}`.trim();
    if (candidate.length <= maxAllowed && (!maxAllowedBytes || getUtf8ByteLength(candidate) <= maxAllowedBytes)) {
        return candidate;
    }

    return settingSentence;
}

function expandLetterToMinimum(text, options = {}) {
    const {
        maxTargetBytes = 0,
        minTargetBytes = 0,
        minTargetChars = 0,
        targetChars = 490,
    } = options;
    const minAllowedBytes = Math.max(0, Math.floor(Number(minTargetBytes) || 0));
    const minAllowedChars = Math.max(0, Math.floor(Number(minTargetChars) || 0));
    const maxAllowedBytes = Math.max(0, Math.floor(Number(maxTargetBytes) || 0));
    const maxAllowedChars = clampTargetChars(targetChars);
    const additions = orderLetterSentences([
        " 방학 동안에도 가벼운 학습 계획과 충분한 휴식을 함께 챙기며 생활 리듬을 안정적으로 유지해 주시기 바랍니다.",
        " 가족과 대화하는 시간을 통해 마음을 편안히 돌보고, 친구들과도 서로 배려하는 관계를 이어 갈 수 있도록 살펴봐 주시기 바랍니다.",
        " 무리한 목표보다는 꾸준히 실천할 수 있는 약속을 정해 학업과 건강을 함께 챙겨 주시기 바랍니다.",
        " 다음 생활을 준비하는 과정에서 자신감을 잃지 않도록 작은 성취를 인정하며 따뜻하게 격려해 주시기 바랍니다.",
        " 가정에서도 규칙적인 생활과 긍정적인 대화를 통해 안정적인 방학을 보낼 수 있도록 도와주시기 바랍니다.",
        " 충분한 휴식으로 건강을 살펴봐 주시기 바랍니다.",
        " 가족의 따뜻한 격려와 관심을 부탁드립니다.",
    ], text);
    let result = normalizeSpaces(text);

    for (const addition of additions) {
        const needsMoreBytes = minAllowedBytes > 0 && getUtf8ByteLength(result) < minAllowedBytes;
        const needsMoreChars = minAllowedChars > 0 && result.length < minAllowedChars;
        if (!needsMoreBytes && !needsMoreChars) break;

        const candidate = `${result}${addition}`.trim();
        const fitsBytes = !maxAllowedBytes || getUtf8ByteLength(candidate) <= maxAllowedBytes;
        const fitsChars = candidate.length <= maxAllowedChars;
        if (!fitsBytes || !fitsChars) continue;
        result = candidate;
    }

    return result;
}

function appendLetterAdviceDomains(text, options = {}) {
    if (!options.requiredAdviceDomains) return text;

    const maxAllowedBytes = Math.max(0, Math.floor(Number(options.maxTargetBytes) || 0));
    const maxAllowedChars = clampTargetChars(options.targetChars || 490);
    const missingDomains = getMissingAdviceDomains(text);
    if (missingDomains.length === 0) return text;

    const ruleTerms = getRuleTerms(options.requiredTerms);
    const periodText = ruleTerms.includes("겨울방학")
        ? `겨울방학${ruleTerms.includes("새 학기") ? "과 새 학기 준비 과정" : ""}에서는`
        : ruleTerms.includes("여름방학") ? "여름방학 동안에는" : "방학 동안에는";
    const needsRelationshipAdvice = missingDomains.includes("친구관계") || missingDomains.includes("가족관계");
    const combinedAdvice = needsRelationshipAdvice
        ? ` ${periodText} 무리하지 않는 학업 계획과 충분한 휴식을 함께 챙기고, 가족과 대화하며 친구들과도 배려 있는 관계를 이어 갈 수 있도록 살펴봐 주시기 바랍니다.`
        : ` ${periodText} 무리하지 않는 학업 계획과 충분한 휴식을 함께 챙기며 건강한 생활 리듬을 유지할 수 있도록 살펴봐 주시기 바랍니다.`;
    const additions = [
        combinedAdvice,
        " 가족과 대화하는 시간을 통해 마음을 편안히 돌보고, 친구들과도 서로 배려하는 관계를 이어 갈 수 있도록 살펴봐 주시기 바랍니다.",
        " 가정에서도 작은 실천을 인정하며 격려해 주시면 건강한 생활과 긍정적인 관계를 함께 이어 가는 데 도움이 될 것입니다.",
    ];

    let result = normalizeSpaces(text);
    for (const addition of additions) {
        if (getMissingAdviceDomains(result).length === 0) break;
        const candidate = `${result}${addition}`.trim();
        const fitsBytes = !maxAllowedBytes || getUtf8ByteLength(candidate) <= maxAllowedBytes;
        const fitsChars = candidate.length <= maxAllowedChars;
        if (fitsBytes && fitsChars) {
            result = candidate;
        }
    }

    if (getMissingAdviceDomains(result).length > 0) {
        const sentences = splitCompleteSentences(result);
        while (sentences.length > 0) {
            sentences.pop();
            const candidate = `${sentences.join(" ")}${combinedAdvice}`.trim();
            const fitsBytes = !maxAllowedBytes || getUtf8ByteLength(candidate) <= maxAllowedBytes;
            const fitsChars = candidate.length <= maxAllowedChars;
            if (fitsBytes && fitsChars && getMissingAdviceDomains(candidate).length === 0) {
                return candidate;
            }
        }
        const fallback = combinedAdvice.trim();
        if ((!maxAllowedBytes || getUtf8ByteLength(fallback) <= maxAllowedBytes) && fallback.length <= maxAllowedChars) {
            return fallback;
        }
    }

    return result;
}

function repairLetterRequiredTerms(text, options = {}) {
    const { mode = "record", requiredTerms = [], targetChars = 490, maxTargetBytes = 0 } = options;
    if (mode !== "letter") return text;

    const ruleTerms = getRuleTerms(requiredTerms);
    const missingTerms = getMissingRequiredTerms(text, ruleTerms);
    if (!missingTerms.length) return text;

    return appendLetterSettingTerms(text, ruleTerms, targetChars, maxTargetBytes);
}

function repairLetterText(text, options = {}) {
    if (options.mode !== "letter") return text;
    return appendLetterAdviceDomains(
        expandLetterToMinimum(
            repairLetterRequiredTerms(text, options),
            options,
        ),
        options,
    );
}

export async function generateWithSilentValidation({
    prompt,
    generateOnce,
    acceptLengthOnlyResult = true,
    maxTargetBytes,
    minTargetBytes,
    minTargetChars,
    targetChars = 490,
    forbiddenTerms = [],
    requiredTerms = [],
    bannedTerms = [],
    mode = "record",
    maxRepairAttempts = 1,
    requiredAdviceDomains = false,
    requiredContentGroups = [],
    preserveTextOnLengthRepair = false,
    stripExpandedGradeLabels = false,
}) {
    if (typeof generateOnce !== "function") {
        throw new Error("generateOnce 함수가 필요합니다.");
    }

    let nextPrompt = prompt;
    let lastText = "";
    let lastValidation = null;
    const hasByteTarget = Number(minTargetBytes) > 0 || Number(maxTargetBytes) > 0;
    const effectiveMinTargetChars = minTargetChars ?? (hasByteTarget ? 0 : getMinimumTargetChars(targetChars));

    for (let attempt = 0; attempt <= maxRepairAttempts; attempt += 1) {
        const rawText = await generateOnce(nextPrompt, {
            attempt,
            previousText: lastText,
            previousValidation: lastValidation,
        });
        const shouldAppendLengthRepair = preserveTextOnLengthRepair
            && attempt > 0
            && lastText
            && hasOnlyNonBlockingGenerationIssues(lastValidation?.issues || [], mode);
        const generatedText = shouldAppendLengthRepair ? `${lastText} ${rawText}` : rawText;
        let text = finalizeGeneratedText(generatedText, targetChars, maxTargetBytes, mode, {
            bannedTerms,
            requiredTerms,
            stripExpandedGradeLabels,
        });
        if (mode === "letter") {
            text = finalizeGeneratedText(
                repairLetterText(text, {
                    maxTargetBytes,
                    minTargetBytes,
                    minTargetChars: effectiveMinTargetChars,
                    mode,
                    requiredAdviceDomains,
                    requiredTerms,
                    targetChars,
                }),
                targetChars,
                maxTargetBytes,
                mode,
                { bannedTerms, requiredTerms },
            );
        }
        const validation = validateGeneratedText(text, {
            forbiddenTerms,
            maxTargetBytes,
            minTargetBytes,
            minTargetChars: effectiveMinTargetChars,
            mode,
            targetChars,
            requiredTerms,
            bannedTerms,
            requiredAdviceDomains,
            requiredContentGroups,
            preserveTextOnLengthRepair,
        });

        if (validation.ok) {
            return {
                text,
                attempts: attempt + 1,
                repaired: attempt > 0,
                validation,
            };
        }

        if (acceptLengthOnlyResult && hasOnlyNonBlockingGenerationIssues(validation.issues, mode)) {
            return {
                text,
                attempts: attempt + 1,
                repaired: attempt > 0,
                validation,
                acceptedWithLengthWarning: true,
            };
        }

        lastText = text;
        lastValidation = validation;
        nextPrompt = buildRepairPrompt({
            text,
            issues: validation.issues,
            sourcePrompt: prompt,
            maxTargetBytes,
            minTargetBytes,
            minTargetChars: effectiveMinTargetChars,
            targetChars,
            mode,
            forbiddenTerms,
            requiredTerms,
            requiredContentGroups,
            bannedTerms,
            preserveTextOnLengthRepair,
            requiredAdviceDomains,
        });
    }

    const sanitized = finalizeGeneratedText(
        repairLetterText(
            sanitizeByRules(lastText, { forbiddenTerms, mode }),
            { mode, requiredTerms, targetChars, maxTargetBytes, minTargetBytes, minTargetChars: effectiveMinTargetChars, requiredAdviceDomains },
        ),
        targetChars,
        maxTargetBytes,
        mode,
        { bannedTerms, forbiddenTerms, requiredTerms },
    );
    const validation = validateGeneratedText(sanitized, {
        forbiddenTerms,
        maxTargetBytes,
        minTargetBytes,
        minTargetChars: effectiveMinTargetChars,
        mode,
        targetChars,
        requiredTerms,
        bannedTerms,
        requiredAdviceDomains,
        requiredContentGroups,
    });

    if (validation.ok) {
        return {
            text: sanitized,
            attempts: maxRepairAttempts + 1,
            repaired: maxRepairAttempts > 0,
            validation,
        };
    }

    if (acceptLengthOnlyResult && hasOnlyNonBlockingGenerationIssues(validation.issues, mode)) {
        return {
            text: sanitized,
            attempts: maxRepairAttempts + 1,
            repaired: maxRepairAttempts > 0,
            validation,
            acceptedWithLengthWarning: true,
        };
    }

    if (sanitized) {
        return {
            text: sanitized,
            attempts: maxRepairAttempts + 1,
            repaired: maxRepairAttempts > 0,
            validation,
            acceptedWithValidationWarning: true,
        };
    }

    const issueText = validation.issues
        .map((issue) => `${issue.message}${issue.detail ? `(${issue.detail})` : ""}`)
        .join(", ");
    const error = new Error(`내부 검증 실패: ${issueText || "규칙 미충족"}`);
    error.validation = validation;
    error.text = sanitized;
    error.attempts = maxRepairAttempts + 1;
    throw error;
}
