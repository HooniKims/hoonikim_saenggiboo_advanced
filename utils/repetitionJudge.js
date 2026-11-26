// 같은 내용을 다른 말로 되풀이한 문장을 Solar Mini로 짚어 내는 판정 도우미.
// 서버 라우트(app/api/repetition-check)와 보정 스크립트가 함께 쓴다.

export const REPETITION_JUDGE_MODEL = "solar-mini-4-5-preview";
export const REPETITION_JUDGE_MIN_SENTENCES = 4;

export function splitJudgeSentences(text) {
    return String(text || "")
        .split(/(?<=[.!?])\s+/)
        .map((sentence) => sentence.trim())
        .filter(Boolean);
}

export function buildRepetitionJudgeMessages(sentences) {
    return [
        {
            role: "system",
            content: `학교생활기록부 문단에서 같은 내용을 다른 말로 되풀이한 문장을 찾으세요.
- 뒤 문장을 통째로 지워도 문단 전체의 정보가 거의 줄지 않을 만큼, 앞 문장과 같은 행동·결과·평가를 표현만 바꿔 다시 말한 경우만 반복입니다.
- 활동 이름이나 핵심어가 같다는 이유만으로 반복이 아닙니다. 활동을 소개한 뒤 그 활동의 과정이나 평가를 덧붙이는 문장도 반복이 아닙니다.
- 앞에 없던 새 행동, 방법, 결과, 변화, 평가가 하나라도 있으면 반복이 아닙니다.
- 확실한 경우만 고르고, 애매하면 고르지 마세요.
- JSON만 출력하세요: {"pairs": [[앞 문장 번호, 뒤 문장 번호]]}. 반복이 없으면 {"pairs": []}`,
        },
        {
            role: "user",
            content: sentences.map((sentence, index) => `${index + 1}. ${sentence}`).join("\n"),
        },
    ];
}

export function parseRepetitionPairs(content, sentenceCount) {
    const match = String(content || "").match(/\{[\s\S]*\}/);
    if (!match) return [];
    try {
        const pairs = JSON.parse(match[0])?.pairs;
        if (!Array.isArray(pairs)) return [];
        return pairs
            .map((pair) => (Array.isArray(pair) ? pair.map(Number) : []))
            .filter(([first, second]) => Number.isInteger(first) && Number.isInteger(second)
                && first >= 1 && second >= 1 && first <= sentenceCount && second <= sentenceCount && first !== second)
            .map(([first, second]) => [Math.min(first, second), Math.max(first, second)]);
    } catch {
        return [];
    }
}

export function describeRepetitionPairs(pairs, sentences) {
    return pairs
        .map(([first, second]) => `${second}번째 문장 '${sentences[second - 1].slice(0, 30)}…'이 ${first}번째 문장과 같은 내용을 되풀이함`)
        .join("; ");
}
