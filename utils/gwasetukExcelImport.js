const GRADE_OPTIONS = new Set(["A", "B", "C", "D", "E"]);
const ACTIVITY_START_COLUMN = 8;
const INDIVIDUAL_ACTIVITY_COLUMN = ACTIVITY_START_COLUMN - 1;

function normalizeCell(value) {
    return String(value ?? "").trim();
}

function findHeaderInfo(rows) {
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        const row = rows[rowIndex] || [];
        const nameColumnIndex = row.findIndex((value) => {
            const normalized = normalizeCell(value).replace(/\s/g, "");
            return normalized === "성명" || normalized === "이름";
        });
        if (nameColumnIndex === -1) continue;

        const activityContentColumnIndex = row.findIndex((value) => {
            const normalized = normalizeCell(value).replace(/\s/g, "");
            return normalized.includes("활동")
                || normalized.includes("내용")
                || normalized.includes("관찰기록")
                || normalized.includes("세부능력")
                || normalized.includes("특기사항")
                || normalized.includes("세특")
                || normalized.includes("개별활동");
        });
        return { rowIndex, nameColumnIndex, activityContentColumnIndex };
    }
    return null;
}

export function parseGwasetukExcelRows(rows) {
    const safeRows = Array.isArray(rows) ? rows : [];
    const headerInfo = findHeaderInfo(safeRows);
    if (!headerInfo) return { activities: [], students: [] };

    const headerRow = safeRows[headerInfo.rowIndex] || [];
    const activityColumns = headerRow
        .map((header, columnIndex) => ({ columnIndex, name: normalizeCell(header) }))
        .filter(({ columnIndex, name }) => columnIndex >= ACTIVITY_START_COLUMN && name);
    const individualActivityColumnIndex = headerRow.length > INDIVIDUAL_ACTIVITY_COLUMN
        ? INDIVIDUAL_ACTIVITY_COLUMN
        : headerInfo.activityContentColumnIndex;
    const activities = activityColumns.map(({ name }) => name);
    const students = [];

    for (let rowIndex = headerInfo.rowIndex + 1; rowIndex < safeRows.length; rowIndex += 1) {
        const row = safeRows[rowIndex] || [];
        const name = normalizeCell(row[headerInfo.nameColumnIndex]);
        if (!name) continue;

        const individualActivity = individualActivityColumnIndex === -1
            ? ""
            : normalizeCell(row[individualActivityColumnIndex]);
        const activityGrades = activityColumns.map(({ columnIndex }) => {
            const grade = normalizeCell(row[columnIndex]).toUpperCase();
            return GRADE_OPTIONS.has(grade) ? grade : "";
        });
        students.push({ name, individualActivity, activityGrades });
    }

    return { activities, students };
}
