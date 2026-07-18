import test from "node:test";
import assert from "node:assert/strict";
import { parseGwasetukExcelRows } from "../utils/gwasetukExcelImport.js";

test("과세특 엑셀의 H열 이후 활동과 학생별 A~E 등급을 함께 읽는다", () => {
    // Given
    const rows = [
        ["학년도", "학기", "학년", "반/번호", "학생개인번호", "성명", "과목명", "정서를 표현하는 글쓰기", "비판적 독해 보고서", "매체별 품사 사용 분석 프로젝트", "독서 포트폴리오"],
        ["2026", "1", "1", "5/1", "2026000114", "김은빈", "국어", "A", "B", "C", ""],
        ["2026", "1", "1", "5/2", "2026000099", "김찬성", "국어", "B", "E", "A", "D"],
    ];

    // When
    const result = parseGwasetukExcelRows(rows);

    // Then
    assert.deepEqual(result.activities, [
        "정서를 표현하는 글쓰기",
        "비판적 독해 보고서",
        "매체별 품사 사용 분석 프로젝트",
        "독서 포트폴리오",
    ]);
    assert.deepEqual(result.students, [
        { name: "김은빈", individualActivity: "", activityGrades: ["A", "B", "C", ""] },
        { name: "김찬성", individualActivity: "", activityGrades: ["B", "E", "A", "D"] },
    ]);
});

test("활동 등급 열이 없는 기존 엑셀은 학생과 활동 내용만 읽는다", () => {
    // Given
    const rows = [
        ["성명", "개별 활동 내용"],
        ["김은빈", "토론 근거를 정리함"],
    ];

    // When
    const result = parseGwasetukExcelRows(rows);

    // Then
    assert.deepEqual(result.activities, []);
    assert.deepEqual(result.students, [
        { name: "김은빈", individualActivity: "토론 근거를 정리함", activityGrades: [] },
    ]);
});
