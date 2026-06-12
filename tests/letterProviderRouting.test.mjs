import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { POST as postNvidiaGenerate } from "../app/api/nvidia-generate/route.js";
import { POST as postOpenAIGenerate } from "../app/api/openai-generate/route.js";
import { POST as postLocalGenerate } from "../app/api/generate/route.js";
import { fetchNvidiaCompletion } from "../utils/nvidiaFetch.js";
import { fetchOpenAICompletion } from "../utils/openAIFetch.js";

function jsonRequest(body) {
    return new Request("http://localhost/api/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

test("OpenAI letter requests use a dedicated polite letter system message", async () => {
    const originalFetch = global.fetch;
    const calls = [];
    global.fetch = async (url, options) => {
        calls.push({ url, options });
        return new Response(JSON.stringify({
            choices: [{ message: { content: "학교 생활에 성실하게 참여하며 가정에서도 꾸준한 격려를 부탁드립니다." } }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    try {
        const response = await postOpenAIGenerate(jsonRequest({
            prompt: "가정통신문을 작성하세요.",
            apiKey: "test-key",
            targetChars: 120,
            model: "gpt-5.4-nano",
            outputType: "letter",
        }));

        assert.equal(response.status, 200);
        const requestBody = JSON.parse(calls[0].options.body);
        const systemMessage = requestBody.messages[0].content;
        assert.match(systemMessage, /학기말 가정통신문 작성 전문가/);
        assert.match(systemMessage, /경어체/);
        assert.match(systemMessage, /학교생활을 성실하게 수행한 내용은 과거 경어체/);
        assert.match(systemMessage, /입력된 키워드는 방학 조언 영역으로 사용/);
        assert.match(systemMessage, /학업 계획, 건강한 생활 리듬, 친구와의 배려 있는 관계, 가족과의 대화나 지지 중 최소 세 가지 이상/);
        assert.match(systemMessage, /입력되지 않은 구체적인 활동, 실험, 탐구 주제, 수행 장면은 지어내지 않음/);
        assert.match(systemMessage, /추가 정보를 요청하지 말고 입력된 키워드만으로 완성/);
        assert.doesNotMatch(systemMessage, /학교생활기록부와 가정통신문 작성을 도와줍니다/);
    } finally {
        global.fetch = originalFetch;
    }
});

test("NVIDIA letter requests use a dedicated polite letter system message", async () => {
    const originalFetch = global.fetch;
    const originalApiKey = process.env.NVIDIA_API_KEY;
    process.env.NVIDIA_API_KEY = "test-key";
    const calls = [];
    global.fetch = async (url, options) => {
        calls.push({ url, options });
        return new Response(JSON.stringify({
            choices: [{ message: { content: "한 해 동안 꾸준히 성장하며 새 학기를 차분히 준비하기 바랍니다." } }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    try {
        const response = await postNvidiaGenerate(jsonRequest({
            prompt: "겨울방학 가정통신문을 작성하세요.",
            targetChars: 120,
            model: "nvidia:google/gemma-4-31b-it",
            outputType: "letter",
        }));

        assert.equal(response.status, 200);
        const requestBody = JSON.parse(calls[0].options.body);
        const systemMessage = requestBody.messages[0].content;
        assert.match(systemMessage, /학기말 가정통신문 작성 전문가/);
        assert.match(systemMessage, /경어체/);
        assert.match(systemMessage, /학교생활을 성실하게 수행한 내용은 과거 경어체/);
        assert.match(systemMessage, /입력된 키워드는 방학 조언 영역으로 사용/);
        assert.match(systemMessage, /학업 계획, 건강한 생활 리듬, 친구와의 배려 있는 관계, 가족과의 대화나 지지 중 최소 세 가지 이상/);
        assert.match(systemMessage, /입력되지 않은 구체적인 활동, 실험, 탐구 주제, 수행 장면은 지어내지 않음/);
        assert.match(systemMessage, /추가 정보를 요청하지 말고 입력된 키워드만으로 완성/);
        assert.doesNotMatch(systemMessage, /학교생활기록부와 가정통신문 작성을 도와줍니다/);
    } finally {
        global.fetch = originalFetch;
        if (originalApiKey === undefined) {
            delete process.env.NVIDIA_API_KEY;
        } else {
            process.env.NVIDIA_API_KEY = originalApiKey;
        }
    }
});

test("local generate API uses lm.alluser.site and the dedicated letter system message", async () => {
    const originalFetch = global.fetch;
    const calls = [];
    global.fetch = async (url, options) => {
        calls.push({ url, options });
        return new Response(JSON.stringify({
            choices: [{ message: { content: "학업과 건강을 살피며 겨울방학 동안 가정에서 새 학기를 준비하기 바랍니다." } }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    try {
        const response = await postLocalGenerate(jsonRequest({
            prompt: "겨울방학 가정통신문을 작성하세요.",
            targetChars: 120,
            outputType: "letter",
        }));

        assert.equal(response.status, 200);
        assert.equal(calls[0].url, "https://lm.alluser.site/v1/chat/completions");
        assert.equal(calls[0].options.headers.Origin, "https://lm.alluser.site");
        assert.equal(calls[0].options.headers.Referer, "https://lm.alluser.site/");
        const requestBody = JSON.parse(calls[0].options.body);
        const systemMessage = requestBody.messages[0].content;
        assert.match(systemMessage, /학기말 가정통신문 작성 전문가/);
        assert.match(systemMessage, /경어체/);
        assert.match(systemMessage, /학교생활을 성실하게 수행한 내용은 과거 경어체/);
        assert.match(systemMessage, /입력된 키워드는 방학 조언 영역으로 사용/);
        assert.match(systemMessage, /학업 계획, 건강한 생활 리듬, 친구와의 배려 있는 관계, 가족과의 대화나 지지 중 최소 세 가지 이상/);
        assert.match(systemMessage, /입력되지 않은 구체적인 활동, 실험, 탐구 주제, 수행 장면은 지어내지 않음/);
        assert.match(systemMessage, /추가 정보를 요청하지 말고 입력된 키워드만으로 완성/);
    } finally {
        global.fetch = originalFetch;
    }
});

test("client provider helpers preserve letter output type in API requests", async () => {
    const originalFetch = global.fetch;
    const bodies = [];
    global.fetch = async (url, options) => {
        bodies.push({ url, body: JSON.parse(options.body) });
        return new Response(JSON.stringify({ result: "생성 결과입니다." }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    };

    try {
        await fetchOpenAICompletion({
            prompt: "가정통신문을 작성하세요.",
            apiKey: "test-key",
            targetChars: 120,
            model: "gpt-5.4-nano",
            outputType: "letter",
        });
        await fetchNvidiaCompletion({
            prompt: "가정통신문을 작성하세요.",
            targetChars: 120,
            model: "nvidia:google/gemma-4-31b-it",
            outputType: "letter",
        });

        assert.equal(bodies[0].url, "/api/openai-generate");
        assert.equal(bodies[0].body.outputType, "letter");
        assert.equal(bodies[1].url, "/api/nvidia-generate");
        assert.equal(bodies[1].body.outputType, "letter");
    } finally {
        global.fetch = originalFetch;
    }
});

test("letter page sends letter output type to external providers", () => {
    const source = readFileSync(new URL("../app/letter/page.js", import.meta.url), "utf8");

    assert.match(
        source,
        /fetchNvidiaCompletion\(\{\s*prompt:\s*nextPrompt,\s*targetChars,\s*model:\s*selectedModel,\s*outputType:\s*"letter"\s*\}\)/,
    );
    assert.match(
        source,
        /fetchOpenAICompletion\(\{\s*prompt:\s*nextPrompt,\s*apiKey:\s*appliedOpenAIKey,\s*targetChars,\s*model:\s*selectedOpenAIModel,\s*outputType:\s*"letter"\s*\}\)/,
    );
    assert.match(source, /requiredTerms:\s*getLetterRequiredTerms\(\{\s*season,\s*keywords\s*\}\)/);
    assert.match(source, /bannedTerms:\s*getLetterBannedTerms\(season\)/);
    assert.match(source, /requiredAdviceDomains:\s*true/);
    assert.match(source, /maxRepairAttempts:\s*2/);
    assert.match(source, /키워드는 목록처럼 나열하지 말고 문장 속에서 자연스럽게 풀어 쓸 것/);
    assert.match(source, /키워드\(학업, 건강, 교우관계 등\)는 관찰 사실이 아니라 방학 동안 가정에서 살필 조언 영역으로 사용할 것/);
    assert.match(source, /학교생활을 성실하게 잘 수행했다는 일반적인 뉘앙스로 시작하되 매번 표현을 다르게 할 것/);
    assert.match(source, /입력되지 않은 구체적인 활동, 실험, 탐구 주제, 수행 장면은 지어내지 말 것/);
    assert.match(source, /추가 정보를 요청하지 말고 입력된 키워드만으로 완성할 것/);
    assert.match(source, /학교에서 보여준 모습은 과거 경어체/);
    assert.doesNotMatch(source, /아래 필수 포함 용어/);
});
