const DEFAULT_LETTER_KEYWORDS = "학업, 건강, 친구관계, 가족관계";

const LETTER_VARIATION_PROFILES = [
    {
        focus: "성실한 학교생활을 바탕으로 학업 계획과 생활 리듬 조언",
        opening: "꾸준하고 차분한 학교생활",
        home: "무리 없는 학습 계획과 건강한 생활 리듬",
    },
    {
        focus: "한 학기 동안의 노력과 성장 가능성을 언급하며 균형 있는 방학 생활 조언",
        opening: "맡은 일을 성실히 해낸 태도",
        home: "휴식과 배움의 균형",
    },
    {
        focus: "책임감 있는 생활을 인정하고 친구관계와 가족 대화 조언",
        opening: "책임감과 안정적인 참여",
        home: "배려 있는 관계와 가족 대화",
    },
    {
        focus: "꾸준한 태도를 칭찬한 뒤 건강과 정서적 안정 조언",
        opening: "생활 속 성실함",
        home: "충분한 휴식과 마음 돌봄",
    },
    {
        focus: "차분한 생활 태도를 격려하고 새 학기 준비와 자기관리 조언",
        opening: "자신의 역할을 해내려는 자세",
        home: "새 학기 자신감과 자기관리",
    },
];

export function parseKeywordList(keywords) {
    return String(keywords || DEFAULT_LETTER_KEYWORDS)
        .split(",")
        .map((keyword) => keyword.trim())
        .filter(Boolean);
}

export function shuffleKeywordList(keywords, random = Math.random) {
    const shuffled = [...keywords];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

export function buildShuffledKeywordContext(keywords, random = Math.random) {
    const parsedKeywords = parseKeywordList(keywords);
    const shuffledKeywords = shuffleKeywordList(parsedKeywords, random);
    return `방학 조언 영역: ${shuffledKeywords.join(", ")}`;
}

export function selectLetterVariationProfile(random = Math.random) {
    const index = Math.min(
        LETTER_VARIATION_PROFILES.length - 1,
        Math.floor(random() * LETTER_VARIATION_PROFILES.length),
    );
    return LETTER_VARIATION_PROFILES[index];
}

export function buildLetterVariationInstruction(random = Math.random) {
    const profile = selectLetterVariationProfile(random);
    return [
        `이번 생성 방향: ${profile.focus}`,
        `시작 관점: ${profile.opening}`,
        `가정 연계 관점: ${profile.home}`,
        "같은 시작과 같은 가정 지도 문장을 반복하지 말 것",
    ].join("\n");
}

export function getLetterRequiredTerms({ season }) {
    return season === "winter"
        ? ["겨울방학", "새 학기"]
        : ["여름방학"];
}

export function getLetterBannedTerms(season) {
    return season === "winter"
        ? ["여름방학"]
        : ["겨울방학", "새 학기"];
}

export function buildLetterRuleTermInstruction({ season, keywords }) {
    return [
        `학기 구분 필수 용어: ${getLetterRequiredTerms({ season }).join(", ")}`,
        `조언 영역 활용: ${parseKeywordList(keywords).join(", ")}`,
        `금지 용어: ${getLetterBannedTerms(season).join(", ")}`,
        "조언 영역은 관찰 사실처럼 꾸며 쓰지 말고 방학 중 가정에서 살필 방향에 자연스럽게 반영할 것",
    ].join("\n");
}
