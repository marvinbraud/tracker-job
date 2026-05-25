import { useState, useRef } from "react";
import ATSScorer from "../ats-scorer-2.jsx";
import JobBoard from "./JobBoard.jsx";
import SetupWizard from "./SetupWizard.jsx";
import NetworkScan from "./NetworkScan.jsx";

const T = {
  fr: {
    nav: {
      cta: "Tester mon CV",
    },
    hero: {
      badge: "7 skills Claude Code · 100% gratuit",
      title: "Votre recherche d'emploi,",
      highlight: "pilotée par l'IA.",
      sub: "Trouvez des offres ciblées, adaptez votre CV, postulez automatiquement — tout depuis Claude Code, sans abonnement.",
      cta: "Tester mon CV gratuitement →",
      sub_cta: "Aucune inscription · Aucun billing · Open source",
    },
    skills_title: "Tout ce dont vous avez besoin",
    skills_sub: "7 outils IA pour dominer votre recherche d'emploi, directement dans Claude Code",
    skills: [
      {
        icon: "⚙️",
        cmd: "/setup",
        name: "Setup",
        desc_fr: "Onboarding complet : uploadez votre CV, définissez vos préférences et faites un entretien détaillé de votre historique de carrière.",
      },
      {
        icon: "🔍",
        cmd: "/job-search",
        name: "Job Search",
        desc_fr: "Recherche quotidienne automatisée sur hiring.cafe avec scoring IA des offres selon votre profil. Résultats filtrés et classés.",
      },
      {
        icon: "📄",
        cmd: "/tailor-resume",
        name: "Tailor Resume",
        desc_fr: "Adapte votre CV pour chaque offre avec les bons mots-clés ATS. Zéro fabrication — uniquement vos vraies expériences, mieux valorisées.",
      },
      {
        icon: "✉️",
        cmd: "/cover-letter",
        name: "Cover Letter",
        desc_fr: "Génère des lettres de motivation authentiques de 250-350 mots, ancrées dans vos accomplissements réels, en 30 secondes.",
      },
      {
        icon: "🚀",
        cmd: "/apply",
        name: "Apply",
        desc_fr: "Remplit automatiquement les formulaires Greenhouse, Lever et Workday. Double validation avant soumission pour éviter les erreurs.",
      },
      {
        icon: "🌐",
        cmd: "/network-scan",
        name: "Network Scan",
        desc_fr: "Scanne les pages carrières des entreprises de vos contacts LinkedIn. Trouve les opportunités cachées dans votre réseau.",
      },
      {
        icon: "📱",
        cmd: "/jobsearch-telegram",
        name: "Telegram Bot",
        desc_fr: "Gérez toute votre recherche d'emploi via Telegram : postulez, cherchez des offres et suivez vos candidatures par message.",
      },
    ],
    how_title: "Comment ça marche",
    how_steps: [
      {
        n: "01",
        title: "Installez Claude Code",
        desc: "Installez le CLI Claude Code d'Anthropic. Lancez /setup pour uploader votre CV, définir vos préférences et enregistrer votre historique de carrière.",
      },
      {
        n: "02",
        title: "Lancez la recherche",
        desc: "/job-search trouve automatiquement les offres correspondant à votre profil chaque jour. /network-scan scrute les entreprises de vos contacts LinkedIn.",
      },
      {
        n: "03",
        title: "Postulez en une commande",
        desc: "/tailor-resume adapte votre CV, /cover-letter rédige la lettre, /apply remplit le formulaire. Une candidature complète en moins de 5 minutes.",
      },
    ],
    ats_title: "Testez votre CV maintenant",
    ats_sub: "Score ATS instantané + recommandations personnalisées. 100% local, aucune donnée envoyée.",
    footer_tagline: "Votre recherche d'emploi, propulsée par l'IA.",
    footer_open: "Skills open source",
  },
  en: {
    nav: {
      cta: "Test my resume",
    },
    hero: {
      badge: "7 Claude Code skills · 100% free",
      title: "Your job search,",
      highlight: "powered by AI.",
      sub: "Find targeted jobs, tailor your resume, apply automatically — all from Claude Code, with no subscription.",
      cta: "Test my resume for free →",
      sub_cta: "No signup · No billing · Open source",
    },
    skills_title: "Everything you need",
    skills_sub: "7 AI tools to dominate your job search, directly inside Claude Code",
    skills: [
      {
        icon: "⚙️",
        cmd: "/setup",
        name: "Setup",
        desc_en: "Full onboarding: upload your resume, set your preferences, and run a detailed work history interview.",
      },
      {
        icon: "🔍",
        cmd: "/job-search",
        name: "Job Search",
        desc_en: "Daily automated search on hiring.cafe with AI scoring of jobs against your profile. Filtered and ranked results.",
      },
      {
        icon: "📄",
        cmd: "/tailor-resume",
        name: "Tailor Resume",
        desc_en: "Adapts your resume for each job with the right ATS keywords. Zero fabrication — your real experience, better framed.",
      },
      {
        icon: "✉️",
        cmd: "/cover-letter",
        name: "Cover Letter",
        desc_en: "Generates authentic 250-350 word cover letters anchored in your real achievements, in 30 seconds.",
      },
      {
        icon: "🚀",
        cmd: "/apply",
        name: "Apply",
        desc_en: "Auto-fills Greenhouse, Lever, and Workday application forms. Double confirmation before submission.",
      },
      {
        icon: "🌐",
        cmd: "/network-scan",
        name: "Network Scan",
        desc_en: "Scans career pages of your LinkedIn contacts' companies. Finds hidden opportunities in your network.",
      },
      {
        icon: "📱",
        cmd: "/jobsearch-telegram",
        name: "Telegram Bot",
        desc_en: "Manage your entire job search via Telegram: apply, search, and track applications by message.",
      },
    ],
    how_title: "How it works",
    how_steps: [
      {
        n: "01",
        title: "Install Claude Code",
        desc: "Install Anthropic's Claude Code CLI. Run /setup to upload your resume, set preferences, and record your career history.",
      },
      {
        n: "02",
        title: "Launch your search",
        desc: "/job-search automatically finds matching jobs daily. /network-scan scours your LinkedIn contacts' companies for openings.",
      },
      {
        n: "03",
        title: "Apply in one command",
        desc: "/tailor-resume adapts your resume, /cover-letter writes the letter, /apply fills the form. A complete application in under 5 minutes.",
      },
    ],
    ats_title: "Test your resume now",
    ats_sub: "Instant ATS score + personalized recommendations. 100% local, no data sent anywhere.",
    footer_tagline: "Your job search, powered by AI.",
    footer_open: "Open source skills",
  },
};

export default function App() {
  const [lang, setLang] = useState("fr");
  const [page, setPage] = useState("landing"); // "landing" | "jobs" | "setup" | "network-scan"
  const atsSectionRef = useRef(null);
  const t = T[lang];

  if (page === "jobs") {
    return <JobBoard onBack={() => setPage("landing")} lang={lang} />;
  }
  if (page === "setup") {
    return <SetupWizard onBack={(dest) => setPage(dest || "landing")} onDone={() => setPage("landing")} lang={lang} />;
  }
  if (page === "network-scan") {
    return <NetworkScan onBack={(dest) => setPage(dest || "landing")} />;
  }

  const scrollToATS = () => {
    atsSectionRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const skillDesc = (skill) =>
    lang === "fr" ? skill.desc_fr : skill.desc_en;

  return (
    <div
      style={{
        fontFamily: "'Sora', sans-serif",
        background: "#0f172a",
        color: "#e2e8f0",
        minHeight: "100vh",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&family=DM+Mono:wght@400;500;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #334155; border-radius: 99px; }
        .btn-primary { transition: transform .2s, box-shadow .2s; cursor: pointer; }
        .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 12px 40px rgba(99,102,241,0.35); }
        .skill-card { transition: transform .2s, border-color .2s; }
        .skill-card:hover { transform: translateY(-5px); border-color: #6366f1 !important; }
        .lang-btn { transition: background .15s, color .15s; cursor: pointer; }
        .fade-in { animation: fadeIn .6s ease both; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
        .glow-ring { box-shadow: 0 0 0 1px rgba(99,102,241,0.3), 0 0 32px rgba(99,102,241,0.12); }
      `}</style>

      {/* ── NAV ── */}
      <nav
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          borderBottom: "1px solid #1e293b",
          background: "rgba(15,23,42,0.92)",
          backdropFilter: "blur(16px)",
          padding: "0 32px",
          height: 64,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 34,
              height: 34,
              background: "linear-gradient(135deg,#6366f1,#8b5cf6)",
              borderRadius: 9,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "'DM Mono', monospace",
              fontSize: 13,
              fontWeight: 700,
              color: "white",
              letterSpacing: "-0.02em",
            }}
          >
            TJ
          </div>
          <span style={{ fontWeight: 800, fontSize: 18, letterSpacing: "-0.03em" }}>
            Tracker<span style={{ color: "#6366f1" }}>Job</span>
          </span>
        </div>

        {/* Right controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* Language toggle */}
          <div
            style={{
              display: "flex",
              background: "#1e293b",
              border: "1px solid #334155",
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            {["fr", "en"].map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className="lang-btn"
                style={{
                  padding: "6px 14px",
                  border: "none",
                  background: lang === l ? "#6366f1" : "transparent",
                  color: lang === l ? "white" : "#64748b",
                  fontFamily: "'DM Mono', monospace",
                  fontSize: 12,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                {l}
              </button>
            ))}
          </div>

          {/* Nav page buttons */}
          <button
            onClick={() => setPage("jobs")}
            className="btn-primary"
            style={{ background: "transparent", border: "1px solid #334155", color: "#94a3b8", padding: "8px 18px", borderRadius: 8, fontFamily: "'Sora', sans-serif", fontWeight: 600, fontSize: 14 }}
          >
            🔍 {lang === "fr" ? "Offres" : "Jobs"}
          </button>
          <button
            onClick={() => setPage("network-scan")}
            className="btn-primary"
            style={{ background: "transparent", border: "1px solid #334155", color: "#94a3b8", padding: "8px 18px", borderRadius: 8, fontFamily: "'Sora', sans-serif", fontWeight: 600, fontSize: 14 }}
          >
            🌐 {lang === "fr" ? "Réseau" : "Network"}
          </button>
          <button
            onClick={() => setPage("setup")}
            className="btn-primary"
            style={{ background: "transparent", border: "1px solid #334155", color: "#94a3b8", padding: "8px 18px", borderRadius: 8, fontFamily: "'Sora', sans-serif", fontWeight: 600, fontSize: 14 }}
          >
            ⚙️ Setup
          </button>

          {/* CTA */}
          <button
            onClick={scrollToATS}
            className="btn-primary"
            style={{
              background: "linear-gradient(135deg,#6366f1,#8b5cf6)",
              border: "none",
              color: "white",
              padding: "8px 20px",
              borderRadius: 8,
              fontFamily: "'Sora', sans-serif",
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            {t.nav.cta}
          </button>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          padding: "110px 32px 80px",
          textAlign: "center",
        }}
      >
        {/* Badge */}
        <div
          className="fade-in"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            background: "#1e293b",
            border: "1px solid #334155",
            borderRadius: 99,
            padding: "6px 18px",
            marginBottom: 36,
            fontSize: 13,
            color: "#94a3b8",
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "#22c55e",
              display: "inline-block",
              boxShadow: "0 0 6px #22c55e",
            }}
          />
          {t.hero.badge}
        </div>

        {/* Headline */}
        <h1
          className="fade-in"
          style={{
            fontSize: "clamp(42px, 6.5vw, 76px)",
            fontWeight: 800,
            letterSpacing: "-0.045em",
            lineHeight: 1.08,
            marginBottom: 28,
            animationDelay: ".05s",
          }}
        >
          {t.hero.title}
          <br />
          <span
            style={{
              background: "linear-gradient(135deg,#6366f1,#a78bfa,#c084fc)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            {t.hero.highlight}
          </span>
        </h1>

        {/* Sub */}
        <p
          className="fade-in"
          style={{
            fontSize: "clamp(16px, 2vw, 20px)",
            color: "#64748b",
            maxWidth: 580,
            margin: "0 auto 44px",
            lineHeight: 1.65,
            animationDelay: ".1s",
          }}
        >
          {t.hero.sub}
        </p>

        {/* CTA */}
        <div
          className="fade-in"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 14,
            animationDelay: ".15s",
          }}
        >
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
            <button
              onClick={() => setPage("jobs")}
              className="btn-primary"
              style={{
                background: "linear-gradient(135deg,#6366f1,#8b5cf6)",
                border: "none",
                color: "white",
                padding: "16px 40px",
                borderRadius: 14,
                fontFamily: "'Sora', sans-serif",
                fontWeight: 700,
                fontSize: 18,
              }}
            >
              🔍 {lang === "fr" ? "Voir les offres →" : "Browse jobs →"}
            </button>
            <button
              onClick={scrollToATS}
              className="btn-primary"
              style={{
                background: "transparent",
                border: "1.5px solid #334155",
                color: "#e2e8f0",
                padding: "16px 32px",
                borderRadius: 14,
                fontFamily: "'Sora', sans-serif",
                fontWeight: 600,
                fontSize: 18,
              }}
            >
              {t.hero.cta}
            </button>
          </div>
          <span
            style={{
              fontSize: 13,
              color: "#475569",
              fontFamily: "'DM Mono', monospace",
            }}
          >
            {t.hero.sub_cta}
          </span>
        </div>

        {/* Command pills */}
        <div
          className="fade-in"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            justifyContent: "center",
            marginTop: 64,
            animationDelay: ".25s",
          }}
        >
          {t.skills.map((s) => (
            <div
              key={s.cmd}
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 13,
                background: "#1e293b",
                border: "1px solid #334155",
                borderRadius: 8,
                padding: "6px 14px",
                color: "#a78bfa",
              }}
            >
              {s.cmd}
            </div>
          ))}
        </div>
      </section>

      {/* ── SKILLS GRID ── */}
      <section
        id="skills"
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          padding: "72px 32px",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 56 }}>
          <h2
            style={{
              fontSize: "clamp(28px, 4vw, 48px)",
              fontWeight: 800,
              letterSpacing: "-0.035em",
              marginBottom: 14,
            }}
          >
            {t.skills_title}
          </h2>
          <p style={{ fontSize: 16, color: "#64748b", maxWidth: 520, margin: "0 auto" }}>
            {t.skills_sub}
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(295px, 1fr))",
            gap: 20,
          }}
        >
          {t.skills.map((skill, i) => (
            <div
              key={i}
              className="skill-card"
              style={{
                background: "#1e293b",
                border: "1px solid #334155",
                borderRadius: 18,
                padding: "28px 26px",
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              {/* Icon + command */}
              <div
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
              >
                <div
                  style={{
                    width: 48,
                    height: 48,
                    background: "#0f172a",
                    border: "1px solid #334155",
                    borderRadius: 12,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 22,
                  }}
                >
                  {skill.icon}
                </div>
                <span
                  style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 11,
                    color: "#6366f1",
                    background: "#1a1b4b",
                    border: "1px solid #3730a3",
                    padding: "3px 10px",
                    borderRadius: 6,
                    fontWeight: 600,
                  }}
                >
                  {skill.cmd}
                </span>
              </div>

              {/* Name */}
              <div style={{ fontWeight: 700, fontSize: 17, color: "#f1f5f9" }}>
                {skill.name}
              </div>

              {/* Description */}
              <p style={{ fontSize: 14, color: "#64748b", lineHeight: 1.65, margin: 0 }}>
                {skillDesc(skill)}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section
        style={{
          background: "#080f1e",
          borderTop: "1px solid #1e293b",
          borderBottom: "1px solid #1e293b",
        }}
      >
        <div
          style={{
            maxWidth: 960,
            margin: "0 auto",
            padding: "88px 32px",
          }}
        >
          <h2
            style={{
              fontSize: "clamp(28px, 4vw, 48px)",
              fontWeight: 800,
              letterSpacing: "-0.035em",
              textAlign: "center",
              marginBottom: 72,
            }}
          >
            {t.how_title}
          </h2>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: 48,
            }}
          >
            {t.how_steps.map((step, i) => (
              <div key={i} style={{ position: "relative" }}>
                <div
                  style={{
                    fontFamily: "'DM Mono', monospace",
                    fontSize: 72,
                    fontWeight: 700,
                    color: "#1e293b",
                    lineHeight: 1,
                    marginBottom: 20,
                    userSelect: "none",
                  }}
                >
                  {step.n}
                </div>
                <h3
                  style={{
                    fontSize: 19,
                    fontWeight: 700,
                    color: "#f1f5f9",
                    marginBottom: 12,
                    letterSpacing: "-0.01em",
                  }}
                >
                  {step.title}
                </h3>
                <p style={{ fontSize: 14, color: "#64748b", lineHeight: 1.7 }}>
                  {step.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── ATS SCORER SECTION ── */}
      <section ref={atsSectionRef} style={{ borderTop: "1px solid #1e293b" }}>
        <div style={{ maxWidth: 960, margin: "0 auto", padding: "72px 32px 0" }}>
          <div style={{ textAlign: "center", marginBottom: 52 }}>
            <h2
              style={{
                fontSize: "clamp(28px, 4vw, 48px)",
                fontWeight: 800,
                letterSpacing: "-0.035em",
                marginBottom: 14,
              }}
            >
              {t.ats_title}
            </h2>
            <p
              style={{
                fontSize: 16,
                color: "#64748b",
                maxWidth: 480,
                margin: "0 auto",
                lineHeight: 1.6,
              }}
            >
              {t.ats_sub}
            </p>
          </div>
        </div>

        {/* ATS scorer embedded — hides its own header via the embedded prop */}
        <ATSScorer embedded />
      </section>

      {/* ── FOOTER ── */}
      <footer
        style={{
          borderTop: "1px solid #1e293b",
          padding: "48px 32px",
          textAlign: "center",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            marginBottom: 10,
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              background: "linear-gradient(135deg,#6366f1,#8b5cf6)",
              borderRadius: 7,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "'DM Mono', monospace",
              fontSize: 11,
              fontWeight: 700,
              color: "white",
            }}
          >
            TJ
          </div>
          <span style={{ fontWeight: 800, fontSize: 16, letterSpacing: "-0.02em" }}>
            Tracker<span style={{ color: "#6366f1" }}>Job</span>
          </span>
        </div>

        <p style={{ fontSize: 13, color: "#475569", marginBottom: 20 }}>
          {t.footer_tagline}
        </p>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            justifyContent: "center",
            marginBottom: 24,
          }}
        >
          {T.fr.skills.map((s) => (
            <span
              key={s.cmd}
              style={{
                fontFamily: "'DM Mono', monospace",
                fontSize: 11,
                color: "#334155",
                padding: "3px 10px",
                border: "1px solid #1e293b",
                borderRadius: 6,
              }}
            >
              {s.cmd}
            </span>
          ))}
        </div>

        <p style={{ fontSize: 12, color: "#334155" }}>
          {t.footer_open} ·{" "}
          <a
            href="https://github.com/proficientlyjobs/proficiently-claude-skills"
            target="_blank"
            rel="noreferrer"
            style={{ color: "#475569", textDecoration: "underline" }}
          >
            proficientlyjobs/proficiently-claude-skills
          </a>
        </p>
      </footer>
    </div>
  );
}
