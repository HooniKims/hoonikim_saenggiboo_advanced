import { test, expect } from "@playwright/test";

// 로컬 LLM(LM Studio) 응답을 모킹해 실제 외부 API 호출 없이
// 브라우저 안에서 생성 → 검증 → 후처리 파이프라인 전체를 검사한다.
// 아래 본문은 900byte 설정(765~900byte)에 맞고, 과거 오탐을 일으켰던
// 단어(공감/마다/글감/흐름/다음)를 문장 중간에 포함한다.
const CANNED_RECORD =
    "학급 내 갈등 상황에서 친구의 입장에 공감 어린 태도로 귀 기울이며 문제의 원인을 차분히 살펴봄. "
    + "모둠 활동에서는 역할 분배 기준을 스스로 제안하고 구성원마다 지닌 강점이 드러나도록 과제를 조정하는 배려심이 돋보임. "
    + "학급 문집 제작 과정에서 글감 선택부터 편집까지 전체 흐름 속에서 맡은 부분을 꼼꼼하게 점검하며 완성도를 높임. "
    + "독서 시간에는 읽은 내용을 정리하고 다음 읽기 계획을 세우는 자기주도적 습관이 나타남. "
    + "교실 정리와 학습 준비물 관리 등 학급의 궂은일을 앞장서서 챙기며 공동체에 대한 책임 의식을 실천함. "
    + "매체마다 다른 정보 전달 방식을 비교하는 활동에서 자료를 신중하게 검토하며 균형 잡힌 판단력을 보여줌.";

const PAGES = [
    { path: "/", name: "홈" },
    { path: "/behavior", name: "행동특성" },
    { path: "/club", name: "동아리" },
    { path: "/gwasetuk", name: "과세특" },
    { path: "/letter", name: "가정통신문" },
    { path: "/privacy", name: "개인정보" },
];

function collectPageErrors(page) {
    const errors = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
        if (message.type() !== "error") return;
        const text = message.text();
        // 외부 리소스 로드 실패(파비콘, 폰트 등)와 React DevTools 안내는 스모크 대상이 아님
        if (/Failed to load resource|net::ERR|Download the React DevTools/i.test(text)) return;
        errors.push(`console: ${text}`);
    });
    return errors;
}

for (const { path, name } of PAGES) {
    test(`${name}(${path}) 페이지가 오류 없이 렌더링됨`, async ({ page }) => {
        const errors = collectPageErrors(page);

        const response = await page.goto(path, { waitUntil: "networkidle" });
        expect(response.ok()).toBeTruthy();
        await expect(page.locator("body")).toBeVisible();

        expect(errors, errors.join("\n")).toEqual([]);
    });
}

test("행발 생성 파이프라인이 문장 중간에 마침표를 삽입하지 않음", async ({ page }) => {
    const errors = collectPageErrors(page);
    const externalCalls = [];
    const dialogs = [];

    page.on("dialog", async (dialog) => {
        dialogs.push(dialog.message());
        await dialog.accept();
    });

    // 로컬 LLM(LM Studio) 모킹: OpenAI 호환 chat.completions 응답
    await page.route("**://lm.alluser.site/**", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                choices: [
                    { message: { content: CANNED_RECORD }, finish_reason: "stop" },
                ],
            }),
        });
    });

    // 유료/외부 API 라우트는 호출 자체가 없어야 함 (호출되면 기록 후 실패 응답)
    for (const apiPath of ["**/api/upstage-generate", "**/api/nvidia-generate", "**/api/openai-generate", "**/api/generate"]) {
        await page.route(apiPath, async (route) => {
            externalCalls.push(route.request().url());
            await route.fulfill({
                status: 500,
                contentType: "application/json",
                body: JSON.stringify({ error: "blocked by e2e mock" }),
            });
        });
    }
    await page.route("**/api/search-context", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ context: "", query: "" }),
        });
    });

    await page.goto("/behavior", { waitUntil: "networkidle" });

    await page.getByPlaceholder("예: 배려심이 깊고 친화력이 있음").first()
        .fill("배려심이 깊고 친화력이 있음, 학급 문집 제작 참여");
    await page.getByRole("button", { name: "개별 생성" }).first().click();

    const resultBox = page.getByPlaceholder("AI 생성 결과가 여기에 표시됩니다.").first();
    await expect(resultBox).toHaveValue(/살펴봄\./, { timeout: 60_000 });

    const result = await resultBox.inputValue();

    // 핵심 회귀 검사: 일반 명사 뒤에 마침표가 삽입되면 안 됨
    expect(result).not.toMatch(/(?:다음|매체마다|문단마다|글감|흐름|공감)\./);
    // 모킹한 본문이 훼손 없이 그대로 수용되어야 함
    expect(result).toBe(CANNED_RECORD);

    expect(externalCalls, `외부 생성 API 호출 발생: ${externalCalls.join(", ")}`).toEqual([]);
    expect(dialogs.filter((message) => message.includes("실패")), dialogs.join("\n")).toEqual([]);
    expect(errors, errors.join("\n")).toEqual([]);
});
