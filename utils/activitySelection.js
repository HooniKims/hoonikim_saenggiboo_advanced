export function shouldSelectRandomFourActivities(additionalInstructions = "") {
    const normalized = String(additionalInstructions || "")
        .replace(/\s+/g, " ")
        .trim();

    if (!normalized) return false;

    const mentionsActivities = /활동/.test(normalized);
    const mentionsFour = /4\s*개/.test(normalized);
    const mentionsRandom = /(랜덤|무작위|임의)/.test(normalized);
    const mentionsSelection = /(선택|선별|추출|고르|골라|뽑)/.test(normalized);

    return mentionsActivities && mentionsFour && mentionsRandom && mentionsSelection;
}

export function limitActivitiesByTargetChars(selectedActivities, targetChars) {
    if (targetChars < 80) {
        return selectedActivities.slice(0, 1);
    }
    if (targetChars <= 150) {
        return selectedActivities.slice(0, Math.min(2, selectedActivities.length));
    }
    if (targetChars <= 250) {
        return selectedActivities.slice(0, Math.min(3, selectedActivities.length));
    }
    if (targetChars <= 350) {
        return selectedActivities.slice(0, Math.min(4, selectedActivities.length));
    }
    return selectedActivities;
}

export function splitNumberedIndividualActivities(individualActivity = "") {
    const text = String(individualActivity || "").replace(/\r\n/g, "\n").trim();
    const numberedDetails = {};

    if (!text) {
        return { numberedDetails, remainingIndividualActivity: "" };
    }

    const markerPattern = /(^|[\n,，;；/|])\s*(?:[-*•]\s*)?(?:[\[(（]\s*)?(?:(?:활동\s*내용|활동)\s*(\d+)\s*(?:번)?|(\d+)\s*(?:번\s*)?(?:활동\s*내용|활동)?)(?:\s*[\])）])?(?:\s*(?:[:：\-–—.)\]]|은|는)\s*|\s+|$)/g;
    const markers = [];
    let match;

    while ((match = markerPattern.exec(text)) !== null) {
        const activityNumber = Number(match[2] || match[3]);
        if (Number.isSafeInteger(activityNumber) && activityNumber > 0) {
            markers.push({
                activityNumber,
                start: match.index,
                end: markerPattern.lastIndex,
            });
        }
    }

    if (markers.length === 0) {
        return { numberedDetails, remainingIndividualActivity: text };
    }

    const remainingParts = [];
    const leadingText = text.slice(0, markers[0].start).trim();
    if (leadingText) {
        remainingParts.push(leadingText);
    }

    markers.forEach((marker, index) => {
        const nextMarker = markers[index + 1];
        const detail = text
            .slice(marker.end, nextMarker ? nextMarker.start : text.length)
            .replace(/[,，;；/|]+$/g, "")
            .trim();
        if (!detail) return;

        const key = String(marker.activityNumber);
        numberedDetails[key] = numberedDetails[key]
            ? `${numberedDetails[key]}\n${detail}`
            : detail;
    });

    return {
        numberedDetails,
        remainingIndividualActivity: remainingParts.join("\n").trim(),
    };
}

function getActivityNumber(activity, index) {
    const isObjectEntry = activity && typeof activity === "object";
    return isObjectEntry && Number.isInteger(activity.originalIndex)
        ? activity.originalIndex + 1
        : index + 1;
}

function getActivityText(activity) {
    return activity && typeof activity === "object"
        ? String(activity.text || "").trim()
        : String(activity || "").trim();
}

function normalizeKoreanToken(token) {
    let normalized = String(token || "").toLowerCase().trim();
    const suffixPattern = /(에서|으로|에게|께서|부터|까지|처럼|보다|으로|로|을|를|은|는|이|가|와|과|에|도|만|의)$/;

    while (suffixPattern.test(normalized) && normalized.length > 2) {
        normalized = normalized.replace(suffixPattern, "");
    }

    return normalized;
}

function getMeaningfulTokens(text) {
    return String(text || "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .map(normalizeKoreanToken)
        .filter(token => token.length >= 2);
}

function getRelevanceScore(activityText, detailText) {
    const activityTokens = new Set(getMeaningfulTokens(activityText));
    const detailTokens = new Set(getMeaningfulTokens(detailText));

    let score = 0;
    detailTokens.forEach(token => {
        if (activityTokens.has(token)) {
            score += token.length >= 3 ? 2 : 1;
        }
    });

    return score;
}

function splitUnnumberedIndividualDetailLines(individualActivity = "") {
    const text = String(individualActivity || "").replace(/\r\n/g, "\n").trim();

    if (!text) return [];

    return text
        .split(/\n+|[;；|]+/g)
        .map(line => line.replace(/^\s*[-*•]\s*/, "").trim())
        .filter(Boolean);
}

function inferUnnumberedDetailsByActivity(activities = [], individualActivity = "") {
    const details = splitUnnumberedIndividualDetailLines(individualActivity);
    const activityEntries = activities
        .map((activity, index) => ({
            activityNumber: getActivityNumber(activity, index),
            text: getActivityText(activity),
        }))
        .filter(entry => entry.text);
    const numberedDetails = {};
    const assignedDetailIndexes = new Set();
    const assignedActivityNumbers = new Set();

    if (details.length === 0 || activityEntries.length === 0) {
        return { numberedDetails, remainingIndividualActivity: individualActivity.trim() };
    }

    const relevanceCandidates = details
        .map((detail, detailIndex) => {
            const scores = activityEntries
                .map(entry => ({
                    activityNumber: entry.activityNumber,
                    score: getRelevanceScore(entry.text, detail),
                }))
                .sort((a, b) => b.score - a.score);
            const best = scores[0] || { score: 0 };
            const second = scores[1] || { score: 0 };

            return {
                detail,
                detailIndex,
                activityNumber: best.activityNumber,
                score: best.score,
                isUnique: best.score > 0 && best.score > second.score,
            };
        })
        .filter(candidate => candidate.isUnique)
        .sort((a, b) => b.score - a.score || a.detailIndex - b.detailIndex);

    relevanceCandidates.forEach(candidate => {
        if (
            assignedDetailIndexes.has(candidate.detailIndex)
            || assignedActivityNumbers.has(candidate.activityNumber)
        ) {
            return;
        }

        numberedDetails[String(candidate.activityNumber)] = candidate.detail;
        assignedDetailIndexes.add(candidate.detailIndex);
        assignedActivityNumbers.add(candidate.activityNumber);
    });

    details.forEach((detail, detailIndex) => {
        if (assignedDetailIndexes.has(detailIndex)) return;

        const activityNumber = detailIndex + 1;
        const hasMatchingActivity = activityEntries.some(entry => entry.activityNumber === activityNumber);
        if (!hasMatchingActivity || assignedActivityNumbers.has(activityNumber)) return;

        numberedDetails[String(activityNumber)] = detail;
        assignedDetailIndexes.add(detailIndex);
        assignedActivityNumbers.add(activityNumber);
    });

    const remainingDetails = details
        .filter((detail, detailIndex) => !assignedDetailIndexes.has(detailIndex));

    return {
        numberedDetails,
        remainingIndividualActivity: remainingDetails.join("\n").trim(),
    };
}

export function mergeNumberedIndividualActivities(activities = [], individualActivity = "") {
    const splitResult = splitNumberedIndividualActivities(individualActivity);
    const hasNumberedDetails = Object.keys(splitResult.numberedDetails).length > 0;
    const {
        numberedDetails,
        remainingIndividualActivity,
    } = hasNumberedDetails
        ? splitResult
        : inferUnnumberedDetailsByActivity(activities, splitResult.remainingIndividualActivity);
    const detailNumbers = Object.keys(numberedDetails);

    if (detailNumbers.length === 0) {
        return { activities, remainingIndividualActivity };
    }

    const appliedNumbers = new Set();
    const mergedActivities = activities.map((activity, index) => {
        const isObjectEntry = activity && typeof activity === "object";
        const activityNumber = getActivityNumber(activity, index);
        const detail = numberedDetails[String(activityNumber)];

        if (!detail) {
            return activity;
        }

        appliedNumbers.add(String(activityNumber));
        const text = getActivityText(activity);
        const mergedText = `${text}\n  (이 학생 개별 수행: ${detail})`;

        if (isObjectEntry) {
            return {
                ...activity,
                text: mergedText,
                individualDetail: detail,
            };
        }

        return mergedText;
    });

    const unmatchedDetails = detailNumbers
        .filter(activityNumber => !appliedNumbers.has(activityNumber))
        .map(activityNumber => `활동${activityNumber}: ${numberedDetails[activityNumber]}`);
    const remainingParts = [
        remainingIndividualActivity,
        ...unmatchedDetails,
    ].filter(part => part && part.trim());

    return {
        activities: mergedActivities,
        remainingIndividualActivity: remainingParts.join("\n").trim(),
    };
}
