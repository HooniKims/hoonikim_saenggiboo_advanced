"use client";

import { useState, useRef, useEffect } from "react";
import { Plus, Trash2, Upload, Download, Wand2, FileSpreadsheet, Users, UserX, Copy, Check } from "lucide-react";
import * as XLSX from "xlsx";
import { writeExcel } from "../../utils/excel";
import { getCharacterGuideline, getMinimumTargetBytes, getUtf8ByteLength, normalizeTargetBytes, normalizeTargetChars } from "../../utils/textProcessor";
import { fetchStream, AVAILABLE_MODELS, DEFAULT_MODEL, getModelOptionLabel, isLightweightModel, isNvidiaModel } from "../../utils/streamFetch";
import { fetchNvidiaCompletion } from "../../utils/nvidiaFetch";
import { fetchOpenAICompletion } from "../../utils/openAIFetch";
import { useOpenAIKey } from "../../utils/openAIKey";
import OpenAIKeyControl from "../../components/OpenAIKeyControl";
import { generateWithSilentValidation } from "../../utils/generationHarness";
import { getGenerationProvider, runGenerationWithProgress } from "../../utils/generationProgress";
import { fetchSearchContext } from "../../utils/searchContextFetch";
import { getClubHighSchoolQualityGuidance } from "../../utils/recordQualityGuidance";
import { limitActivitiesByTargetChars, mergeNumberedIndividualActivities, shouldSelectRandomFourActivities } from "../../utils/activitySelection";

export default function ClubPage() {
    // State
    const [studentCount, setStudentCount] = useState(1);
    const [isManualInput, setIsManualInput] = useState(false);
    const [manualCountValue, setManualCountValue] = useState("");

    const [clubName, setClubName] = useState(""); // Changed from subjectName
    const [schoolLevel, setSchoolLevel] = useState("middle"); // Default to middle

    // Removed 'grade' from student object, added 'individualActivity' for per-student activities
    const [students, setStudents] = useState([{ id: 1, name: "", individualActivity: "", result: "", status: "idle", progress: "" }]);
    const [activities, setActivities] = useState([""]);
    const [additionalInstructions, setAdditionalInstructions] = useState(""); // 추가 지침 사항
    const [textLength, setTextLength] = useState("1500");
    const [manualLength, setManualLength] = useState("");
    const [isGenerating, setIsGenerating] = useState(false);
    const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
    const [useWebSearchContext, setUseWebSearchContext] = useState(false);
    const [copiedId, setCopiedId] = useState(null);
    const fileInputRef = useRef(null);
    const activityInputRefs = useRef([]);
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
    const generationStatusText = isNvidiaSelected
        ? "NVIDIA NIM 모델로 생성 중..."
        : appliedOpenAIKey ? "OpenAI API key를 사용하여 생성 중..." : "생성 중...";

    useEffect(() => {
        if (activities.length > prevActivitiesLength.current) {
            const lastIndex = activities.length - 1;
            activityInputRefs.current[lastIndex]?.focus();
        }
        prevActivitiesLength.current = activities.length;
    }, [activities]);

    // Auto-resize textarea
    const adjustTextareaHeight = (element) => {
        if (element) {
            element.style.height = "auto";
            element.style.height = element.scrollHeight + "px";
        }
    };

    // Handlers
    const updateStudentList = (count) => {
        const newStudents = [...students];
        if (count > newStudents.length) {
            for (let i = newStudents.length + 1; i <= count; i++) {
                newStudents.push({ id: i, name: "", individualActivity: "", result: "", status: "idle", progress: "" });
            }
        } else {
            newStudents.splice(count);
        }
        setStudents(newStudents);
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
        if (count > 0 && count <= 100) {
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

            let nameColIndex = -1;
            let activityColIndex = -1;
            let headerRowIndex = -1;

            // 1. Find the header row, "성명" column, and "활동 내용" column
            for (let i = 0; i < data.length; i++) {
                const row = data[i];
                // 헤더 행의 모든 열 이름 출력 (디버깅용)
                if (i === 0) {
                    console.log("[엑셀 파싱] 헤더 행:", row.map((cell, idx) => `[${idx}]${String(cell).trim()}`).join(" | "));
                }
                for (let j = 0; j < row.length; j++) {
                    const cellValue = String(row[j]).trim().replace(/\s/g, ""); // Remove spaces
                    if (cellValue === "성명" || cellValue === "이름") {
                        nameColIndex = j;
                        headerRowIndex = i;
                    }
                    // 활동 내용 열 인식: 다양한 키워드 지원
                    if (cellValue.includes("활동") || cellValue.includes("내용") ||
                        cellValue.includes("관찰내용") || cellValue.includes("관찰기록") ||
                        cellValue.includes("세부능력") || cellValue.includes("특기사항") ||
                        cellValue.includes("세특") || cellValue.includes("개별활동")) {
                        activityColIndex = j;
                    }
                }
                if (nameColIndex !== -1) break;
            }

            console.log(`[엑셀 파싱] nameColIndex: ${nameColIndex} activityColIndex: ${activityColIndex} headerRowIndex: ${headerRowIndex}`);

            const newStudents = [];
            let idCounter = 1;

            // 2. Extract names and activities if columns found
            if (nameColIndex !== -1) {
                for (let i = headerRowIndex + 1; i < data.length; i++) {
                    const row = data[i];
                    const name = row[nameColIndex];
                    const activity = activityColIndex !== -1 ? row[activityColIndex] : "";
                    if (name && typeof name === 'string' && name.trim() !== "") {
                        const individualActivity = activity && typeof activity === 'string' ? activity.trim() : "";
                        newStudents.push({ id: idCounter++, name: name.trim(), individualActivity, result: "", status: "idle" });
                        if (individualActivity) {
                            console.log(`[엑셀 파싱] 학생: ${name.trim()} 활동내용: ${individualActivity}`);
                        }
                    }
                }
            } else {
                for (let i = 0; i < data.length; i++) {
                    const row = data[i];
                    for (let j = 0; j < Math.min(row.length, 3); j++) {
                        const val = row[j];
                        if (typeof val === 'string' && val.length > 1 && val.length < 10) {
                            if (val !== "성명" && val !== "이름") {
                                newStudents.push({ id: idCounter++, name: val.trim(), individualActivity: "", result: "", status: "idle" });
                                break;
                            }
                        }
                    }
                }
            }

            if (newStudents.length > 0) {
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
        setActivities(newActivities.length ? newActivities : [""]);
    };
    const updateActivity = (index, value) => {
        const newActivities = [...activities];
        newActivities[index] = value;
        setActivities(newActivities);
    };

    const updateStudent = (id, field, value) => {
        setStudents(prevStudents => prevStudents.map(s => s.id === id ? { ...s, [field]: value } : s));
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

    // 학생별 개별 활동과 공통 활동 간의 관련성 점수 계산
    const calculateRelevanceScore = (commonActivity, individualActivity) => {
        if (!individualActivity || !commonActivity) return 0;
        const commonWords = commonActivity.toLowerCase().split(/\s+/);
        const individualWords = individualActivity.toLowerCase().split(/\s+/);
        let score = 0;
        for (const word of commonWords) {
            if (word.length > 1 && individualWords.some(iw => iw.includes(word) || word.includes(iw))) {
                score += 1;
            }
        }
        return score;
    };

    const generatePrompt = (student, selectedActivities, targetChars, individualActivity = "", model = "", searchContext = "") => {
        // Perspectives for variety
        const perspectives = [
            '특히 학생의 적극성과 참여도를 중심으로',
            '특히 협업 능력과 소통 능력을 중심으로',
            '특히 리더십과 책임감을 중심으로',
            '특히 창의성과 문제 해결 능력을 중심으로',
            '특히 성실성과 지속적인 노력을 중심으로',
            '특히 성장 과정과 태도 변화를 중심으로',
            '특히 진로 연계성과 전문성 발전을 중심으로',
            '특히 자기주도성과 탐구 능력을 중심으로'
        ];

        const selectedPerspective = perspectives[(student.id - 1) % perspectives.length];
        const openingStyleGuides = [
            "문제의식형: 활동 주제에 대한 궁금증이나 고민을 가지고 출발",
            "탐구 과정형: 주제를 탐구하는 과정에서 보인 조사, 비교, 분석 중심",
            "보고서 정리형: 보고서 작성을 통해 자료를 구조화하고 해석한 과정 중심",
            "실험 설계형: 조건을 비교하거나 변인을 확인하는 실험 설계와 관찰 중심",
            "자료 분석형: 관련 자료, 사례, 수치, 근거를 분석하며 생각을 확장한 과정 중심",
            "협업 토의형: 팀원과 의견을 나누고 역할을 조율한 과정 중심",
            "한계 개선형: 활동 중 발견한 한계나 오류를 보완하려는 시도 중심",
            "발표 공유형: 정리한 내용을 발표하거나 공유하며 이해를 넓힌 과정 중심",
        ];
        const selectedOpeningStyle = openingStyleGuides[Math.floor(Math.random() * openingStyleGuides.length)];

        let minChar, maxChar;
        if (targetChars === 200) {
            minChar = 150; maxChar = 200;
        } else if (targetChars === 490) {
            minChar = 400; maxChar = 490;
        } else {
            minChar = Math.floor(targetChars * 0.8);
            maxChar = targetChars;
        }

        const targetBytes = normalizeTargetBytes(textLength, manualLength);
        const lengthInstruction = getCharacterGuideline(targetChars, targetBytes, getMinimumTargetBytes(targetBytes));

        const schoolLevelMap = {
            elementary: "초등학생",
            middle: "중학생",
            high: "고등학생"
        };
        const targetLevel = schoolLevelMap[schoolLevel] || "중학생";
        // 동아리명은 시스템 참고용으로만 전달 (출력에 절대 포함 금지)
        const clubContext = clubName ? `[시스템 참고 - 출력에 절대 포함 금지] 동아리: ${clubName}` : "";

        const mappedActivityEntries = selectedActivities.map((activity, index) => {
            if (typeof activity === "string") {
                return {
                    text: activity.trim(),
                    originalIndex: index,
                };
            }
            return {
                text: String(activity.text || "").trim(),
                originalIndex: Number.isInteger(activity.originalIndex) ? activity.originalIndex : index,
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

        // 활동별 글자수 할당량 계산 (경량 모델용)
        const charsPerActivity = totalActivities > 0 ? Math.floor(targetChars / totalActivities) : targetChars;
        const activityAllocation = selectedActivityEntries.map((entry, i) =>
            `활동${i + 1}("${entry.text.substring(0, 15)}${entry.text.length > 15 ? '...' : ''}"): 약 ${charsPerActivity}자`
        ).join(", ");

        const individualActivityText = remainingIndividualActivity.trim()
            ? `\n\n[이 학생의 개별 활동 내용]\n${remainingIndividualActivity}\n(위 개별 활동 내용은 반드시 최종 본문에 반영해야 하는 학생별 수행 내용입니다. 활동 내용 목록의 순서를 유지하고, 개별 활동 내용을 첫 문장이나 첫 활동처럼 우선 배치하지 않음. 개별 활동의 핵심어와 구체적 수행 내용을 누락하지 않음. 공통 활동 흐름 안에서 필요한 곳에 자연스럽게 통합해 주세요.)`
            : "";
        const searchContextText = searchContext.trim()
            ? `\n\n[학생 개별 활동 내용 기반 웹 검색 보강 자료]\n${searchContext}\n(위 검색 보강 자료는 개별 활동을 정확히 이해하기 위한 배경 자료입니다. 학생이 실제로 입력한 활동과 공통 활동 내용을 우선하고, 검색 자료는 관련 개념·활동 맥락·쟁점 이해를 보강하는 데에만 사용하세요.)`
            : "";
        const highSchoolQualityGuidance = getClubHighSchoolQualityGuidance(schoolLevel);
        const highSchoolQualityText = highSchoolQualityGuidance
            ? `\n\n${highSchoolQualityGuidance}`
            : "";

        const isLightweight_ = isLightweightModel(model || selectedModel);

        if (isLightweight_) {
            // 경량 모델용: 간결하고 명확한 프롬프트
            return `동아리 특기사항 본문을 작성하세요.

대상: ${targetLevel}
${clubContext}
작성 관점: ${selectedPerspective} 서술하세요.
첫 문장 시작 방식: ${selectedOpeningStyle}

[활동 내용 - 총 ${totalActivities}개, 모두 반영 필수]
${activitiesText}${individualActivityText}${searchContextText}
${highSchoolQualityText}

[활동별 할당량] ${activityAllocation}

[절대금지]
❌ 동아리명 출력 금지 ("~동아리에서", "~반에서" 등 전부 금지)
❌ 과거형 금지 (~했음, ~였음, ~되었음, ~하였음, ~보였음 전부 금지)
❌ 주어 금지 ("학생은", "OO는" 금지)
❌ 요약/마무리 문장 금지
❌ '마지막으로', '끝으로', '마무리하며', '덧붙여', '추가로' 사용 금지

[필수]
✅ 현재형 종결어미만 사용: ~함, ~임, ~음, ~보임, ~드러남
✅ 위 ${totalActivities}개 활동을 모두 다양한 표현으로 서술
✅ 첫 문장은 반드시 위 [활동 내용]의 활동1 공통 활동으로 시작하고, 개별 활동 내용이나 검색 보강 자료를 첫 활동처럼 앞세우지 않음
✅ 활동1의 핵심 소재는 유지하되 활동명을 그대로 베껴 시작하지 않음. 첫 문장 시작 방식과 예시 표현을 그대로 복사하지 말고 입력 활동에 맞춰 새 문장으로 자연스럽게 변주
✅ 줄바꿈 없이 하나의 문단
✅ 오직 본문만 출력

${lengthInstruction}

[좋은 예시]
"환경 보전 칠페인 기획 과정에서 자료 조사를 담당하여 통계 데이터를 수집하고 인포그래픽으로 제작함. 활동 후 결과 보고서를 작성하여 팀원들과 공유함."
`;
        }

        return `당신은 학교생활기록부 동아리 활동 특기사항을 작성하는 교사입니다.
아래 ${totalActivities}개의 활동 내용을 바탕으로 동아리 세특 본문을 작성하세요.
모든 활동을 빠짐없이 반영하되, 각 활동마다 다양한 표현과 구체적인 서술을 사용하세요.

<입력 정보>
대상: ${targetLevel}
${clubContext}
작성 관점: ${selectedPerspective} 서술하세요.
첫 문장 시작 방식: ${selectedOpeningStyle}

<활동 내용 - 총 ${totalActivities}개, 반드시 모두 반영>
${activitiesText}${individualActivityText}${searchContextText}
${highSchoolQualityText}

<작성 규칙>
1. '학생은', 'OO는' 등 주어를 사용하지 않고, 활동 내용부터 바로 서술
2. [절대금지] 동아리명을 출력에 절대 포함하지 않음 (예: "~동아리에서", "~반에서" 등 금지)
3. [절대금지] 과거형 표현 금지 (~했음, ~였음, ~되었음, ~하였음, ~보였음). 반드시 현재형 명사 종결어미(~함, ~보임, ~드러남, ~임, ~음)만 사용
4. 구체적인 활동 과정, 노력, 태도 변화를 중심으로 과정 중심 서술
5. 줄바꿈 없이 하나의 문단으로 작성
6. 입력된 ${totalActivities}개 활동 내용을 모두 빠짐없이 서술하고, 입력에 없는 사건/실험 결과/도서명 등을 추가하지 않음
7. 첫 문장은 반드시 위 <활동 내용>의 활동1 공통 활동으로 시작하고, [이 학생의 개별 활동 내용]이나 검색 보강 자료를 첫 활동처럼 앞세우지 않음
8. 활동1의 핵심 소재는 유지하되 활동명을 그대로 베껴 시작하지 않음. 특히 "과학 실험 보고서 작성에서"처럼 고정된 명사구로 시작하지 말고, 첫 문장 시작 방식과 예시 표현을 그대로 복사하지 말고 입력 활동에 맞춰 새 문장으로 다양하게 변주함
9. 소논문, 특정 성명, 기관명, 상호명은 기재하지 않음
10. 마지막 문장도 반드시 구체적인 활동 내용 서술로 끝냄
11. '이러한', '이를 통해', '이와 같이', '앞으로', '향후', '결과적으로', '종합적으로', '마지막으로', '끝으로', '마무리하며', '덧붙여', '추가로'로 시작하는 요약/정리/마무리 문장 대신, 활동의 세부 과정이나 협력 모습을 추가 서술

${lengthInstruction}

<출력 형식>
- 오직 동아리 특기사항 본문 텍스트만 출력
- 글자수 표기, 분석, 검증 포인트, 부가 설명 등 메타 정보는 출력하지 않음

<좋은 예시>
"환경 보전 칠페인 기획 과정에서 자료 조사를 담당하여 미세먼지 관련 통계 데이터를 수집하고 인포그래픽으로 제작함. 칠페인 당일 홍보 부스를 운영하며 참여 학생들에게 분리수거 방법을 안내하는 등 적극적인 모습을 보임."
    `;
    };

    // 시간 순서 키워드 감지 (동아리 활동의 순서성 판단)
    const hasTimeOrder = (acts) => {
        const timeKeywords = ['1학기', '2학기', '1차', '2차', '3차', '4차',
            '1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월',
            '첫 번째', '두 번째', '세 번째', '네 번째',
            '초반', '중반', '후반', '전반기', '후반기'];
        return acts.some(a => timeKeywords.some(kw => a.includes(kw)));
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
                originalIndex,
            }))
            .filter(entry => entry.text !== "");
        const validActivities = validActivityEntries.map(entry => entry.text);
        if (validActivityEntries.length === 0 && !student.individualActivity?.trim()) {
            alert("활동 내용을 입력해주세요.");
            return;
        }

        const targetBytes = normalizeTargetBytes(textLength, manualLength);
        const targetChars = normalizeTargetChars(textLength, manualLength);
        const minTargetBytes = getMinimumTargetBytes(targetBytes);

        let selectedActivityEntries = [...validActivityEntries];
        const forceRandomFourActivities = shouldSelectRandomFourActivities(additionalInstructions);

        // 동아리세특: 조건부 랜덤 셔플
        if (forceRandomFourActivities) {
            selectedActivityEntries = shuffleArray(validActivityEntries).slice(0, Math.min(4, validActivityEntries.length));
        } else if (student.individualActivity?.trim() && validActivityEntries.length > 0) {
            // 개별 활동이 있으면 관련성 높은 활동 우선 + 나머지 랜덤
            selectedActivityEntries = [...validActivityEntries].sort((a, b) => {
                const scoreA = calculateRelevanceScore(a.text, student.individualActivity);
                const scoreB = calculateRelevanceScore(b.text, student.individualActivity);
                if (scoreB !== scoreA) return scoreB - scoreA;
                return Math.random() - 0.5;
            });
        } else if (hasTimeOrder(validActivities)) {
            // 시간 순서 키워드가 있으면 순서 유지 (다양한 표현은 프롬프트로 유도)
            // selectedActivityEntries = 원래 순서 유지
        } else {
            // 순서성 없으면 Fisher-Yates 셔플로 랜덤화
            selectedActivityEntries = shuffleArray(validActivityEntries);
        }

        // Activity Selection Logic based on Target Chars
        selectedActivityEntries = limitActivitiesByTargetChars(selectedActivityEntries, targetChars);
        // 350자 초과: 모든 활동 사용

        try {
            updateStudent(student.id, "status", "loading");
            updateStudent(student.id, "progress", "생성 준비 중...");
            let searchContext = "";
            if (useWebSearchContext && student.individualActivity?.trim()) {
                try {
                    updateStudent(student.id, "progress", "웹 검색 보강 중...");
                    const searchResult = await fetchSearchContext({
                        subjectName: clubName,
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

            const promptModel = isNvidiaSelected ? selectedModel : appliedOpenAIKey ? `openai:${selectedOpenAIModel}` : selectedModel;
            const prompt = generatePrompt(
                student,
                selectedActivityEntries,
                targetChars,
                student.individualActivity || "",
                promptModel,
                searchContext
            );
            const generationResult = await generateWithSilentValidation({
                prompt,
                maxTargetBytes: targetBytes,
                minTargetBytes,
                targetChars,
                mode: "record",
                forbiddenTerms: [clubName, student.name],
                maxRepairAttempts: 1,
                generateOnce: (nextPrompt, { attempt, previousValidation }) => runGenerationWithProgress({
                    attempt,
                    previousValidation,
                    provider: getGenerationProvider({ isNvidiaSelected, hasOpenAIKey: Boolean(appliedOpenAIKey) }),
                    setProgress: (message) => updateStudent(student.id, "progress", message),
                    run: () => isNvidiaSelected
                        ? fetchNvidiaCompletion({ prompt: nextPrompt, additionalInstructions, targetChars, model: selectedModel })
                        : appliedOpenAIKey
                            ? fetchOpenAICompletion({ prompt: nextPrompt, additionalInstructions, apiKey: appliedOpenAIKey, targetChars, model: selectedOpenAIModel })
                            : fetchStream({ prompt: nextPrompt, additionalInstructions, model: selectedModel, targetChars }),
                }),
            });

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

        const data = students.map(s => ({
            "번호": s.id,
            "성명": s.name,
            "동아리 활동 특기사항": s.result
        }));
        writeExcel(data, "동아리세특_결과.xlsx");
    };

    return (
        <div className="container py-12">
            <div className="hero-section animate-fade-in">
                <h1 className="hero-title">동아리 세특</h1>
                <p className="hero-subtitle">
                    동아리 활동 내용을 바탕으로 <span className="highlight">동아리 활동 특기사항</span>을 생성합니다.
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
                                <label className="form-label">동아리명</label>
                                <input
                                    type="text"
                                    value={clubName}
                                    onChange={(e) => setClubName(e.target.value)}
                                    placeholder="예: 과학탐구반, 방송반"
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
                                placeholder="예: 토론 활동은 주제와 본인의 입장을 중심으로 작성해 주세요."
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
                                        학생별 개별 활동 내용을 검색해 활동 주제, 개념, 쟁점의 맥락을 보강합니다.
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

                                    {/* Grade Buttons Removed for Club Activity */}

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
