"use client";

import { getOpenAIModelLabel, OPENAI_MODELS } from "../utils/openAIFetch";

export default function OpenAIKeyControl({
    openAIKeyInput,
    setOpenAIKeyInput,
    applyOpenAIKey,
    clearOpenAIKey,
    isOpenAIKeyApplied,
    maskedOpenAIKey,
    selectedOpenAIModel,
    setSelectedOpenAIModel,
}) {
    return (
        <div className="flex flex-col gap-3">
            <div
                style={{
                    padding: "10px 12px",
                    border: "1px solid #bfdbfe",
                    borderRadius: "8px",
                    backgroundColor: "#eff6ff",
                    fontSize: "0.8rem",
                    color: "#1e40af",
                    lineHeight: 1.6,
                    wordBreak: "keep-all",
                    overflowWrap: "break-word",
                }}
            >
                <span style={{ display: "block" }}>
                    로컬AI 모델은 사용자가 몰리는 시간에는 생성이 느려지거나 오류가 발생할 수 있습니다.
                </span>
                <span style={{ display: "block" }}>
                    OpenAI API Key를 발급받아 적용하면 기다림 없이 쾌적하게 이용할 수 있습니다.
                </span>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">OpenAI 모델</label>
                <select
                    value={selectedOpenAIModel}
                    onChange={(e) => setSelectedOpenAIModel(e.target.value)}
                    className="form-select"
                >
                    {OPENAI_MODELS.map((model) => (
                        <option key={model.id} value={model.id}>{model.name}</option>
                    ))}
                </select>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">OpenAI API key</label>
                <div className="flex gap-2" style={{ flexWrap: "wrap" }}>
                    <input
                        type="password"
                        value={openAIKeyInput}
                        onChange={(e) => setOpenAIKeyInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") applyOpenAIKey();
                        }}
                        placeholder="sk-... 입력 후 적용"
                        className="form-input"
                        style={{ flex: "1 1 220px", minWidth: 0 }}
                        autoComplete="off"
                    />
                    <button
                        type="button"
                        onClick={applyOpenAIKey}
                        className="btn-primary"
                        style={{ padding: "0 16px", whiteSpace: "nowrap" }}
                    >
                        적용
                    </button>
                    {isOpenAIKeyApplied && (
                        <button
                            type="button"
                            onClick={clearOpenAIKey}
                            className="btn-secondary"
                            style={{ padding: "0 16px", whiteSpace: "nowrap" }}
                        >
                            해제
                        </button>
                    )}
                </div>
                <p style={{ fontSize: "0.78rem", color: isOpenAIKeyApplied ? "#2563eb" : "#6b7280", marginTop: "6px" }}>
                    {isOpenAIKeyApplied
                        ? `적용됨: ${maskedOpenAIKey} · AI 생성 시 ${getOpenAIModelLabel(selectedOpenAIModel)} 사용`
                        : "적용하지 않으면 로컬 LLM 모델로 생성합니다."}
                </p>
            </div>
        </div>
    );
}
