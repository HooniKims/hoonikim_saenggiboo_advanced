// 생성 결과에서 같은 내용을 다른 말로 되풀이한 문장 쌍을 서버(Solar Mini)에 묻는다.
// 돌려주는 pairs는 [앞 문장 번호, 뒤 문장 번호](1부터)이며, 뒤 문장은 생성 흐름에서 지운다.
// 판정 실패는 반복 없음으로 처리해 생성 흐름을 막지 않는다.
export async function fetchRepetitionCheck(text) {
    try {
        const response = await fetch("/api/repetition-check", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
        });
        if (!response.ok) return { pairs: [], detail: "" };
        const data = await response.json();
        return {
            pairs: Array.isArray(data?.pairs) ? data.pairs : [],
            detail: typeof data?.detail === "string" ? data.detail : "",
        };
    } catch {
        return { pairs: [], detail: "" };
    }
}
