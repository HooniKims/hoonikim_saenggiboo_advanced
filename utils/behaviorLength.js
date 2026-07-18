import { getMinimumTargetBytes, normalizeTargetBytes, normalizeTargetChars } from "./textProcessor.js";

const MAX_BEHAVIOR_BYTES = 900;

export function getBehaviorLengthTargets(textLength, manualLength = "") {
    const targetBytes = Math.min(normalizeTargetBytes(textLength, manualLength), MAX_BEHAVIOR_BYTES);
    return {
        targetBytes,
        targetChars: normalizeTargetChars(String(targetBytes)),
        minTargetBytes: getMinimumTargetBytes(targetBytes),
    };
}
