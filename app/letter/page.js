"use client";

import { useState, useRef } from "react";
import { Trash2, Download, Wand2, Users, UserX, Copy, Check } from "lucide-react";
import * as XLSX from "xlsx";
import { writeExcel } from "../../utils/excel";
import { getCharacterGuideline, getMinimumTargetBytes, getUtf8ByteLength, normalizeTargetBytes, normalizeTargetChars } from "../../utils/textProcessor";
import { fetchStream, AVAILABLE_MODELS, DEFAULT_MODEL, getModelOptionLabel, isNvidiaModel, isUpstageModel } from "../../utils/streamFetch";
import { fetchNvidiaCompletion } from "../../utils/nvidiaFetch";
import { fetchOpenAICompletion } from "../../utils/openAIFetch";
import { fetchUpstageCompletion } from "../../utils/upstageFetch";
import { useOpenAIKey } from "../../utils/openAIKey";
import OpenAIKeyControl from "../../components/OpenAIKeyControl";
import { generateWithSilentValidation } from "../../utils/generationHarness";
import { getGenerationProvider, runGenerationWithProgress } from "../../utils/generationProgress";
import { buildLetterRuleTermInstruction, buildLetterVariationInstruction, buildShuffledKeywordContext, getLetterBannedTerms, getLetterRequiredTerms } from "../../utils/letterKeywords";
import { fetchSearchContext } from "../../utils/searchContextFetch";

export default function LetterPage() {
    // State
    const [studentCount, setStudentCount] = useState(1);
    const [isManualInput, setIsManualInput] = useState(false);
    const [manualCountValue, setManualCountValue] = useState("");

    const [students, setStudents] = useState([{ id: 1, name: "", result: "", status: "idle", progress: "" }]);
    const [textLength, setTextLength] = useState("1500");
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
    const generationStatusText = isNvidiaSelected
        ? "NVIDIA NIM 모델로 생성 중..."
        : isUpstageSelected ? "Upstage Solar Pro 2로 생성 중..."
        : appliedOpenAIKey ? "OpenAI API key를 사용하여 생성 중..." : "생성 중...";

    // Letter Specific State
    const [season, setSeason] = useState("summer"); // summer, winter
    const [keywords, setKeywords] = useState("학업, 건강, 친구관계, 가족관계");

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
                newStudents.push({ id: i, name: "", result: "", status: "idle", progress: "" });
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
            let headerRowIndex = -1;

            for (let i = 0; i < data.length; i++) {
                const row = data[i];
                for (let j = 0; j < row.length; j++) {
                    const cellValue = String(row[j]).trim().replace(/\s/g, "");
                    if (cellValue === "성명" || cellValue === "이름") {
                        nameColIndex = j;
                        headerRowIndex = i;
                        break;
                    }
                }
                if (nameColIndex !== -1) break;
            }

            const newStudents = [];
            let idCounter = 1;

            if (nameColIndex !== -1) {
                for (let i = headerRowIndex + 1; i < data.length; i++) {
                    const row = data[i];
                    const name = row[nameColIndex];
                    if (name && typeof name === 'string' && name.trim() !== "") {
                        newStudents.push({ id: idCounter++, name: name.trim(), result: "", status: "idle" });
                    }
                }
            } else {
                for (let i = 0; i < data.length; i++) {
                    const row = data[i];
                    for (let j = 0; j < Math.min(row.length, 3); j++) {
                        const val = row[j];
                        if (typeof val === 'string' && val.length > 1 && val.length < 10) {
                            if (val !== "성명" && val !== "이름") {
                                newStudents.push({ id: idCounter++, name: val.trim(), result: "", status: "idle" });
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

    const generatePrompt = (targetChars, searchContext = "") => {
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
        const targetBytes = normalizeTargetBytes(textLength, manualLength);
        const lengthInstruction = getCharacterGuideline(targetChars, targetBytes, getMinimumTargetBytes(targetBytes));

        const keywordContext = buildShuffledKeywordContext(keywords);
        const ruleTermInstruction = buildLetterRuleTermInstruction({ season, keywords });
        const variationInstruction = buildLetterVariationInstruction();

        let promptContent = "";

        const periodGoal = season === "summer"
            ? "한 학기 동안 학교생활을 성실하게 수행했다는 일반적인 평가와 여름방학 동안 가정에서 살필 조언"
            : "한 해 동안 학교생활을 성실하게 수행했다는 일반적인 평가와 겨울방학 및 새 학기 준비를 위해 가정에서 살필 조언";
        const searchContextText = searchContext.trim()
            ? `\n\n[가정통신문 키워드 기반 웹 검색 보강 자료]\n${searchContext}\n(위 검색 보강 자료는 방학 생활 지도, 학습 습관, 건강한 생활 리듬, 관계 형성 조언의 일반적 배경을 이해하기 위한 자료입니다. 학생이 실제로 보인 구체적 활동이나 관찰 사실처럼 꾸며 쓰지 말고, 가정에서 살필 조언의 표현을 자연스럽게 보강하는 데에만 사용할 것.)`
            : "";

        return `당신은 담임 교사입니다. 학기말 통지표에 들어갈 '가정통신문(종합의견)' 본문을 작성하세요.

<입력 정보>
${keywordContext}${searchContextText}

<작성 규칙>
1. 작성 내용: ${periodGoal}을 객관적이고 따뜻하게 기술할 것
2. 편지 형식(예: "안녕하세요, 어머님")을 사용하지 않고 바로 본문만 서술
3. 'OO가', '자녀분이', '학생이' 등 주어를 생략하고 바로 행동부터 서술
4. 입력된 키워드(학업, 건강, 교우관계 등)는 관찰 사실이 아니라 방학 동안 가정에서 살필 조언 영역으로 사용할 것
5. 특정 과목명(국어, 수학 등)이나 점수/등수는 절대 언급하지 않음
6. 학교에서 보여준 모습은 과거 경어체("~했습니다.", "~였습니다.", "~돋보였습니다.")로 서술
7. 줄바꿈 없이 하나의 문단으로 작성
8. '마지막으로', '끝으로', '마무리하며', '덧붙여', '추가로' 같은 마무리 접속어를 사용하지 않음
9. 아래 학기 구분 필수 용어는 표현을 바꾸지 말고 본문 안에 정확히 포함할 것
10. 아래 금지 용어는 본문에 절대 포함하지 않을 것
11. 키워드는 목록처럼 나열하지 말고 문장 속에서 자연스럽게 풀어 쓸 것
12. 학교생활을 성실하게 잘 수행했다는 일반적인 뉘앙스로 시작하되 매번 표현을 다르게 할 것
13. 학업 계획, 건강한 생활 리듬, 친구와의 배려 있는 관계, 가족과의 대화나 지지 중 최소 세 가지 이상을 반드시 반영하되 하나의 흐름으로 연결하고 각각 따로 설명하지 말 것
14. 입력되지 않은 구체적인 활동, 실험, 탐구 주제, 수행 장면은 지어내지 말 것
15. 문장 사이에는 "그 과정에서", "이어", "나아가", "이러한 흐름이" 같은 연결 흐름을 자연스럽게 사용할 것
16. 추가 정보를 요청하지 말고 입력된 키워드만으로 완성할 것
17. 방학 동안 가정에서 지도할 내용은 권유형 경어체("~바랍니다.", "~주시기 바랍니다.")로 마무리할 것
18. "~해보세요.", "~보세요.", "~하세요.", "~하십시오." 같은 직접 지시형/대화체 표현은 사용하지 말고 "~바랍니다.", "~주시기 바랍니다.", "~부탁드립니다."로 정중하게 쓸 것

${ruleTermInstruction}

${variationInstruction}

${lengthInstruction}

<출력 형식>
- 오직 가정통신문 본문 텍스트만 출력
- 글자수 표기, 분석, 검증 포인트, 부가 설명 등 메타 정보는 출력하지 않음
- "학업, 건강, 친구관계, 가족관계"처럼 키워드를 쉼표로 나열하지 않음

<좋은 예시>
"한 학기 동안 학교생활에 성실하게 참여하며 맡은 일을 차분히 해내는 모습이 돋보였습니다. 여름방학 동안에는 배움의 흐름을 이어 갈 수 있도록 무리하지 않는 학습 계획을 세우고, 건강한 생활 리듬을 지키며 가족과의 대화 속에서 마음을 안정적으로 돌보는 시간을 마련해 주시기 바랍니다. 친구들과도 서로를 배려하는 관계를 이어 갈 수 있도록 가정에서 함께 살펴봐 주시기 바랍니다."
    `;
    };

    const generateForStudent = async (student) => {
        const targetBytes = normalizeTargetBytes(textLength, manualLength);
        const targetChars = normalizeTargetChars(textLength, manualLength);
        const minTargetBytes = getMinimumTargetBytes(targetBytes);

        try {
            updateStudent(student.id, "status", "loading");
            updateStudent(student.id, "progress", "생성 준비 중...");
            let searchContext = "";
            if (useWebSearchContext && keywords.trim()) {
                try {
                    updateStudent(student.id, "progress", "웹 검색 보강 중...");
                    const periodText = season === "summer" ? "여름방학 생활 지도" : "겨울방학 새 학기 생활 지도";
                    const searchResult = await fetchSearchContext({
                        subjectName: "가정통신문",
                        commonActivities: [periodText],
                        individualActivity: keywords,
                    });
                    searchContext = searchResult.context || "";
                    if (searchResult.query) {
                        console.log(`[웹 검색 보강] 학생 ${student.id}: ${searchResult.query}`);
                    }
                } catch (searchError) {
                    console.warn(`[웹 검색 보강 실패] 학생 ${student.id}: ${searchError.message}`);
                }
            }

            const prompt = generatePrompt(targetChars, searchContext);
            const generationResult = await generateWithSilentValidation({
                prompt,
                acceptLengthOnlyResult: !isUpstageSelected,
                preserveTextOnLengthRepair: isUpstageSelected,
                stripExpandedGradeLabels: isUpstageSelected,
                maxTargetBytes: targetBytes,
                minTargetBytes,
                targetChars,
                mode: "letter",
                forbiddenTerms: [student.name],
                requiredTerms: getLetterRequiredTerms({ season, keywords }),
                bannedTerms: getLetterBannedTerms(season),
                requiredAdviceDomains: true,
                maxRepairAttempts: 2,
                generateOnce: (nextPrompt, { attempt, previousValidation }) => runGenerationWithProgress({
                    attempt,
                    previousValidation,
                    provider: getGenerationProvider({ isNvidiaSelected, isUpstageSelected, hasOpenAIKey: Boolean(appliedOpenAIKey) }),
                    setProgress: (message) => updateStudent(student.id, "progress", message),
                    run: () => isNvidiaSelected
                        ? fetchNvidiaCompletion({ prompt: nextPrompt, targetChars, model: selectedModel, outputType: "letter" })
                        : isUpstageSelected
                            ? fetchUpstageCompletion({ prompt: nextPrompt, targetChars, outputType: "letter" })
                        : appliedOpenAIKey
                            ? fetchOpenAICompletion({ prompt: nextPrompt, apiKey: appliedOpenAIKey, targetChars, model: selectedOpenAIModel, outputType: "letter" })
                            : fetchStream({ prompt: nextPrompt, model: selectedModel, targetChars, outputType: "letter" }),
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
            "가정통신문": s.result
        }));
        writeExcel(data, "가정통신문_결과.xlsx");
    };

    return (
        <div className="container py-12">
            <div className="hero-section animate-fade-in">
                <h1 className="hero-title">가정통신문 작성</h1>
                <p className="hero-subtitle">
                    학기말 통지표에 들어갈 <span className="highlight">가정통신문(종합의견)</span>을 생성합니다.
                </p>
            </div>

            {/* Top Section: Settings & Options */}
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

                {/* Generation Options */}
                <div className="section-card card-orange h-full">
                    <div className="card-header">
                        <div className="card-header-icon">
                            <Wand2 size={20} />
                        </div>
                        <h2>생성 옵션</h2>
                    </div>
                    <div className="flex flex-col gap-4">
                        <div className="grid-2-cols gap-4">
                            <div className="form-group mb-0">
                                <label className="form-label">학기 구분</label>
                                <select
                                    value={season}
                                    onChange={(e) => setSeason(e.target.value)}
                                    className="form-select"
                                >
                                    <option value="summer">여름방학 (1학기)</option>
                                    <option value="winter">겨울방학 (학년말)</option>
                                </select>
                            </div>
                            <div className="form-group mb-0">
                                <label className="form-label">글자수 제한</label>
                                <select
                                    value={textLength}
                                    onChange={(e) => setTextLength(e.target.value)}
                                    className="form-select"
                                >
                                    <option value="1500">1500byte (약 490자)</option>
                                    <option value="1000">1000byte (약 333자)</option>
                                    <option value="600">600byte (약 200자)</option>
                                    <option value="manual">직접 입력</option>
                                </select>
                            </div>
                        </div>

                        {textLength === "manual" && (
                            <div className="form-group">
                                <input
                                    type="number"
                                    value={manualLength}
                                    onChange={(e) => setManualLength(e.target.value)}
                                    placeholder="글자수 입력"
                                    className="form-input"
                                />
                            </div>
                        )}

                        <div className="form-group">
                            <label className="form-label">강조 키워드 (공통 적용)</label>
                            <input
                                type="text"
                                value={keywords}
                                onChange={(e) => setKeywords(e.target.value)}
                                placeholder="예: 학업, 건강, 친구관계, 가족관계"
                                className="form-input"
                            />
                        </div>

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
                                <strong>가정통신문 키워드 웹 검색 보강</strong>
                                <br />
                                <span style={{ color: '#6b7280', fontSize: '0.8rem', fontWeight: 400 }}>
                                    강조 키워드를 검색해 방학 생활 지도와 가정 조언의 표현 맥락을 보강합니다.
                                </span>
                            </span>
                        </label>

                        <div className="flex gap-2 mt-auto">
                            <button
                                onClick={generateAll}
                                disabled={isGenerating}
                                className="btn-primary flex-1"
                                style={{ padding: '12px 24px', fontSize: '1.1rem' }}
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
                                style={{ padding: '12px 24px', display: 'flex', alignItems: 'center', gap: '8px' }}
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
