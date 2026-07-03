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

export function mergeNumberedIndividualActivities(activities = [], individualActivity = "") {
    const {
        numberedDetails,
        remainingIndividualActivity,
    } = splitNumberedIndividualActivities(individualActivity);
    const detailNumbers = Object.keys(numberedDetails);

    if (detailNumbers.length === 0) {
        return { activities, remainingIndividualActivity };
    }

    const appliedNumbers = new Set();
    const mergedActivities = activities.map((activity, index) => {
        const isObjectEntry = activity && typeof activity === "object";
        const activityNumber = isObjectEntry && Number.isInteger(activity.originalIndex)
            ? activity.originalIndex + 1
            : index + 1;
        const detail = numberedDetails[String(activityNumber)];

        if (!detail) {
            return activity;
        }

        appliedNumbers.add(String(activityNumber));
        const text = isObjectEntry ? String(activity.text || "").trim() : String(activity || "").trim();
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
