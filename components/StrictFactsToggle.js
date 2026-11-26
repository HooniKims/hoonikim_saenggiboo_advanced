"use client";

// 기본은 설정한 분량을 채우도록 활동 장면을 보완해 쓰고,
// 체크하면 입력한 활동 내용에 있는 사실만으로 작성한다.
export default function StrictFactsToggle({ checked, onChange }) {
    return (
        <label
            className="form-label"
            style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "10px",
                padding: "12px",
                border: "1px solid #bbf7d0",
                borderRadius: "8px",
                backgroundColor: "#f0fdf4",
                cursor: "pointer",
                lineHeight: 1.45,
                wordBreak: "keep-all",
            }}
        >
            <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
                style={{ marginTop: "3px", flexShrink: 0 }}
            />
            <span>
                <strong>입력한 활동 내용만으로 작성</strong>
                <br />
                <span style={{ color: "#4b5563", fontSize: "0.8rem", fontWeight: 400 }}>
                    체크하면 입력하지 않은 활동이나 장면을 지어내지 않습니다. 활동과 느낀 점을 키워드로만 적어도 문장으로 풀어 씁니다. 입력이 적으면 설정한 분량보다 짧게 나올 수 있습니다. 체크하지 않으면 분량을 채우도록 활동 장면을 보완해 씁니다.
                </span>
            </span>
        </label>
    );
}
