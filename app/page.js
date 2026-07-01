import Link from "next/link";
import { BookOpen, Users, UserCheck, FileText, Download, Youtube, ArrowRight } from "lucide-react";

export default function Home() {
  return (
    <div className="container">
      {/* Hero Section */}
      <section className="hero-section">
        <h1 className="hero-title">
          생기부 작성 도우미
          <span className="brand-by" style={{ position: 'absolute', top: '-17px', right: '-80px', transform: 'rotate(25deg)', fontSize: '1.2rem', whiteSpace: 'nowrap', zIndex: 1 }}>by HooniKim</span> {/* 뱃지 위치 수정: top, right 값 조절 */}
        </h1>
        <p className="hero-subtitle">
          선생님의 업무 시간을 단축시키기 위한 <span className="highlight">AI 기반 보조 도구</span>입니다.
        </p>
      </section>

      {/* Privacy Notice */}
      <div className="privacy-notice">
        <div className="privacy-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
        </div>
        <div className="privacy-content">
          <h3>개인정보처리방침 안내</h3>
          <p>
            이 앱은 어떠한 데이터도 외부 서버로 수집/전송하지 않습니다.
            학생들의 소중한 개인정보를 보호하기 위해 모든 정보는 사용자의 브라우저(로컬 스토리지)에만 저장됩니다.
            안심하고 사용하세요.
          </p>
        </div>
      </div>

      {/* Usage Tips Box */}
      <div className="usage-tips-box">
        <div className="usage-tips-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
        </div>
        <div className="usage-tips-content">
          <h3>📌 사용 안내 <span className="contact-info">(사용 중 문제점이나 개선사항은 greenguyhh@gmail.com 으로 보내주시면 답변 드리겠습니다.)</span></h3>
          <ol>
            <li>
              처음 사용하신다면 하단의 <span className="emphasis">사용 방법 영상</span> 시청을 추천합니다.
            </li>
            <li>
              영상 내용 외의 추가된 내용
              <ol className="sub-list">
                <li>각 페이지의 <span className="emphasis-purple">엑셀파일</span>은 <span className="emphasis">NEIS 세특의 엑셀 내려 받기</span> 후 업로드 하면 <span className="emphasis-orange">자동으로 학생이 추가</span>됩니다. 또한 엑셀 파일 안의 <span className="emphasis">'세부능력 및 특기사항'</span> 칸에 개별 내용을 입력 후 업로드 하시면 자동으로 <span className="emphasis-orange">개별 학생들의 내용도 추가</span>됩니다.</li>
                <li><span className="emphasis-purple">세특</span>과 <span className="emphasis-purple">동아리활동</span> 작성에서 <span className="emphasis">'학생별 개별 활동'</span> 내용을 입력할 수 있습니다.</li>
                <li>입력된 <span className="emphasis">학생별 개별 활동 내용</span>과 <span className="emphasis">공통 활동 내용</span>을 조합하여 생성해줍니다.</li>
                <li>세특 <span className="emphasis-orange">'활동 내용 입력'</span> 칸에 <span className="emphasis-orange">'추가 지침 사항'</span> 부분을 만들어 최우선적으로 적용할 지침을 정할 수 있습니다.</li>
              </ol>
            </li>
            <li>
              <span className="emphasis-purple">나이스 자동입력 확장프로그램</span>을 사용할 때에는 <span className="emphasis">'나이스'</span>와 <span className="emphasis">'생기부 작성 도우미 사이트'</span>를 <span className="emphasis-orange">같은 브라우저</span>내에서 사용해주세요.
            </li>
          </ol>
        </div>
      </div>

      {/* Main Menu Grid (2x2) */}
      <section className="menu-grid">
        {/* Card 1: Gwasetuk */}
        <Link href="/gwasetuk" className="menu-card card-blue">
          <div className="card-icon-wrapper">
            <BookOpen size={32} />
          </div>
          <h2>과세특(자유학기 세특)</h2>
          <p>특정 과목 시간에 활동한 내용을 바탕으로 과목별(자유학기) 세부능력 및 특기사항을 생성합니다.</p>
          <div className="card-link">
            바로가기 <ArrowRight size={16} style={{ marginLeft: '4px' }} />
          </div>
        </Link>

        {/* Card 2: Club */}
        <Link href="/club" className="menu-card card-purple">
          <div className="card-icon-wrapper">
            <Users size={32} />
          </div>
          <h2>동아리 세특</h2>
          <p>동아리 활동 시간에 활동한 내용을 바탕으로 동아리 세부 능력 및 특기사항을 생성합니다.</p>
          <div className="card-link">
            바로가기 <ArrowRight size={16} style={{ marginLeft: '4px' }} />
          </div>
        </Link>

        {/* Card 3: Behavior */}
        <Link href="/behavior" className="menu-card card-orange">
          <div className="card-icon-wrapper">
            <UserCheck size={32} />
          </div>
          <h2>행발 작성</h2>
          <p>학생의 관찰 기록을 바탕으로 행동 특성 및 종합 의견을 생성합니다.</p>
          <div className="card-link">
            바로가기 <ArrowRight size={16} style={{ marginLeft: '4px' }} />
          </div>
        </Link>

        {/* Card 4: Letter */}
        <Link href="/letter" className="menu-card card-green">
          <div className="card-icon-wrapper">
            <FileText size={32} />
          </div>
          <h2>가정통신문 작성</h2>
          <p>여름방학 또는 겨울방학 전 배부되는 성적표(생활 통지표)의 학교에서 가정으로 보내는 가정통신문을 생성합니다.</p>
          <div className="card-link">
            바로가기 <ArrowRight size={16} style={{ marginLeft: '4px' }} />
          </div>
        </Link>
      </section>

      {/* Bottom Section (Vertical Layout) */}
      <section className="bottom-section" style={{ display: 'flex', flexDirection: 'column', gap: '30px', marginBottom: '60px' }}>
        {/* Chrome Extension */}
        <a href="https://chromewebstore.google.com/detail/lfmnbolglechpfpndkknofcfiaefnbho?utm_source=item-share-cb" target="_blank" rel="noopener noreferrer" className="info-card" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div className="info-icon">
              <Download size={24} />
            </div>
            <div>
              <h3 className="info-title">나이스 자동 입력</h3>
              <p className="info-desc" style={{ marginBottom: 0 }}>
                생성된 내용을 나이스에 자동으로 입력해주는 크롬 확장 프로그램을 설치하세요.
              </p>
            </div>
          </div>
          <ArrowRight size={24} className="text-gray-400" />
        </a>

        {/* YouTube Link */}
        <div className="info-card">
          <div className="info-header">
            <div className="info-icon" style={{ color: '#ef4444', backgroundColor: '#fef2f2' }}>
              <Youtube size={24} />
            </div>
            <h3 className="info-title">사용 가이드 영상</h3>
          </div>
          <div className="youtube-container" style={{ position: 'relative', paddingBottom: '56.25%', height: 0, borderRadius: '16px', overflow: 'hidden', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}>
            <iframe
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
              src="https://www.youtube.com/embed/N0bsmOfK1YA"
              title="YouTube video player"
              frameBorder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            ></iframe>
          </div>
        </div>
      </section>
    </div>
  );
}
