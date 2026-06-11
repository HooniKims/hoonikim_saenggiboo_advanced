# LM Studio API 재사용 가이드

이 문서는 다른 프로젝트에서 현재 LM Studio 원격 호출 설정을 재사용할 때 필요한 값과 코드 규칙만 정리한 것입니다. 현재 구현 기준 파일은 [`utils/streamFetch.js`](./utils/streamFetch.js)입니다.

## 핵심 설정

```env
LMSTUDIO_API_URL=https://lm.alluser.site
LMSTUDIO_API_KEY=현재 프로젝트 .env의 LMSTUDIO_API_KEY 값을 복사
LMSTUDIO_GEMMA_E4B_MODEL=google/gemma-4-e4b
LMSTUDIO_GEMMA_E2B_MODEL=google/gemma-4-e2b
LMSTUDIO_GEMMA_12B_MODEL=gemma-4-12b-it
LMSTUDIO_GEMMA_26B_MODEL=gemma-4-26b-a4b-it
```

- 엔드포인트는 OpenAI 호환 `/v1/chat/completions`를 사용합니다.
- 인증 헤더는 `Authorization: Bearer ...`가 아니라 `X-API-Key`입니다.
- 브라우저/프록시 CORS 통과를 위해 `Origin`과 `Referer`를 `https://lm.alluser.site` 기준으로 함께 보냅니다.
- API 키는 저장소 코드에 새로 하드코딩하지 말고 각 프로젝트의 `.env`에서 관리합니다.

## 모델 목록

```javascript
export const AVAILABLE_MODELS = [
    {
        id: "gemma4:e4b",
        name: "Gemma 4 E4B",
        description: "빠름, 품질 보통",
        provider: "local",
        apiModel: "google/gemma-4-e4b",
    },
    {
        id: "gemma4:e2b",
        name: "Gemma 4 E2B",
        description: "가장 빠름, 간단 작업용",
        provider: "local",
        apiModel: "google/gemma-4-e2b",
    },
    {
        id: "lmstudio:gemma-4-12b-it",
        name: "Gemma 4 12B",
        description: "기본 모델, 속도와 품질 균형",
        provider: "local",
        apiModel: "gemma-4-12b-it",
    },
    {
        id: "lmstudio:gemma-4-26b-a4b-it-q4ks",
        name: "Gemma 4 26B Q4",
        description: "가장 느림, 품질 높음",
        provider: "local",
        apiModel: "gemma-4-26b-a4b-it",
    },
];

export const DEFAULT_LOCAL_MODEL = "lmstudio:gemma-4-12b-it";
```

드롭다운 라벨은 다음 규칙을 사용합니다.

```javascript
export function getModelOptionLabel(model) {
    return `${model.name} - ${model.description}`;
}
```

## 요청 헤더

```javascript
export function getLocalLLMRequestHeaders({ apiUrl, apiKey }) {
    const origin = apiUrl || "https://lm.alluser.site";
    const headers = {
        "Content-Type": "application/json",
        Origin: origin,
        Referer: `${origin}/`,
    };
    if (apiKey) {
        headers["X-API-Key"] = apiKey;
    }
    return headers;
}
```

## 요청 Body

```javascript
{
    model: modelConfig.apiModel,
    messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: userPrompt },
    ],
    temperature: 0.7,
    max_tokens: maxTokens,
    reasoning_effort: "none",
    stream: false,
}
```

권장 `max_tokens` 기준은 다음과 같습니다.

```javascript
if (modelId === "gemma4:e4b") return Math.max(3072, baseTokens);
if (modelId.startsWith("lmstudio:") && modelId.includes("12b")) return Math.max(4096, baseTokens);
if (modelId.startsWith("lmstudio:") && modelId.includes("26b")) return Math.max(4096, baseTokens);
return baseTokens;
```

## curl 점검 예시

```bash
curl https://lm.alluser.site/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Origin: https://lm.alluser.site" \
  -H "Referer: https://lm.alluser.site/" \
  -H "X-API-Key: <LMSTUDIO_API_KEY>" \
  -d '{"model":"gemma-4-12b-it","messages":[{"role":"user","content":"hi"}],"reasoning_effort":"none","stream":false}'
```

## 다른 프로젝트에 옮길 때 체크리스트

1. `.env`에 `LMSTUDIO_API_URL`, `LMSTUDIO_API_KEY`, 모델 identifier 4개를 추가합니다.
2. 모델 선택 UI에는 위 4개 모델만 노출합니다.
3. 실제 요청의 `model` 값은 UI의 `id`가 아니라 `apiModel` 값을 보냅니다.
4. 요청 URL은 `${LMSTUDIO_API_URL}/v1/chat/completions`로 조립합니다.
5. 요청 헤더에 `Content-Type`, `Origin`, `Referer`, `X-API-Key`를 함께 넣습니다.
6. 12B는 기본 모델로 두고 12B/26B에는 최소 `4096 max_tokens`를 적용합니다.
7. 연결 실패가 나면 앱 코드보다 먼저 LM Studio Local Server의 LAN 접근 허용, NPM/upstream 연결, `/v1/models` 응답을 확인합니다.
