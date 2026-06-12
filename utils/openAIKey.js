"use client";

import { useEffect, useState } from "react";
import { DEFAULT_OPENAI_MODEL, normalizeOpenAIModel } from "./openAIFetch";

const OPENAI_API_KEY_STORAGE_KEY = "hoonikim_openai_api_key";
const OPENAI_MODEL_STORAGE_KEY = "hoonikim_openai_model";
const OPENAI_API_KEY_EVENT = "hoonikim-openai-api-key-updated";

function readStoredKey() {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(OPENAI_API_KEY_STORAGE_KEY) || "";
}

function readStoredModel() {
    if (typeof window === "undefined") return DEFAULT_OPENAI_MODEL;
    const storedModel = window.localStorage.getItem(OPENAI_MODEL_STORAGE_KEY);
    const normalizedModel = normalizeOpenAIModel(storedModel);
    if (storedModel !== normalizedModel) {
        window.localStorage.setItem(OPENAI_MODEL_STORAGE_KEY, normalizedModel);
    }
    return normalizedModel;
}

function notifyKeyUpdated() {
    window.dispatchEvent(new Event(OPENAI_API_KEY_EVENT));
}

export function maskOpenAIKey(apiKey) {
    if (!apiKey) return "";
    if (apiKey.length <= 12) return "적용됨";
    return `${apiKey.slice(0, 7)}...${apiKey.slice(-4)}`;
}

export function useOpenAIKey() {
    const [openAIKeyInput, setOpenAIKeyInput] = useState("");
    const [appliedOpenAIKey, setAppliedOpenAIKey] = useState("");
    const [selectedOpenAIModel, setSelectedOpenAIModelState] = useState(DEFAULT_OPENAI_MODEL);

    useEffect(() => {
        const syncSettings = () => {
            const storedKey = readStoredKey();
            const storedModel = readStoredModel();
            setAppliedOpenAIKey(storedKey);
            setOpenAIKeyInput(storedKey);
            setSelectedOpenAIModelState(storedModel);
        };

        syncSettings();
        window.addEventListener("storage", syncSettings);
        window.addEventListener(OPENAI_API_KEY_EVENT, syncSettings);

        return () => {
            window.removeEventListener("storage", syncSettings);
            window.removeEventListener(OPENAI_API_KEY_EVENT, syncSettings);
        };
    }, []);

    const setSelectedOpenAIModel = (modelId) => {
        const nextModel = normalizeOpenAIModel(modelId);
        window.localStorage.setItem(OPENAI_MODEL_STORAGE_KEY, nextModel);
        setSelectedOpenAIModelState(nextModel);
        notifyKeyUpdated();
    };

    const applyOpenAIKey = () => {
        const trimmedKey = openAIKeyInput.trim();
        if (!trimmedKey) {
            window.localStorage.removeItem(OPENAI_API_KEY_STORAGE_KEY);
            setAppliedOpenAIKey("");
            setOpenAIKeyInput("");
            notifyKeyUpdated();
            return;
        }

        window.localStorage.setItem(OPENAI_API_KEY_STORAGE_KEY, trimmedKey);
        setAppliedOpenAIKey(trimmedKey);
        setOpenAIKeyInput(trimmedKey);
        notifyKeyUpdated();
    };

    const clearOpenAIKey = () => {
        window.localStorage.removeItem(OPENAI_API_KEY_STORAGE_KEY);
        setAppliedOpenAIKey("");
        setOpenAIKeyInput("");
        notifyKeyUpdated();
    };

    return {
        openAIKeyInput,
        setOpenAIKeyInput,
        appliedOpenAIKey,
        selectedOpenAIModel,
        setSelectedOpenAIModel,
        applyOpenAIKey,
        clearOpenAIKey,
        isOpenAIKeyApplied: Boolean(appliedOpenAIKey),
        maskedOpenAIKey: maskOpenAIKey(appliedOpenAIKey),
    };
}
