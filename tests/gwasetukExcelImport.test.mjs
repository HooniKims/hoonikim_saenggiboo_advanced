import test from "node:test";
import assert from "node:assert/strict";
import { parseGwasetukExcelRows } from "../utils/gwasetukExcelImport.js";

test("과세특 엑셀의 H열 세특과 I열 이후 활동별 A~E 등급을 함께 읽는다", () => {
    // Given
    const rows = [
        ["학년도", "학기", "학년", "반/번호", "학생개인번호", "성명", "과목명", "세특", "정서를 표현하는 글쓰기", "비판적 독해 보고서", "매체별 품사 사용 분석 프로젝트", "독서 포트폴리오"],
        ["2026", "1", "1", "5/1", "2026000114", "김은빈", "국어", "토론 근거를 정리함", "A", "B", "C", ""],
        ["2026", "1", "1", "5/2", "2026000099", "김찬성", "국어", "비평문 작성에 참여함", "B", "E", "A", "D"],
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
        { name: "김은빈", individualActivity: "토론 근거를 정리함", activityGrades: ["A", "B", "C", ""] },
        { name: "김찬성", individualActivity: "비평문 작성에 참여함", activityGrades: ["B", "E", "A", "D"] },
    ]);
});

test("앞선 열에 활동 관련 헤더가 있어도 과세특 개별 내용은 H열에서 읽는다", () => {
    // Given
    const rows = [
        ["학년도", "학기", "학년", "반/번호", "활동 구분", "성명", "과목명", "세부능력 및 특기사항", "활동 1"],
        ["2026", "1", "1", "5/1", "국어 활동", "학생1", "국어", "H열 개별 세특", "A"],
    ];

    // When
    const result = parseGwasetukExcelRows(rows);

    // Then
    assert.deepEqual(result.students, [
        { name: "학생1", individualActivity: "H열 개별 세특", activityGrades: ["A"] },
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
