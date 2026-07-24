"use client";

import { useState, useRef, useEffect } from "react";
import { Plus, Trash2, Upload, Download, Wand2, FileSpreadsheet, Users, UserX, Copy, Check } from "lucide-react";
import * as XLSX from "xlsx";
import { writeExcel } from "../../utils/excel";
import { getCharacterGuideline, getMinimumTargetBytes, getUtf8ByteLength, normalizeTargetBytes, normalizeTargetChars } from "../../utils/textProcessor";
import { fetchStream, AVAILABLE_MODELS, DEFAULT_MODEL, getModelOptionLabel, isLightweightModel, isNvidiaModel, isUpstageModel } from "../../utils/streamFetch";
import { fetchNvidiaCompletion } from "../../utils/nvidiaFetch";
import { fetchOpenAICompletion } from "../../utils/openAIFetch";
import { fetchUpstageCompletion } from "../../utils/upstageFetch";
import { useOpenAIKey } from "../../utils/openAIKey";
import OpenAIKeyControl from "../../components/OpenAIKeyControl";
import { generateWithSilentValidation } from "../../utils/generationHarness";
import { generateWithLocalSolarFallback } from "../../utils/localSolarFallback";
import { getGenerationProvider, runGenerationWithProgress } from "../../utils/generationProgress";
import { fetchSearchContext } from "../../utils/searchContextFetch";
import { limitActivitiesByTargetChars, mergeNumberedIndividualActivities, shouldSelectRandomFourActivities } from "../../utils/activitySelection";
import { parseGwasetukExcelRows } from "../../utils/gwasetukExcelImport";

const GRADE_OPTIONS = ["A", "B", "C", "D", "E"];
// 등급별 증거어: 등급 간 부분문자열 중첩이 없어야 하고(C ⊄ D ⊄ E),
// D/E는 긍정 문장에 섞여도 매칭되는 중립 명사구 대신 극성이 내장된 구절만 사용함
// (예전 "기본 요건"·"개별 지도"는 칭찬 문장 안에서도 검증을 통과시켜 톤 역전을 놓쳤음)
const SOLAR_GRADE_EVIDENCE = {
    A: ["주도적으로 탐구", "심화 질문", "높은 수준", "새로운 관점", "구체적 성과", "돋보"],
    B: ["안정적으로 수행", "핵심 내용을 이해", "충실히 수행", "결과를 완성", "잘 해냄"],
    C: ["연습이 요구", "연습이 더해지면", "익혀 가는 과정", "높일 여지", "향상이 기대"],
    D: ["반복적인 안내", "지속적인 교사 지원", "다시 확인할 필요", "적용에 어려움"],
    E: ["기본 요건을 충족하는 데 어려움", "매우 많은 보완이 요구", "지속적인 개별 지도", "기초 학습 지원이 필요", "절차부터 다시 익힐"],
};
// 활동별 프롬프트 지침용: 해당 등급 서술에서 쓰면 안 되는 다른 등급의 대표 표현
const GRADE_TONE_AVOID = {
    A: ["보완이 필요", "연습이 요구", "어려움이 큼", "반복적인 안내", "개별 지도"],
    B: ["주도적", "돋보임", "탁월", "보완이 필요", "어려움이 큼", "개별 지도"],
    C: ["매우 많은 보완", "지속적인 개별 지도", "기초 학습 지원", "반복적인 안내", "기본 요건", "도달하지 못", "미흡", "부족", "주도적", "돋보임", "탁월"],
    D: ["매우 많은 보완", "기본 요건", "절차부터 다시", "주도적", "돋보임", "탁월"],
    E: ["주도적", "돋보임", "탁월", "높은 수준", "뛰어남", "심화"],
};
const getActivityEvidenceTerms = (text) => {
    const firstClause = String(text || "").trim().replace(/\s+/g, " ").split(/[,.!?]/)[0];
    const words = firstClause.split(" ").filter(Boolean);
    return [...new Set([
        words.slice(0, 2).join(" "),
        words.slice(0, 3).join(" "),
    ].filter((term) => term.length >= 2))];
};

const normalizeActivityGrades = (grades = [], activityCount = 1, fallbackGrade = "A") => {
    const safeCount = Math.max(1, activityCount);
    const safeFallback = GRADE_OPTIONS.includes(fallbackGrade) ? fallbackGrade : "A";
    return Array.from({ length: safeCount }, (_, index) => {
        const grade = Array.isArray(grades) ? grades[index] : undefined;
        return GRADE_OPTIONS.includes(grade) ? grade : safeFallback;
    });
};

const areSameGrades = (left = [], right = []) => (
    left.length === right.length && left.every((grade, index) => grade === right[index])
);

const createStudent = (id, values = {}, activityCount = 1) => {
    const fallbackGrade = GRADE_OPTIONS.includes(values.grade) ? values.grade : "A";
    const activityGrades = normalizeActivityGrades(values.activityGrades, activityCount, fallbackGrade);
    return {
        id,
        name: "",
        grade: fallbackGrade,
        activityGrades,
        individualActivity: "",
        result: "",
        status: "idle",
        progress: "",
        ...values,
        id,
        grade: fallbackGrade,
        activityGrades,
    };
};

export default function GwasetukPage() {
    // State
    const [studentCount, setStudentCount] = useState(1);
    const [isManualInput, setIsManualInput] = useState(false);
    const [manualCountValue, setManualCountValue] = useState("");

    const [subjectName, setSubjectName] = useState("");
    const [schoolLevel, setSchoolLevel] = useState("middle"); // elementary, middle, high

    const [students, setStudents] = useState(() => [createStudent(1)]);
    const [activities, setActivities] = useState([""]);
    const [additionalInstructions, setAdditionalInstructions] = useState(""); // 추가 지침 사항
    const [textLength, setTextLength] = useState("1500"); // 1500, 1000, 600, manual
    const [manualLength, setManualLength] = useState("");
    const [isGenerating, setIsGenerating] = useState(false);
    const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
    const [useWebSearchContext, setUseWebSearchContext] = useState(false);
    const [copiedId, setCopiedId] = useState(null);
    const fileInputRef = useRef(null);
    const activityInputRefs = useRef([]);
    const resultTextareaRefs = useRef({});
    const prevActivitiesLength = useRef(activities.length);
    const {
        openAIKeyInput,
        setOpenAIKeyInput,
        appliedOpenAIKey,
        applyOpenAIKey,
        clearOpenAIKey,
        isOpenAIKeyApplied,
        maskedOpenAIKey,
        selectedOpenAIModel,
        setSelectedOpenAIModel,
    } = useOpenAIKey();
    const isNvidiaSelected = isNvidiaModel(selectedModel);
    const isUpstageSelected = isUpstageModel(selectedModel);
    const isLocalFallbackEligible = !isNvidiaSelected && !isUpstageSelected && !appliedOpenAIKey;
    const generationStatusText = "AI로 생성 중...";

    useEffect(() => {
        setStudents(prevStudents => {
            let changed = false;
            const nextStudents = prevStudents.map(student => {
                const activityGrades = normalizeActivityGrades(student.activityGrades, activities.length, "A");
                if (areSameGrades(activityGrades, student.activityGrades || [])) {
                    return student;
                }
                changed = true;
                return { ...student, activityGrades };
            });
            return changed ? nextStudents : prevStudents;
        });
    }, [activities.length]);

    // Auto-resize textarea
    const adjustTextareaHeight = (element) => {
        if (element) {
            const maxHeight = 560;
            element.style.height = "auto";
            const requiredHeight = element.scrollHeight + 2;
            element.style.height = Math.min(requiredHeight, maxHeight) + "px";
            element.style.overflowY = requiredHeight > maxHeight ? "auto" : "hidden";
        }
    };

    useEffect(() => {
        if (activities.length > prevActivitiesLength.current) {
            const lastIndex = activities.length - 1;
            activityInputRefs.current[lastIndex]?.focus();
        }
        prevActivitiesLength.current = activities.length;
    }, [activities]);

    useEffect(() => {
        students.forEach((student) => adjustTextareaHeight(resultTextareaRefs.current[student.id]));
    }, [students]);

    // Handlers
    const updateStudentList = (count) => {
        const newStudents = [...students];
        if (count > newStudents.length) {
            for (let i = newStudents.length + 1; i <= count; i++) {
                newStudents.push(createStudent(i, {}, activities.length));
            }
        } else {
            newStudents.splice(count);
        }
        setStudents(newStudents.map((student, index) => createStudent(index + 1, student, activities.length)));
        setStudentCount(count);
    };

    const handleStudentCountChange = (e) => {
        const value = e.target.value;
        if (value === "manual") {
            setIsManualInput(true);
            setManualCountValue("");
        } else {
            setIsManualInput(false);
            updateStudentList(parseInt(value));
        }
    };

    const handleManualCountSubmit = () => {
        const count = parseInt(manualCountValue);
        if (count > 0 && count <= 100) { // Reasonable limit
            updateStudentList(count);
            setIsManualInput(false);
        } else {
            alert("1에서 100 사이의 숫자를 입력해주세요.");
        }
    };

    const handleFileUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (evt) => {
            const bstr = evt.target.result;
            const wb = XLSX.read(bstr, { type: "binary" });
            const wsname = wb.SheetNames[0];
            const ws = wb.Sheets[wsname];
            const data = XLSX.utils.sheet_to_json(ws, { header: 1 });

            const parsed = parseGwasetukExcelRows(data);
            const importedActivities = parsed.activities;
            // 결과 엑셀("활동별 성취도"만 있고 활동명 컬럼은 없음) 재업로드 시 등급이
            // 현재 활동 개수로 잘리지 않도록, 복원된 등급 개수만큼 활동 슬롯을 확보함
            const importedGradeCount = parsed.students.reduce(
                (max, student) => Math.max(max, (student.activityGrades || []).length),
                0,
            );
            const activityCount = importedActivities.length || Math.max(importedGradeCount, activities.length);
            const newStudents = parsed.students.map((student, index) => createStudent(index + 1, student, activityCount));

            if (newStudents.length > 0) {
                if (importedActivities.length > 0) {
                    setActivities(importedActivities);
                } else if (activityCount > activities.length) {
                    setActivities(Array.from({ length: activityCount }, (_, index) => activities[index] || ""));
                }
                setStudents(newStudents);
                setStudentCount(newStudents.length);
                setIsManualInput(false);
            } else {
                alert("엑셀 파일에서 '성명' 또는 '이름' 열을 찾을 수 없거나, 유효한 학생 데이터가 없습니다.");
            }
        };
        reader.readAsBinaryString(file);
    };

    const addActivity = () => setActivities([...activities, ""]);
    const removeActivity = (index) => {
        const newActivities = activities.filter((_, i) => i !== index);
        const nextActivities = newActivities.length ? newActivities : [""];
        setActivities(nextActivities);
        setStudents(prevStudents => prevStudents.map(student => {
            const currentGrades = normalizeActivityGrades(student.activityGrades, activities.length, "A");
            const activityGrades = normalizeActivityGrades(
                currentGrades.filter((_, gradeIndex) => gradeIndex !== index),
                nextActivities.length,
                "A"
            );
            return { ...student, activityGrades };
        }));
    };
    const updateActivity = (index, value) => {
        const newActivities = [...activities];
        newActivities[index] = value;
        setActivities(newActivities);
    };

    const updateStudent = (id, field, value) => {
        setStudents(prevStudents => prevStudents.map(s => s.id === id ? { ...s, [field]: value } : s));
    };

    // 활동 등급의 읽기/패딩 기본값은 항상 "A"로 고정함.
    // (이전에는 student.grade를 폴백으로 써서, 활동1을 E로 바꾼 뒤 활동을 추가하면
    //  새 활동이 조용히 E로 채워지는 등급 전파 버그가 있었음)
    const getActivityGrade = (student, activityIndex) => {
        return normalizeActivityGrades(student.activityGrades, activities.length, "A")[activityIndex] || "A";
    };

    const updateStudentActivityGrade = (id, activityIndex, grade) => {
        if (!GRADE_OPTIONS.includes(grade)) return;
        setStudents(prevStudents => prevStudents.map(student => {
            if (student.id !== id) return student;
            const activityGrades = normalizeActivityGrades(student.activityGrades, activities.length, "A");
            activityGrades[activityIndex] = grade;
            return {
                ...student,
                activityGrades,
            };
        }));
    };

    const removeStudent = (id) => {
        if (students.length <= 1) {
            alert("최소 1명의 학생은 있어야 합니다.");
            return;
        }
        setStudents(prev => prev.filter(s => s.id !== id).map((s, i) => ({ ...s, id: i + 1 })));
        setStudentCount(prev => prev - 1);
    };


    // 생성 결과 검증과 후처리는 generationHarness에서 내부 처리됨

    const generatePrompt = (student, selectedActivities, targetChars, individualActivity = "", model = "", searchContext = "") => {
        const gradeDescriptions = {
            A: "A(매우 잘함) - 활동의 깊이와 수준이 높으며, 주도적 탐구·심화 질문·융합적 사고·구체적 성과가 분명히 드러나게 서술",
            B: "B(잘함) - 잘 해냄 기조를 유지하며 과제를 성실히 완수하고 핵심 개념을 이해한 모습, 참여 과정·자료 정리·협력 태도가 드러나게 서술하되 A 수준의 탁월함·돋보임·뛰어남으로 과장하지 않음",
            C: "C(보완 필요) - 활동에 성실히 참여한 사실을 먼저 인정하고, 핵심 개념과 표현을 익혀 가는 과정에 있으며 연습이 더해지면 향상이 기대된다는 성장 관점으로 부드럽게 서술. '도달하지 못함', '미흡함', '부족함' 같은 직접적인 결핍 서술은 쓰지 않음",
            D: "D(많은 보완 필요) - 활동 참여, 기초 이해, 결과 완성도에서 반복적인 교사 안내와 많은 보완이 필요한 지점을 C보다 더 분명하게 서술",
            E: "E(매우 많은 보완 필요) - 활동 수행의 기본 요건을 충족하는 데 어려움이 크며, 지속적인 개별 지도와 기초 학습 지원이 필요한 지점을 D보다 더 낮은 수행 수준으로 서술하되 비난하거나 낙인찍는 표현은 사용하지 않음"
        };

        const targetBytes = normalizeTargetBytes(textLength, manualLength);
        const lengthInstruction = getCharacterGuideline(targetChars, targetBytes, getMinimumTargetBytes(targetBytes));

        const schoolLevelMap = {
            elementary: "초등학생",
            middle: "중학생",
            high: "고등학생"
        };
        const targetLevel = schoolLevelMap[schoolLevel] || "중학생";
        // 과목명은 시스템 참고용으로만 전달 (출력에 절대 포함 금지)
        const subjectContext = subjectName ? `[시스템 참고 - 출력에 절대 포함 금지] 과목: ${subjectName}` : "";

        const useActivityGrades = true;
        const mappedActivityEntries = selectedActivities.map((entry, index) => {
            if (typeof entry === "string") {
                return {
                    text: entry.trim(),
                    grade: getActivityGrade(student, index),
                    originalIndex: index,
                };
            }
            const grade = GRADE_OPTIONS.includes(entry.grade) ? entry.grade : "A";
            return {
                text: String(entry.text || "").trim(),
                grade,
                originalIndex: Number.isInteger(entry.originalIndex) ? entry.originalIndex : index,
            };
        }).filter(entry => entry.text);
        const {
            activities: selectedActivityEntries,
            remainingIndividualActivity,
        } = mergeNumberedIndividualActivities(mappedActivityEntries, individualActivity);

        const totalActivities = selectedActivityEntries.length;
        const activitiesText = selectedActivityEntries.map((entry, i) => {
            const originalIndexText = entry.originalIndex !== i ? ` (원래 활동${entry.originalIndex + 1})` : "";
            return `- 활동${i + 1}${originalIndexText}: ${entry.text}`;
        }).join("\n");

        // 활동별로 반드시 써야 하는 성취 수준 표현과 쓰면 안 되는 표현을 명시함
        // (경량 모델이 등급 지시를 무시하고 E를 칭찬문으로 쓰는 역전을 막는 1차 방어선.
        //  2차 방어선은 generationHarness의 활동 구간별 grade_tone_mismatch 검증)
        const activityToneGuideline = selectedActivityEntries.map((entry, i) => {
            const usePhrases = SOLAR_GRADE_EVIDENCE[entry.grade].slice(0, 3).map((term) => `'${term}'`).join(" 또는 ");
            const avoidPhrases = GRADE_TONE_AVOID[entry.grade].map((term) => `'${term}'`).join(", ");
            return `- 활동${i + 1}(${entry.grade}): 이 활동 서술 안에 ${usePhrases} 표현을 반드시 포함하고, ${avoidPhrases} 표현은 이 활동 서술에 쓰지 않음`;
        }).join("\n")
            + "\n- 위 필수 표현은 각 활동의 실제 수행 내용과 결합해 서로 다른 문장으로 녹여 쓰고, 같은 문장 틀을 활동마다 그대로 복사하듯 반복하지 않음";

        const activityGradeInstruction = useActivityGrades
            ? `\n[활동별 A/B/C/D/E 반영 기준]\n${selectedActivityEntries.map((entry, i) => `- 활동${i + 1}: ${entry.grade} - ${gradeDescriptions[entry.grade]}`).join("\n")}

[활동별 필수/금지 표현 - 반드시 준수]
${activityToneGuideline}

[출력 금지]
- 등급 기호와 라벨은 내부 반영 기준일 뿐이며 [A], (A), A등급, 활동1[A] 같은 표기를 본문에 절대 출력하지 않음

[등급별 표현 사전]
- A 전용 권장 표현: 주도적으로 탐구함, 심화 질문을 제기함, 근거를 종합해 설명함, 새로운 관점으로 연결함, 구체적 성과를 보임, 높은 수준의 이해를 드러냄
- B 전용 권장 표현: 과제를 안정적으로 수행함, 핵심 내용을 이해함, 맡은 역할을 충실히 수행함, 자료를 정리해 참여함, 활동 절차를 잘 따라가며 결과를 완성함, 잘 해냄 기조를 유지함
- C 전용 권장 표현: 활동에 성실히 참여하며 핵심 개념을 익혀 가는 과정에 있음, 표현의 구체성을 높일 여지가 있어 단계적인 연습이 더해지면 향상이 기대됨, 결과의 완성도를 높이기 위한 연습이 요구됨
- D 전용 권장 표현: 반복적인 안내가 필요함, 활동 절차 이해와 적용에 어려움이 있어 많은 보완이 요구됨, 자료 정리와 결과 완성 과정에서 지속적인 교사 지원이 필요함, 기초 개념을 다시 확인할 필요가 있음
- E 전용 권장 표현: 활동 수행의 기본 요건을 충족하는 데 어려움이 큼, 지속적인 개별 지도와 기초 학습 지원이 필요한 지점이 뚜렷함, 참여 과정과 결과 완성 모두에서 매우 많은 보완이 요구됨, 기본 활동 절차부터 다시 익힐 필요가 있음

[등급 간 대비 규칙]
- A 활동은 주도성, 심화성, 구체적 성과가 뚜렷하게 느껴지게 씀
- B 활동에는 탁월함·돋보임·뛰어남·심화·주도적 같은 A급 표현을 쓰지 않음
- C 활동에는 성실한 참여와 시도를 먼저 인정하고, 표현·완성도를 높일 여지와 연습 필요를 부드럽게 덧붙이되 도달하지 못함·못함·소극적·미흡함·부족함 같은 직접적인 결핍 서술은 쓰지 않음
- D 활동은 C보다 더 뚜렷하게 반복적인 안내와 보완 필요성을 드러냄
- E 활동은 D보다 더 낮은 수행 수준으로, 활동 수행의 기본 요건 충족 어려움과 지속적인 개별 지도와 기초 학습 지원이 필요한 지점을 드러냄
- 같은 학생 안에서도 활동별 등급이 다르면 문장 강도와 성취 표현을 반드시 다르게 씀
- A는 최고 수준의 성취, B는 안정적 수행, C는 성실한 참여와 성장 여지, D는 많은 보완, E는 매우 많은 보완으로 서술 기조를 구분함
- C 활동은 B 수준의 안정적 수행으로 올려 쓰지 않음
- D와 E 활동을 C 수준으로 완화하지 않음
- C는 성장 여지를 부드럽게 담고, D와 E는 단계적으로 더 뚜렷한 수행 제한을 담되, 비난하거나 낙인찍는 표현은 사용하지 않음

(각 활동은 해당 줄의 A/B/C/D/E 기준에 맞춰 깊이와 구체성을 조절하고, 다른 활동의 등급 기준을 섞어 적용하지 마세요. B 활동은 A 수준의 최상위 표현으로 과장하지 말고, C 활동은 B 수준의 안정적 수행으로 올려 쓰지 마세요. D와 E는 C 수준으로 완화하지 마세요. C 활동은 참여를 인정하며 성장 여지를 부드럽게 담고, D와 E 활동은 단계적으로 수행 제한과 보완 필요성을 더 강하게 드러내되 비난하거나 낙인찍는 표현은 사용하지 마세요. 등급 기준 설명 문장을 통째로 옮겨 적지 말고 수행 깊이, 자율성, 구체성의 차이로 표현하되, [활동별 필수/금지 표현]에 지정된 필수 구절만은 해당 활동 서술 안에 자연스럽게 포함하세요. 등급 기호와 라벨은 내부 반영 기준일 뿐 본문에 절대 출력하지 마세요.)`
            : "";
        const promptBasis = useActivityGrades ? "활동 내용과 활동별 A/B/C/D/E 기준" : "활동 내용";

        // 활동별 글자수 할당량 계산 (경량 모델용)
        const charsPerActivity = totalActivities > 0 ? Math.floor(targetChars / totalActivities) : targetChars;
        const activityAllocation = selectedActivityEntries.map((entry, i) =>
            `활동${i + 1}("${entry.text.substring(0, 15)}${entry.text.length > 15 ? '...' : ''}"): 약 ${charsPerActivity}자`
        ).join(", ");

        const individualActivityText = remainingIndividualActivity.trim()
            ? `\n\n[이 학생의 개별 활동 내용]\n${remainingIndividualActivity}\n(위 개별 활동 내용은 반드시 최종 본문에 반영해야 하는 학생별 수행 내용입니다. 활동 내용 목록의 순서를 유지하고, 개별 활동 내용을 첫 문장이나 첫 활동처럼 우선 배치하지 않음. 개별 활동의 핵심어와 구체적 수행 내용을 누락하지 않음. 공통 활동 흐름 안에서 필요한 곳에 자연스럽게 통합해 주세요.)`
            : "";
        const searchContextText = searchContext.trim()
            ? `\n\n[학생 개별 활동 내용 기반 웹 검색 보강 자료]\n${searchContext}\n(위 검색 보강 자료는 개별 활동을 정확히 이해하기 위한 배경 자료입니다. 학생이 실제로 입력한 활동과 공통 활동 내용을 우선하고, 검색 자료는 관련 개념·작품·연구·쟁점 이해를 보강하는 데에만 사용하세요.)`
            : "";

        const isLightweight_ = isLightweightModel(model || selectedModel);
        const isUpstage_ = isUpstageModel(model || selectedModel);
        const solarActivityPlan = isUpstage_
            ? `\n<Solar 다중 활동 작성 순서>\n1. 활동1부터 활동${totalActivities}까지 각각 최소 한 문장씩 입력 순서대로 먼저 작성함.\n2. 각 활동 문장 안에 해당 활동의 핵심 수행과 지정된 성취 수준을 함께 표현함.\n3. 활동별 분량을 ${activityAllocation} 기준으로 균등하게 배분하고 어느 활동도 생략하지 않음.\n4. 모든 활동을 반영한 뒤에만 남은 분량으로 관찰 관점을 추가함.\n5. A/B/C/D/E 문자와 '성취 수준' 같은 내부 라벨은 절대 출력하지 않음.\n`
            : "";

        if (isLightweight_) {
            // 경량 모델용: 간결하고 명확한 프롬프트
            return `과세특 본문을 작성하세요.

대상: ${targetLevel}
${subjectContext}

[활동 내용 - 총 ${totalActivities}개, 모두 반영 필수]
${activitiesText}${individualActivityText}${searchContextText}
${activityGradeInstruction}
${solarActivityPlan}

[활동별 할당량] ${activityAllocation}

[절대금지]
❌ 과목명 출력 금지 ("국어시간에", "수학 활동에서", "과학 수업" 등 전부 금지)
❌ 과거형 금지 (~했음, ~였음, ~되었음, ~하였음, ~보였음 전부 금지)
❌ 주어 금지 ("학생은", "이 학생은" 금지)
❌ 요약/마무리 문장 금지
❌ '마지막으로', '끝으로', '마무리하며', '덧붙여', '추가로' 사용 금지
❌ 등급 기호/라벨 출력 금지 ([A], (A), A등급, 활동1[A] 등 전부 금지)

[필수]
✅ 현재형 종결어미만 사용: ~함, ~임, ~음, ~보임, ~드러남
✅ 위 ${totalActivities}개 활동을 모두 다양한 표현으로 서술
✅ 첫 문장은 반드시 위 [활동 내용]의 활동1 공통 활동으로 시작하고, 개별 활동 내용이나 검색 보강 자료를 첫 활동처럼 앞세우지 않음
✅ 활동별 A/B/C/D/E 기준이 있으면 활동마다 수행 깊이와 표현 강도를 다르게 반영하되 등급 표기는 출력하지 않음
✅ 문학작품은 반드시 작품명(작가명) 형식으로만 표기: 소나기(황순원), 운수좋은 날(현진건)
✅ 줄바꿈 없이 하나의 문단
✅ 오직 본문만 출력

${lengthInstruction}

[좋은 예시]
"토론 활동에서 찬반 입장을 논리적으로 정리하고 근거 자료를 조사하여 발표함. 발표 과정에서 상대 측 논거를 파악하고 재반박하는 능력을 보임."
`;
        }

        return `당신은 학교생활기록부 과세특(과목별 세부능력 및 특기사항)을 작성하는 교사입니다.
아래 ${totalActivities}개의 ${promptBasis}을 바탕으로 과세특 본문을 작성하세요.
모든 활동을 빠짐없이 반영하되, 각 활동마다 다양한 표현과 구체적인 서술을 사용하세요.

<입력 정보>
대상: ${targetLevel}
${subjectContext}

<활동 내용 - 총 ${totalActivities}개, 반드시 모두 반영>
${activitiesText}${individualActivityText}${searchContextText}
${activityGradeInstruction}
${solarActivityPlan}

<작성 규칙>
1. '학생은', '이 학생은' 등 주어를 사용하지 않고, 활동 내용부터 바로 서술
2. [절대금지] 과목명/프로그램명을 출력에 절대 포함하지 않음 (예: "국어시간에", "수학 수업에서", "과학 활동에서" 등 전부 금지). 바로 활동 서술로 시작
3. [절대금지] 과거형 표현 금지 (~했음, ~였음, ~되었음, ~하였음, ~보였음). 반드시 현재형 명사 종결어미(~함, ~임, ~음, ~보임, ~드러남)만 사용
4. ${targetLevel} 수준에 맞는 어휘 사용
5. 줄바꿈 없이 하나의 문단으로 작성
6. 입력된 ${totalActivities}개 활동 내용을 모두 빠짐없이 서술하고, 활동 내용 목록의 순서를 유지하며, 입력에 없는 사실은 추가하지 않음
7. 첫 문장은 반드시 위 <활동 내용>의 활동1 공통 활동으로 시작하고, [이 학생의 개별 활동 내용]이나 검색 보강 자료를 첫 활동처럼 앞세우지 않음
8. 마지막 문장도 반드시 구체적인 활동 내용이나 학습 과정 서술로 끝냄
9. '이러한', '이를 통해', '이와 같이', '앞으로', '향후', '결과적으로', '종합적으로', '마지막으로', '끝으로', '마무리하며', '덧붙여', '추가로'로 시작하는 요약/정리/마무리 문장 대신, 활동의 세부 과정이나 탐구 내용을 추가 서술
10. 문학작품을 언급할 때는 반드시 작품명(작가명) 형식으로만 표기함. 예: 소나기(황순원), 운수좋은 날(현진건). '황순원의 소나기', '현진건의 운수좋은 날'처럼 쓰지 않음
11. 활동별 A/B/C/D/E 기준이 있으면 A는 최고 수준의 심화·주도성, B는 안정적 수행·핵심 이해, C는 성실한 참여와 성장 여지, D는 반복적인 안내와 많은 보완, E는 활동 수행의 기본 요건 충족 어려움과 지속적인 지원 필요 중심으로 표현 강도를 구분함
12. 등급 기호와 라벨은 내부 반영 기준일 뿐이며 [A], (A), A등급, 활동1[A] 같은 표기를 본문에 절대 출력하지 않음

${lengthInstruction}

<출력 형식>
- 오직 세특 본문 텍스트만 출력
- 글자수 표기, 분석, 검증 포인트, 부가 설명 등 메타 정보는 출력하지 않음

<좋은 예시>
"토론 활동에서 '인공지능의 윤리'를 주제로 찬성 측 토론자로 참여하여 다양한 근거 자료를 조사하고 논리적으로 주장을 전개함. 특히 반론 과정에서 상대 측의 논거를 정확히 파악하고 재반박하는 능력이 돋보이며, 팀원들과 역할을 분담하여 자료 수집과 발표 준비를 체계적으로 진행함."
    `;
    };

    // Fisher-Yates 셔플 알고리즘 (강력한 랜덤)
    const shuffleArray = (arr) => {
        const shuffled = [...arr];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    };

    const generateForStudent = async (student) => {
        const validActivityEntries = activities
            .map((activity, originalIndex) => ({
                text: activity.trim(),
                grade: getActivityGrade(student, originalIndex),
                originalIndex,
            }))
            .filter(entry => entry.text !== "");

        if (validActivityEntries.length === 0 && !student.individualActivity?.trim()) {
            alert("활동 내용을 입력해주세요.");
            return;
        }

        const targetBytes = normalizeTargetBytes(textLength, manualLength);
        const targetChars = normalizeTargetChars(textLength, manualLength);
        const generationTargetChars = isUpstageSelected
            ? Math.min(650, Math.max(targetChars, Math.ceil(targetBytes / 2.7)))
            : targetChars;
        const minTargetBytes = getMinimumTargetBytes(targetBytes);

        // 개인별 활동 내용이 있어도 공통 활동 순서는 항상 Fisher-Yates 셔플로 랜덤화
        let selectedActivityEntries = shuffleArray(validActivityEntries);
        const forceRandomFourActivities = shouldSelectRandomFourActivities(additionalInstructions);
        if (forceRandomFourActivities) {
            selectedActivityEntries = selectedActivityEntries.slice(0, Math.min(4, selectedActivityEntries.length));
        }

        // Activity Selection Logic based on Target Chars
        selectedActivityEntries = limitActivitiesByTargetChars(selectedActivityEntries, targetChars);
        // 350자 초과: 모든 활동 사용
        const solarRequiredContentGroups = isUpstageSelected || isLocalFallbackEligible
            ? [
                ...selectedActivityEntries.map((entry, index) => ({
                    label: `활동${index + 1}`,
                    terms: getActivityEvidenceTerms(entry.text),
                })),
                ...[...new Set(selectedActivityEntries.map((entry) => entry.grade))].map((grade) => ({
                    label: `${grade} 성취 표현`,
                    terms: SOLAR_GRADE_EVIDENCE[grade],
                })),
            ]
            : [];
        // 활동 구간별 톤 검증 규칙: 모든 provider 경로에 적용됨.
        // 앵커로 본문을 활동 구간으로 나누고, 구간 안에 해당 등급 표현이 있는지·
        // 다른 등급의 표현이 섞이지 않았는지를 generationHarness가 검사함
        const activityToneRules = selectedActivityEntries.map((entry, index) => ({
            label: `활동${index + 1}`,
            grade: entry.grade,
            anchors: getActivityEvidenceTerms(entry.text),
            evidence: SOLAR_GRADE_EVIDENCE[entry.grade],
        }));

        try {
            updateStudent(student.id, "status", "loading");
            updateStudent(student.id, "progress", "생성 준비 중...");
            let searchContext = "";
            if (useWebSearchContext && student.individualActivity?.trim()) {
                try {
                    updateStudent(student.id, "progress", "웹 검색 보강 중...");
                    const searchResult = await fetchSearchContext({
                        subjectName,
                        commonActivities: selectedActivityEntries.map(entry => entry.text),
                        individualActivity: student.individualActivity,
                    });
                    searchContext = searchResult.context || "";
                    if (searchResult.query) {
                        console.log(`[웹 검색 보강] 학생 ${student.id}: ${searchResult.query}`);
                    }
                } catch (searchError) {
                    console.warn(`[웹 검색 보강 실패] 학생 ${student.id}: ${searchError.message}`);
                }
            }

            const promptModel = isNvidiaSelected || isUpstageSelected ? selectedModel : appliedOpenAIKey ? `openai:${selectedOpenAIModel}` : selectedModel;
            const prompt = generatePrompt(
                student,
                selectedActivityEntries,
                generationTargetChars,
                student.individualActivity || "",
                promptModel,
                searchContext
            );
            const validationOptions = {
                maxTargetBytes: targetBytes,
                minTargetBytes,
                targetChars: generationTargetChars,
                mode: "record",
                forbiddenTerms: [subjectName, student.name],
                requiredContentGroups: solarRequiredContentGroups,
                activityToneRules,
            };
            const runLocalGeneration = (nextPrompt, { attempt, previousValidation }) => runGenerationWithProgress({
                attempt,
                previousValidation,
                provider: "local",
                setProgress: (message) => updateStudent(student.id, "progress", message),
                run: () => fetchStream({ prompt: nextPrompt, additionalInstructions, model: selectedModel, targetChars: generationTargetChars }),
            });
            const generationResult = isLocalFallbackEligible
                ? await generateWithLocalSolarFallback({
                    prompt,
                    validationOptions,
                    localGenerateOnce: runLocalGeneration,
                    solarGenerateOnce: (nextPrompt, { attempt, previousValidation }) => runGenerationWithProgress({
                        attempt,
                        previousValidation,
                        provider: "upstage",
                        setProgress: (message) => updateStudent(student.id, "progress", message),
                        run: () => fetchUpstageCompletion({ prompt: nextPrompt, additionalInstructions, targetChars: generationTargetChars }),
                    }),
                })
                : await generateWithSilentValidation({
                    prompt,
                    acceptLengthOnlyResult: !isUpstageSelected,
                    preserveTextOnLengthRepair: isUpstageSelected,
                    stripExpandedGradeLabels: isUpstageSelected,
                    requiredContentGroups: solarRequiredContentGroups,
                    ...validationOptions,
                    maxRepairAttempts: isUpstageSelected ? 4 : 2,
                    generateOnce: (nextPrompt, { attempt, previousValidation }) => runGenerationWithProgress({
                    attempt,
                    previousValidation,
                    provider: getGenerationProvider({ isNvidiaSelected, isUpstageSelected, hasOpenAIKey: Boolean(appliedOpenAIKey) }),
                    setProgress: (message) => updateStudent(student.id, "progress", message),
                    run: () => isNvidiaSelected
                        ? fetchNvidiaCompletion({ prompt: nextPrompt, additionalInstructions, targetChars: generationTargetChars, model: selectedModel })
                        : isUpstageSelected
                            ? fetchUpstageCompletion({ prompt: nextPrompt, additionalInstructions, targetChars: generationTargetChars })
                        : appliedOpenAIKey
                            ? fetchOpenAICompletion({ prompt: nextPrompt, additionalInstructions, apiKey: appliedOpenAIKey, targetChars: generationTargetChars, model: selectedOpenAIModel })
                            : fetchStream({ prompt: nextPrompt, additionalInstructions, model: selectedModel, targetChars: generationTargetChars }),
                    }),
                });

            const completedModel = generationResult.provider === "upstage"
                ? "upstage:solar-pro2"
                : selectedModel;
            console.info(`[생성 완료] 모델=${completedModel} 시도=${generationResult.attempts} 최종=${getUtf8ByteLength(generationResult.text)}byte 검증=${generationResult.validation.ok ? "통과" : "경고"}`);

            if (generationResult.repaired) {
                console.log(`[내부 검증] 학생 ${student.id}: ${generationResult.attempts}회 시도 후 규칙 보정`);
            }
            if (!generationResult.validation.ok) {
                console.warn(`[내부 검증] 학생 ${student.id}: 최종 결과 일부 규칙 확인 필요`, generationResult.validation.issues);
            }

            const result = generationResult.text;
            updateStudent(student.id, "result", result);
            updateStudent(student.id, "status", "success");
            updateStudent(student.id, "progress", "");
        } catch (error) {
            console.error(error);
            updateStudent(student.id, "status", "error");
            updateStudent(student.id, "progress", "");
            alert(`학생 ${student.id} 생성 실패: ${error.message}`);
        }
    };

    const generateAll = async () => {
        const allCompleted = students.every(s => s.status === "success");
        let forceRegenerate = false;

        if (allCompleted) {
            if (window.confirm("이미 모든 학생의 생성이 완료되었습니다.\n전체를 다시 작성하시겠습니까? (기존 내용은 덮어씌워집니다)")) {
                forceRegenerate = true;
            } else {
                return;
            }
        }

        setIsGenerating(true);
        for (const student of students) {
            if (forceRegenerate || student.status !== "success") {
                await generateForStudent(student);
            }
        }
        setIsGenerating(false);
        alert("모든 학생의 생성이 완료되었습니다.");
    };

    const downloadExcel = () => {
        const hasContent = students.some(s => s.result && s.result.trim() !== "");
        if (!hasContent) {
            alert("생성된 내용이 없습니다.");
            return;
        }

        const data = students.map(s => {
            const row = {
                "번호": s.id,
                "성명": s.name,
            };
            row["활동별 성취도"] = activities.map((_, index) => `활동${index + 1}:${getActivityGrade(s, index)}`).join(", ");
            row["세부능력 및 특기사항"] = s.result;
            return row;
        });
        writeExcel(data, "과세특_결과.xlsx");
    };

    return (
        <div className="container py-12">
            <div className="hero-section animate-fade-in">
                <h1 className="hero-title">과세특(자유학기 세특)</h1>
                <p className="hero-subtitle">
                    특정 과목 시간에 활동한 내용을 바탕으로
                    <br />
                    <span className="highlight hero-subtitle-emphasis">과목별(자유학기) 세부능력 및 특기사항</span>을 생성합니다.
                </p>
            </div>

            {/* Top Section: Settings & Activities */}
            <div className="grid-2-cols mb-8 animate-fade-in" style={{ animationDelay: "0.1s" }}>

                {/* Student Settings */}
                <div className="section-card card-blue h-full">
                    <div className="card-header">
                        <div className="card-header-icon">
                            <Users size={20} />
                        </div>
                        <h2>학생 설정</h2>
                    </div>
                    <div className="flex flex-col gap-6">
                        <div className="form-group">
                            <label className="form-label">학생 수</label>
                            {!isManualInput ? (
                                <select
                                    value={studentCount}
                                    onChange={handleStudentCountChange}
                                    className="form-select"
                                >
                                    {[...Array(30)].map((_, i) => (
                                        <option key={i} value={i + 1}>{i + 1}명</option>
                                    ))}
                                    <option value="manual">직접 입력...</option>
                                </select>
                            ) : (
                                <div className="flex gap-2">
                                    <input
                                        type="number"
                                        value={manualCountValue}
                                        onChange={(e) => setManualCountValue(e.target.value)}
                                        placeholder="명수 입력"
                                        className="form-input"
                                        autoFocus
                                    />
                                    <button
                                        onClick={handleManualCountSubmit}
                                        className="btn-primary"
                                        style={{ padding: '8px 16px', fontSize: '0.9rem' }}
                                    >
                                        확인
                                    </button>
                                    <button
                                        onClick={() => setIsManualInput(false)}
                                        className="btn-secondary"
                                        style={{ padding: '8px 16px', fontSize: '0.9rem' }}
                                    >
                                        취소
                                    </button>
                                </div>
                            )}
                        </div>

                        <div className="form-group">
                            <label className="form-label">명렬표 업로드 (엑셀)</label>
                            <div className="flex gap-2 items-center">
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    onChange={handleFileUpload}
                                    accept=".xlsx, .xls"
                                    className="hidden"
                                />
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    className="btn-secondary flex-1 justify-center"
                                >
                                    엑셀 파일 선택
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Activity Inputs */}
                <div className="section-card card-purple h-full">
                    <div className="card-header">
                        <div className="card-header-icon">
                            <FileSpreadsheet size={20} />
                        </div>
                        <h2>활동 내용 입력</h2>
                    </div>
                    <div className="flex flex-col gap-4">
                        <div className="grid-2-cols gap-4">
                            <div className="form-group mb-0">
                                <label className="form-label">학교급</label>
                                <select
                                    value={schoolLevel}
                                    onChange={(e) => setSchoolLevel(e.target.value)}
                                    className="form-select"
                                >
                                    <option value="elementary">초등학교</option>
                                    <option value="middle">중학교</option>
                                    <option value="high">고등학교</option>
                                </select>
                            </div>
                            <div className="form-group mb-0">
                                <label className="form-label">과목/프로그램명</label>
                                <input
                                    type="text"
                                    value={subjectName}
                                    onChange={(e) => setSubjectName(e.target.value)}
                                    placeholder="예: 국어, 진로캠프"
                                    className="form-input"
                                />
                            </div>
                        </div>
                        <hr className="border-gray-200" />
                        {activities.map((activity, index) => (
                            <div key={index} className="flex gap-2">
                                <input
                                    ref={el => activityInputRefs.current[index] = el}
                                    type="text"
                                    value={activity}
                                    onChange={(e) => updateActivity(index, e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            addActivity();
                                        }
                                    }}
                                    placeholder={`활동 내용 ${index + 1}`}
                                    className="form-input"
                                />
                                {activities.length > 1 && (
                                    <button onClick={() => removeActivity(index)} className="btn-icon danger">
                                        <Trash2 size={18} />
                                    </button>
                                )}
                            </div>
                        ))}
                        <button
                            onClick={addActivity}
                            className="w-full"
                            style={{
                                padding: '12px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '8px',
                                backgroundColor: '#8b5cf6',
                                color: 'white',
                                borderRadius: '8px',
                                fontWeight: 'bold',
                                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                                transition: 'background-color 0.2s'
                            }}
                            onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#7c3aed'}
                            onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#8b5cf6'}
                        >
                            <Plus size={18} /> 활동 추가
                        </button>

                        {/* 추가 지침 사항 */}
                        <div className="form-group" style={{ marginTop: '16px', marginBottom: 0 }}>
                            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ color: '#dc2626', fontWeight: 'bold' }}>⚠</span>
                                추가 지침 사항 (선택)
                            </label>
                            <textarea
                                value={additionalInstructions}
                                onChange={(e) => setAdditionalInstructions(e.target.value)}
                                placeholder="예: 축구는 단체 경기가 아닌 개인별 수행 내용을 기준으로 작성해 주세요."
                                className="form-textarea"
                                style={{
                                    minHeight: '70px',
                                    fontSize: '0.9rem',
                                    resize: 'vertical',
                                    borderColor: '#fecaca',
                                    backgroundColor: '#fef2f2'
                                }}
                            />
                            <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: '4px' }}>
                                위 지침은 AI가 최우선으로 엄격히 준수합니다.
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Middle Section: Generation Options */}
            <div className="mb-12 animate-fade-in" style={{ animationDelay: "0.2s" }}>
                <div className="section-card card-orange">
                    <div className="card-header">
                        <div className="card-header-icon">
                            <Wand2 size={20} />
                        </div>
                        <h2>생성 옵션</h2>
                    </div>
                    <div className="grid-2-cols">
                        <div className="flex flex-col gap-4">
                            <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label">글자수 제한</label>
                                <select
                                    value={textLength}
                                    onChange={(e) => setTextLength(e.target.value)}
                                    className="form-select"
                                >
                                    <option value="1500">1500byte (한글 약 490자)</option>
                                    <option value="1000">1000byte (한글 약 333자)</option>
                                    <option value="600">600byte (한글 약 200자)</option>
                                    <option value="manual">직접 입력</option>
                                </select>
                                {textLength === "manual" && (
                                    <input
                                        type="number"
                                        value={manualLength}
                                        onChange={(e) => setManualLength(e.target.value)}
                                        placeholder="byte 단위 입력 (예: 800)"
                                        className="form-input mt-2"
                                    />
                                )}
                            </div>

                            <label
                                className="form-label"
                                style={{
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    gap: '10px',
                                    padding: '12px',
                                    border: '1px solid #fed7aa',
                                    borderRadius: '8px',
                                    backgroundColor: '#fff7ed',
                                    cursor: 'pointer',
                                    lineHeight: 1.45
                                }}
                            >
                                <input
                                    type="checkbox"
                                    checked={useWebSearchContext}
                                    onChange={(e) => setUseWebSearchContext(e.target.checked)}
                                    style={{ marginTop: '3px', flexShrink: 0 }}
                                />
                                <span>
                                    <strong>학생 개별 활동 내용 웹 검색 보강</strong>
                                    <br />
                                    <span style={{ color: '#6b7280', fontSize: '0.8rem', fontWeight: 400 }}>
                                        학생별 개별 활동 내용을 검색해 작품, 논문, 연구, 쟁점의 맥락을 보강합니다.
                                    </span>
                                </span>
                            </label>

                            <div className="flex gap-2">
                                <button
                                    onClick={generateAll}
                                    disabled={isGenerating}
                                    className="btn-primary flex-1"
                                    style={{ padding: '12px', fontSize: '1.1rem' }}
                                >
                                    {isGenerating ? (
                                        <>
                                            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                                            {generationStatusText}
                                        </>
                                    ) : (
                                        <>
                                            <Wand2 size={20} /> AI 생성
                                        </>
                                    )}
                                </button>
                                <button
                                    onClick={downloadExcel}
                                    className="btn-secondary"
                                    style={{ padding: '0 24px', display: 'flex', alignItems: 'center', gap: '8px' }}
                                >
                                    <Download size={20} /> 엑셀
                                </button>
                            </div>
                        </div>

                        <div className="flex flex-col gap-3">
                            <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label">AI 모델</label>
                                <select
                                    value={selectedModel}
                                    onChange={(e) => setSelectedModel(e.target.value)}
                                    className="form-select"
                                >
                                    {AVAILABLE_MODELS.map((m) => (
                                        <option key={m.id} value={m.id}>{getModelOptionLabel(m)}</option>
                                    ))}
                                </select>
                            </div>

                            <OpenAIKeyControl
                                openAIKeyInput={openAIKeyInput}
                                setOpenAIKeyInput={setOpenAIKeyInput}
                                applyOpenAIKey={applyOpenAIKey}
                                clearOpenAIKey={clearOpenAIKey}
                                isOpenAIKeyApplied={isOpenAIKeyApplied}
                                maskedOpenAIKey={maskedOpenAIKey}
                                selectedOpenAIModel={selectedOpenAIModel}
                                setSelectedOpenAIModel={setSelectedOpenAIModel}
                                usesUpstageModel={isUpstageSelected}
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Bottom Section: Student List */}
            <div className="animate-fade-in" style={{ animationDelay: "0.3s" }}>
                <div className="flex justify-between items-center mb-4" style={{ padding: '0 8px' }}>
                    <h2 className="text-2xl font-bold" style={{ color: '#1f2937' }}>
                        학생 목록 <span style={{ color: '#2563eb' }}>({students.length}명)</span>
                    </h2>
                </div>

                <div className="flex flex-col gap-6">
                    {students.map((student) => (
                        <div key={student.id} className="section-card p-6 relative" style={{ overflow: 'visible' }}>
                            <div className="student-card-grid">
                                {/* Student Info (Left) */}
                                <div className="flex flex-col gap-4">
                                    <div className="flex items-center gap-3">
                                        <span style={{
                                            width: '40px', height: '40px', borderRadius: '50%',
                                            backgroundColor: '#dbeafe', color: '#2563eb',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            fontWeight: 'bold', fontSize: '1.1rem', flexShrink: 0
                                        }}>
                                            {student.id}
                                        </span>
                                        <input
                                            type="text"
                                            value={student.name}
                                            onChange={(e) => updateStudent(student.id, "name", e.target.value)}
                                            placeholder="이름"
                                            className="form-input"
                                        />
                                    </div>

                                    <div className="activity-grade-panel">
                                        <div className="activity-grade-title">활동별 성취도</div>
                                        {activities.map((activity, activityIndex) => (
                                            <div key={activityIndex} className="activity-grade-row">
                                                <span
                                                    className="activity-grade-label"
                                                    title={activity || `활동 ${activityIndex + 1}`}
                                                >
                                                    활동 {activityIndex + 1}
                                                </span>
                                                <div className="activity-grade-buttons">
                                                    {GRADE_OPTIONS.map((grade) => (
                                                        <button
                                                            key={grade}
                                                            type="button"
                                                            onClick={() => updateStudentActivityGrade(student.id, activityIndex, grade)}
                                                            className={`btn-grade btn-grade-sm ${getActivityGrade(student, activityIndex) === grade ? `selected grade-${grade}` : ''}`}
                                                        >
                                                            {grade}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    {/* 학생별 개별 활동 내용 입력 */}
                                    <div className="form-group" style={{ marginBottom: 0, marginTop: '8px' }}>
                                        <textarea
                                            value={student.individualActivity}
                                            onChange={(e) => updateStudent(student.id, "individualActivity", e.target.value)}
                                            placeholder="학생별 개별적으로 활동한 내용을 입력해주세요."
                                            className="form-textarea"
                                            style={{
                                                minHeight: '60px',
                                                fontSize: '0.85rem',
                                                resize: 'vertical'
                                            }}
                                        />
                                    </div>

                                    {/* Action Buttons (Generate & Clear) */}
                                    <div className="flex gap-2 mt-4">
                                        <button
                                            onClick={() => generateForStudent(student)}
                                            className="flex-1 btn-secondary"
                                            style={{
                                                padding: '8px',
                                                fontSize: '0.85rem',
                                                justifyContent: 'center',
                                                borderColor: '#dbeafe',
                                                color: '#2563eb'
                                            }}
                                            title="이 학생만 다시 생성"
                                        >
                                            <Wand2 size={16} /> 개별 생성
                                        </button>
                                        <button
                                            onClick={() => updateStudent(student.id, "result", "")}
                                            className="flex-1 btn-secondary"
                                            style={{
                                                padding: '8px',
                                                fontSize: '0.85rem',
                                                justifyContent: 'center',
                                                color: '#ef4444',
                                                borderColor: '#fee2e2'
                                            }}
                                            title="생성된 내용 지우기"
                                        >
                                            <Trash2 size={16} /> 내용 지우기
                                        </button>
                                    </div>
                                </div>

                                {/* Result Area (Center) */}
                                <div className="flex flex-col gap-2 relative flex-1">
                                    {/* Delete Button Row (Above Textarea) */}
                                    <div className="flex justify-end" style={{ height: '24px' }}>
                                        {students.length > 1 && (
                                            <button
                                                onClick={() => removeStudent(student.id)}
                                                className="btn-icon danger"
                                                title="해당 학생 정보를 삭제합니다"
                                                style={{ padding: '4px' }}
                                            >
                                                <UserX size={20} />
                                            </button>
                                        )}
                                    </div>

                                    <div className="relative w-full">
                                        <textarea
                                            value={student.result}
                                            ref={(element) => {
                                                resultTextareaRefs.current[student.id] = element;
                                            }}
                                            onChange={(e) => {
                                                updateStudent(student.id, "result", e.target.value);
                                                adjustTextareaHeight(e.target);
                                            }}
                                            onInput={(e) => adjustTextareaHeight(e.target)}
                                            placeholder="AI 생성 결과가 여기에 표시됩니다."
                                            className="form-textarea textarea-auto w-full"
                                        />

                                        {/* Loading Overlay */}
                                        {student.status === "loading" && (
                                            <div className="loading-overlay">
                                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-2"></div>
                                                <span style={{ fontSize: '0.9rem', fontWeight: 500, color: '#2563eb' }}>
                                                    {student.progress || generationStatusText}
                                                </span>
                                            </div>
                                        )}
                                    </div>

                                    {/* 결과 정보 및 복사 버튼 */}
                                    {student.result && (
                                        <div className="result-action-row">
                                            <span className="result-byte-count">
                                                {getUtf8ByteLength(student.result).toLocaleString()} byte
                                            </span>
                                            <button
                                                onClick={() => {
                                                    const copyText = (text) => {
                                                        if (navigator.clipboard && window.isSecureContext) {
                                                            navigator.clipboard.writeText(text);
                                                        } else {
                                                            const textarea = document.createElement('textarea');
                                                            textarea.value = text;
                                                            textarea.style.position = 'fixed';
                                                            textarea.style.opacity = '0';
                                                            document.body.appendChild(textarea);
                                                            textarea.select();
                                                            document.execCommand('copy');
                                                            document.body.removeChild(textarea);
                                                        }
                                                    };
                                                    copyText(student.result);
                                                    setCopiedId(student.id);
                                                    setTimeout(() => setCopiedId(null), 1500);
                                                }}
                                                className={`btn-copy ${copiedId === student.id ? 'copied' : ''}`}
                                                title="클립보드에 복사"
                                            >
                                                {copiedId === student.id ? (
                                                    <><Check size={14} /> 복사됨!</>
                                                ) : (
                                                    <><Copy size={14} /> 복사</>
                                                )}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
