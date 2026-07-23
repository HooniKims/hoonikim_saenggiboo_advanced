const GRADE_OPTIONS = new Set(["A", "B", "C", "D", "E"]);
const ACTIVITY_START_COLUMN = 8;
const INDIVIDUAL_ACTIVITY_COLUMN = ACTIVITY_START_COLUMN - 1;

function normalizeCell(value) {
    return String(value ?? "").trim();
}

function isGradeSummaryHeader(value) {
    // 앱이 내보내는 결과 엑셀의 "활동별 성취도" 컬럼 ("활동1:C, 활동2:E" 형식).
    // NEIS 표준 '성취도' 컬럼이나 '학업성취도평가' 같은 활동명과의 오탐을 막기 위해
    // 부분 매칭이 아닌 정확 매칭만 인정함
    return normalizeCell(value).replace(/\s/g, "") === "활동별성취도";
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
            if (isGradeSummaryHeader(value)) return false;
            const normalized = normalizeCell(value).replace(/\s/g, "");
            return normalized.includes("활동")
                || normalized.includes("내용")
                || normalized.includes("관찰기록")
                || normalized.includes("세부능력")
                || normalized.includes("특기사항")
                || normalized.includes("세특")
                || normalized.includes("개별활동");
        });
        const gradeSummaryColumnIndex = row.findIndex((value) => isGradeSummaryHeader(value));
        return { rowIndex, nameColumnIndex, activityContentColumnIndex, gradeSummaryColumnIndex };
    }
    return null;
}

function parseGradeSummaryCell(value) {
    // "활동1:C, 활동2:E" → ["C", "E"] (번호 기준 배치, 빈 슬롯은 "")
    const grades = [];
    const pattern = /활동\s*(\d+)\s*[:：]\s*([A-Ea-e])/g;
    let match;
    while ((match = pattern.exec(String(value ?? ""))) !== null) {
        const slot = Number(match[1]) - 1;
        if (slot >= 0 && slot < 100) {
            grades[slot] = match[2].toUpperCase();
        }
    }
    return Array.from(grades, (grade) => (GRADE_OPTIONS.has(grade) ? grade : ""));
}

export function parseGwasetukExcelRows(rows) {
    const safeRows = Array.isArray(rows) ? rows : [];
    const headerInfo = findHeaderInfo(safeRows);
    if (!headerInfo) return { activities: [], students: [] };

    const headerRow = safeRows[headerInfo.rowIndex] || [];
    const activityColumns = headerRow
        .map((header, columnIndex) => ({ columnIndex, name: normalizeCell(header) }))
        .filter(({ columnIndex, name }) => columnIndex >= ACTIVITY_START_COLUMN && name);
    // 앱이 내보낸 결과 파일("활동별 성취도" 컬럼 존재)은 세특 결과 컬럼을 개별활동으로
    // 오인하지 않도록, "개별"이 명시된 헤더만 개별활동으로 인정함
    const isExportedResultFormat = headerInfo.gradeSummaryColumnIndex !== -1;
    const explicitIndividualColumnIndex = headerRow.findIndex((value) => normalizeCell(value).replace(/\s/g, "").includes("개별"));
    const individualActivityColumnIndex = isExportedResultFormat
        ? explicitIndividualColumnIndex
        : headerRow.length > INDIVIDUAL_ACTIVITY_COLUMN
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
        const columnGrades = activityColumns.map(({ columnIndex }) => {
            const grade = normalizeCell(row[columnIndex]).toUpperCase();
            return GRADE_OPTIONS.has(grade) ? grade : "";
        });
        // 활동별 등급 컬럼이 없으면 "활동별 성취도" 요약 컬럼("활동1:C, 활동2:E")에서 복원
        const activityGrades = columnGrades.some((grade) => grade) || headerInfo.gradeSummaryColumnIndex === -1
            ? columnGrades
            : parseGradeSummaryCell(row[headerInfo.gradeSummaryColumnIndex]);
        students.push({ name, individualActivity, activityGrades });
    }

    return { activities, students };
}
