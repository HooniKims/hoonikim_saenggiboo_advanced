"use client";

import { useState, useRef } from "react";
import { Trash2, Download, Wand2, Users, UserX, Copy, Check } from "lucide-react";
import * as XLSX from "xlsx";
import { writeExcel } from "../../utils/excel";
import { getCharacterGuideline, getMinimumTargetBytes, getUtf8ByteLength } from "../../utils/textProcessor";
import { fetchStream, AVAILABLE_MODELS, DEFAULT_MODEL, getModelOptionLabel, isNvidiaModel, isUpstageModel } from "../../utils/streamFetch";
import { fetchNvidiaCompletion } from "../../utils/nvidiaFetch";
import { fetchOpenAICompletion } from "../../utils/openAIFetch";
import { fetchUpstageCompletion } from "../../utils/upstageFetch";
import { useOpenAIKey } from "../../utils/openAIKey";
import OpenAIKeyControl from "../../components/OpenAIKeyControl";
import { generateWithSilentValidation } from "../../utils/generationHarness";
import { generateWithLocalSolarFallback } from "../../utils/localSolarFallback";
import { getGenerationProvider, runGenerationWithProgress } from "../../utils/generationProgress";
import { fetchSearchContext } from "../../utils/searchContextFetch";
import { getBehaviorHighSchoolQualityGuidance } from "../../utils/recordQualityGuidance";
import { getBehaviorLengthTargets } from "../../utils/behaviorLength";

export default function BehaviorPage() {
    // State
    const [studentCount, setStudentCount] = useState(1);
    const [isManualInput, setIsManualInput] = useState(false);
    const [manualCountValue, setManualCountValue] = useState("");

    // Students state now includes 'observation' instead of 'grade'
    const [students, setStudents] = useState([{ id: 1, name: "", observation: "", result: "", status: "idle", progress: "" }]);
    const [schoolLevel, setSchoolLevel] = useState("middle");
    const [additionalInstructions, setAdditionalInstructions] = useState("");
    const [textLength, setTextLength] = useState("900");
    const [manualLength, setManualLength] = useState("");
    const [isGenerating, setIsGenerating] = useState(false);
    const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
    const [useWebSearchContext, setUseWebSearchContext] = useState(false);
    const [copiedId, setCopiedId] = useState(null);
    const fileInputRef = useRef(null);
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
                newStudents.push({ id: i, name: "", observation: "", result: "", status: "idle", progress: "" });
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
            let observationColIndex = -1;
            let headerRowIndex = -1;

            for (let i = 0; i < data.length; i++) {
                const row = data[i];
                // 헤더 행의 모든 열 이름 출력 (디버깅용)
                if (i === 0) {
                    console.log("[엑셀 파싱] 헤더 행:", row.map((cell, idx) => `[${idx}]${String(cell).trim()}`).join(" | "));
                }
                for (let j = 0; j < row.length; j++) {
                    const cellValue = String(row[j]).trim().replace(/\s/g, "");

                    if (cellValue === "성명" || cellValue === "이름") {
                        nameColIndex = j;
                        headerRowIndex = i;
                    }

                    // 행동 관찰 결과 열 인식: 다양한 키워드 지원 (세부능력 및 특기사항 포함)
                    // cellValue는 공백이 제거된 상태이므로 공백 없는 키워드로 비교
                    if (cellValue.includes("관찰 결과") || cellValue.includes("행동 관찰") ||
                        cellValue.includes("행발") || cellValue.includes("행동") ||
                        cellValue.includes("관찰") || cellValue.includes("결과") ||
                        cellValue.includes("특성") || cellValue.includes("종합의견") ||
                        cellValue.includes("세부능력") || cellValue.includes("특기사항") ||
                        cellValue.includes("세특")) {
                        observationColIndex = j;
                    }
                }
                if (nameColIndex !== -1) break;
            }

            const newStudents = [];
            let idCounter = 1;

            console.log("[엑셀 파싱] nameColIndex:", nameColIndex, "observationColIndex:", observationColIndex, "headerRowIndex:", headerRowIndex);

            if (nameColIndex !== -1) {
                for (let i = headerRowIndex + 1; i < data.length; i++) {
                    const row = data[i];
                    const name = row[nameColIndex];
                    const observation = observationColIndex !== -1 ? row[observationColIndex] : "";
                    console.log("[엑셀 파싱] 학생:", name, "관찰결과:", observation);

                    if (name && typeof name === 'string' && name.trim() !== "") {
                        newStudents.push({
                            id: idCounter++,
                            name: name.trim(),
                            observation: observation ? String(observation).trim() : "",
                            result: "",
                            status: "idle"
                        });
                    }
                }
            } else {
                for (let i = 0; i < data.length; i++) {
                    const row = data[i];
                    for (let j = 0; j < Math.min(row.length, 3); j++) {
                        const val = row[j];
                        if (typeof val === 'string' && val.length > 1 && val.length < 10) {
                            if (val !== "성명" && val !== "이름") {
                                newStudents.push({ id: idCounter++, name: val.trim(), observation: "", result: "", status: "idle" });
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

    const generatePrompt = (student, targetChars, targetBytes, searchContext = "") => {
        let minChar, maxChar;
        if (targetChars === 200) {
            minChar = 150; maxChar = 200;
        } else if (targetChars === 490) {
            minChar = 400; maxChar = 490;
        } else {
            minChar = Math.floor(targetChars * 0.8);
            maxChar = targetChars;
        }

        // 글자수 지침은 공통 유틸에서 생성
        const lengthInstruction = getCharacterGuideline(targetChars, targetBytes, getMinimumTargetBytes(targetBytes));
        const observationText = student.observation ? `학생 행동 관찰 내용: ${student.observation}` : "학생 행동 관찰 내용: 일반적인 모범 학생의 특성 (구체적인 입력 없음)";
        const searchContextText = searchContext.trim()
            ? `\n\n[행동 관찰 내용 기반 웹 검색 보강 자료]\n${searchContext}\n(위 검색 보강 자료는 입력된 행동 관찰 내용을 정확히 이해하기 위한 배경 자료입니다. 학생에게 실제로 입력된 관찰 내용을 우선하고, 검색 자료는 인성 요소·공동체 역량·지도 관점 이해를 보강하는 데에만 사용하세요.)`
            : "";
        const highSchoolQualityGuidance = getBehaviorHighSchoolQualityGuidance(schoolLevel);
        const highSchoolQualityText = highSchoolQualityGuidance
            ? `\n\n${highSchoolQualityGuidance}`
            : "";

        return `당신은 학교생활기록부 행동특성 및 종합의견(행발)을 작성하는 교사입니다.
교사가 입력한 관찰 내용을 바탕으로, 학생의 인성, 잠재력, 공동체 역량이 드러나는 행발 본문을 작성하세요.

<입력 정보>
${observationText}${searchContextText}
${highSchoolQualityText}

<작성 규칙>
1. '학생은', 'OO는' 등 주어를 사용하지 않고, 행동 특성과 에피소드부터 바로 서술
2. 배려, 나눔, 협력, 타인 존중, 갈등 관리 등 인성 요소와 잠재력을 구체적 사례 중심으로 서술
3. 단순 나열을 피하고, 일년 동안의 긍정적인 변화와 성장을 보여줄 것
4. 부정적으로 보일 수 있는 특성도 반드시 긍정적이고 발전 가능성이 느껴지는 표현으로 전환 
   (예: 내성적→신중함, 느림→꼼꼼함, 말수적음→경청함, 등)
5. 어떠한 경우에도 부정적 표현("~하지만", "~임에도", "부족하다" 등)은 사용하지 않음
6. 특정 성명, 기관명, 상호명 등은 기재하지 않음
7. 줄바꿈 없이 하나의 문단으로 작성
8. 명사형 종결어미(~함, ~임, ~음)와 함께 마침표(.)로 문장을 완결되게 끝냄
9. '마지막으로', '끝으로', '마무리하며', '덧붙여', '추가로' 같은 마무리 접속어를 사용하지 않음

${lengthInstruction}

<출력 형식>
- 오직 행발 본문 텍스트만 출력
- 글자수 표기, 분석, 검증 포인트, 부가 설명 등 메타 정보는 출력하지 않음

<좋은 예시>
"학급의 궂은일을 도맡아 하며 친구들이 배려와 나눔의 가치를 실천하는 데 모범을 보임. 체육대회 연습 과정에서 의견 충돌이 있는 친구들 사이의 입장을 조율하고 화해를 이끄는 갈등 관리 능력이 뛰어남. 평소 신중하게 접근하고 꼼꼼하게 과제를 수행하여 완성도 높은 결과를 도출하며, 스스로 학습 목표를 세우고 꾸준히 노력하는 자기주도성이 돋보임."
    `;
    };

    const generateForStudent = async (student) => {
        // For behavior, we allow generation even if observation is empty (using default prompt)
        // But let's require at least some input if the user wants specific results.
        // However, to be consistent with "AI generation", we can generate generic good behavior if empty.
        // Let's stick to the prompt logic which handles empty observation.

        const { targetBytes, targetChars, minTargetBytes } = getBehaviorLengthTargets(textLength, manualLength);

        try {
            updateStudent(student.id, "status", "loading");
            updateStudent(student.id, "progress", "생성 준비 중...");
            let searchContext = "";
            if (useWebSearchContext && student.observation?.trim()) {
                try {
                    updateStudent(student.id, "progress", "웹 검색 보강 중...");
                    const searchResult = await fetchSearchContext({
                        subjectName: "행동특성 및 종합의견",
                        commonActivities: [],
                        individualActivity: student.observation,
                    });
                    searchContext = searchResult.context || "";
                    if (searchResult.query) {
                        console.log(`[웹 검색 보강] 학생 ${student.id}: ${searchResult.query}`);
                    }
                } catch (searchError) {
                    console.warn(`[웹 검색 보강 실패] 학생 ${student.id}: ${searchError.message}`);
                }
            }

            const prompt = generatePrompt(student, targetChars, targetBytes, searchContext);
            const validationOptions = {
                maxTargetBytes: targetBytes,
                minTargetBytes,
                targetChars,
                mode: "record",
                forbiddenTerms: [student.name],
            };
            const runLocalGeneration = (nextPrompt, { attempt, previousValidation }) => runGenerationWithProgress({
                attempt,
                previousValidation,
                provider: "local",
                setProgress: (message) => updateStudent(student.id, "progress", message),
                run: () => fetchStream({ prompt: nextPrompt, additionalInstructions, model: selectedModel, targetChars }),
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
                        run: () => fetchUpstageCompletion({ prompt: nextPrompt, additionalInstructions, targetChars }),
                    }),
                })
                : await generateWithSilentValidation({
                    prompt,
                    acceptLengthOnlyResult: !isUpstageSelected,
                    preserveTextOnLengthRepair: isUpstageSelected,
                    stripExpandedGradeLabels: isUpstageSelected,
                    ...validationOptions,
                    maxRepairAttempts: isUpstageSelected ? 4 : 2,
                    generateOnce: (nextPrompt, { attempt, previousValidation }) => runGenerationWithProgress({
                    attempt,
                    previousValidation,
                    provider: getGenerationProvider({ isNvidiaSelected, isUpstageSelected, hasOpenAIKey: Boolean(appliedOpenAIKey) }),
                    setProgress: (message) => updateStudent(student.id, "progress", message),
                    run: () => isNvidiaSelected
                        ? fetchNvidiaCompletion({ prompt: nextPrompt, additionalInstructions, targetChars, model: selectedModel })
                        : isUpstageSelected
                            ? fetchUpstageCompletion({ prompt: nextPrompt, additionalInstructions, targetChars })
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
            "행동특성 및 종합의견": s.result
        }));
        writeExcel(data, "행발_결과.xlsx");
    };

    return (
        <div className="container py-12">
            <div className="hero-section animate-fade-in">
                <h1 className="hero-title">행동특성 및 종합의견 (행발)</h1>
                <p className="hero-subtitle">
                    학생의 행동 관찰 내용을 바탕으로 <span className="highlight">행동특성 및 종합의견</span>을 생성합니다.
                </p>
            </div>

            {/* Top Section: Settings & Options (No Activity Input) */}
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

                {/* Generation Options (Replaces Activity Input) */}
                <div className="section-card card-orange h-full">
                    <div className="card-header">
                        <div className="card-header-icon">
                            <Wand2 size={20} />
                        </div>
                        <h2>생성 옵션</h2>
                    </div>
                    <div className="flex flex-col gap-4">
                        <div className="form-group">
                            <label className="form-label">글자수 제한</label>
                            <select
                                value={textLength}
                                onChange={(e) => setTextLength(e.target.value)}
                                className="form-select"
                            >
                                <option value="900">900byte (한글 약 350자)</option>
                                <option value="600">600byte (한글 약 200자)</option>
                                <option value="manual">직접 입력</option>
                            </select>
                            {textLength === "manual" && (
                                <input
                                    type="number"
                                    value={manualLength}
                                    onChange={(e) => setManualLength(e.target.value)}
                                    placeholder="byte 수 입력 (최대 900)"
                                    max="900"
                                    className="form-input mt-2"
                                />
                            )}
                        </div>

                        <div className="form-group" style={{ marginBottom: 0 }}>
                            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ color: '#dc2626', fontWeight: 'bold' }}>⚠</span>
                                추가 지침 사항 (선택)
                            </label>
                            <textarea
                                value={additionalInstructions}
                                onChange={(e) => setAdditionalInstructions(e.target.value)}
                                placeholder="예: 공동체 역량과 배려 행동을 중심으로 작성해 주세요."
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
                                <strong>행동 관찰 내용 웹 검색 보강</strong>
                                <br />
                                <span style={{ color: '#6b7280', fontSize: '0.8rem', fontWeight: 400 }}>
                                    학생별 행동 관찰 내용을 검색해 인성 요소와 공동체 역량 표현의 맥락을 보강합니다.
                                </span>
                            </span>
                        </label>

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

                        <div className="flex gap-2">
                            <button
                                onClick={generateAll}
                                disabled={isGenerating}
                                className="btn-primary flex-1"
                                style={{ padding: '16px 24px', fontSize: '1.1rem' }}
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
                                style={{ padding: '16px 24px', display: 'flex', alignItems: 'center', gap: '8px' }}
                            >
                                <Download size={20} /> 엑셀
                            </button>
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

                                    {/* Observation Input */}
                                    <div className="flex flex-col gap-1">
                                        <label className="text-xs font-semibold text-gray-500 ml-1">행동 관찰 결과</label>
                                        <input
                                            type="text"
                                            value={student.observation}
                                            onChange={(e) => updateStudent(student.id, "observation", e.target.value)}
                                            placeholder="예: 배려심이 깊고 친화력이 있음"
                                            className="form-input"
                                            style={{ fontSize: '0.9rem' }}
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
