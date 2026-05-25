import { useState } from "react";

const SYSTEM_PROMPT = `Tu es un expert ATS (Applicant Tracking System) et optimiseur de CV. Analyse la compatibilité entre un CV et une offre d'emploi.

Réponds UNIQUEMENT en JSON valide, sans markdown, sans backticks, sans texte autour.

Structure exacte requise:
{
  "scoreGlobal": 78,
  "categories": [
    { "nom": "Mots-clés & Vocabulaire", "score": 22, "max": 30, "commentaire": "..." },
    { "nom": "Expérience Professionnelle", "score": 17, "max": 25, "commentaire": "..." },
    { "nom": "Compétences Techniques", "score": 17, "max": 20, "commentaire": "..." },
    { "nom": "Formation", "score": 9, "max": 10, "commentaire": "..." },
    { "nom": "Soft Skills", "score": 5, "max": 8, "commentaire": "..." },
    { "nom": "Format & Lisibilité ATS", "score": 5, "max": 7, "commentaire": "..." }
  ],
  "pointsForts": ["point 1", "point 2", "point 3"],
  "lacunes": ["lacune 1", "lacune 2", "lacune 3"],
  "motsClesManquants": [
    { "terme": "mot-clé", "importance": "critique" },
    { "terme": "mot-clé", "importance": "haute" },
    { "terme": "mot-clé", "importance": "moyenne" }
  ],
  "motsClesPresents": ["mot1", "mot2", "mot3", "mot4", "mot5"],
  "planAction": [
    { "priorite": "haute", "action": "..." },
    { "priorite": "haute", "action": "..." },
    { "priorite": "moyenne", "action": "..." },
    { "priorite": "basse", "action": "..." }
  ],
  "conseilsFormat": ["conseil 1", "conseil 2"],
  "verdict": "Résumé en 2-3 phrases du verdict final avec les chances de passer le filtre ATS."
}

Règles de scoring:
- Mots-clés (30pts): correspondance exacte/quasi-exacte des termes de l'offre dans le CV
- Expérience (25pts): années, pertinence des postes, progression
- Compétences techniques (20pts): outils, technologies, certifications matchés
- Formation (10pts): niveau, domaine, adéquation
- Soft skills (8pts): correspondance comportementale
- Format ATS (7pts): structure lisible, pas de tableaux complexes, langue appropriée

Sois précis et honnête, ne gonfle pas les scores.`;

export default function ATSScorer() {
  const [cv, setCv] = useState("");
  const [jd, setJd] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("score");

  const analyze = async () => {
    if (!cv.trim() || !jd.trim()) {
      setError("Veuillez renseigner le CV et l'offre d'emploi.");
      return;
    }
    setError("");
    setLoading(true);
    setResult(null);

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: `CV:\n${cv}\n\nOFFRE D'EMPLOI:\n${jd}`,
            },
          ],
        }),
      });

      const data = await response.json();
      const text = data.content?.find((b) => b.type === "text")?.text || "";
      const clean = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(clean);
      setResult(parsed);
      setActiveTab("score");
    } catch (e) {
      setError("Erreur lors de l'analyse. Veuillez réessayer.");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setCv("");
    setJd("");
    setResult(null);
    setError("");
  };

  const scoreColor = (score) => {
    if (score >= 85) return "#22c55e";
    if (score >= 70) return "#f59e0b";
    if (score >= 50) return "#f97316";
    return "#ef4444";
  };

  const scoreLabel = (score) => {
    if (score >= 85) return { text: "Excellente compatibilité", emoji: "🟢" };
    if (score >= 70) return { text: "Bonne compatibilité", emoji: "🟡" };
    if (score >= 50) return { text: "Compatibilité partielle", emoji: "🟠" };
    return { text: "Faible compatibilité", emoji: "🔴" };
  };

  const importanceColor = (imp) => {
    if (imp === "critique") return { bg: "#fee2e2", text: "#991b1b", dot: "#ef4444" };
    if (imp === "haute") return { bg: "#ffedd5", text: "#9a3412", dot: "#f97316" };
    return { bg: "#fef9c3", text: "#854d0e", dot: "#f59e0b" };
  };

  const prioriteStyle = (p) => {
    if (p === "haute") return { border: "#ef4444", bg: "#fff1f2", badge: "#ef4444", label: "Urgente" };
    if (p === "moyenne") return { border: "#f59e0b", bg: "#fffbeb", badge: "#f59e0b", label: "Importante" };
    return { border: "#94a3b8", bg: "#f8fafc", badge: "#94a3b8", label: "Optionnelle" };
  };

  const BarChart = ({ score, max }) => {
    const pct = Math.round((score / max) * 100);
    const color = pct >= 80 ? "#22c55e" : pct >= 60 ? "#f59e0b" : "#ef4444";
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1, background: "#f1f5f9", borderRadius: 99, height: 8, overflow: "hidden" }}>
          <div
            style={{
              width: `${pct}%`,
              height: "100%",
              background: color,
              borderRadius: 99,
              transition: "width 1s cubic-bezier(.4,0,.2,1)",
            }}
          />
        </div>
        <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, fontWeight: 700, color, minWidth: 52, textAlign: "right" }}>
          {score}/{max}
        </span>
      </div>
    );
  };

  const Gauge = ({ score }) => {
    const color = scoreColor(score);
    const angle = (score / 100) * 180 - 90;
    return (
      <svg width="200" height="110" viewBox="0 0 200 110">
        <defs>
          <linearGradient id="g1" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#ef4444" />
            <stop offset="50%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#22c55e" />
          </linearGradient>
        </defs>
        <path d="M 20 100 A 80 80 0 0 1 180 100" stroke="#e2e8f0" strokeWidth="14" fill="none" strokeLinecap="round" />
        <path d="M 20 100 A 80 80 0 0 1 180 100" stroke="url(#g1)" strokeWidth="14" fill="none" strokeLinecap="round"
          strokeDasharray={`${(score / 100) * 251} 251`} />
        <line
          x1="100" y1="100"
          x2={100 + 60 * Math.cos(((angle - 90) * Math.PI) / 180)}
          y2={100 + 60 * Math.sin(((angle - 90) * Math.PI) / 180)}
          stroke={color} strokeWidth="3" strokeLinecap="round"
        />
        <circle cx="100" cy="100" r="6" fill={color} />
        <text x="100" y="85" textAnchor="middle" fontSize="28" fontWeight="800" fill={color} fontFamily="'DM Mono', monospace">
          {score}
        </text>
        <text x="100" y="100" textAnchor="middle" fontSize="11" fill="#94a3b8" fontFamily="'Sora', sans-serif">/ 100</text>
      </svg>
    );
  };

  return (
    <div style={{ fontFamily: "'Sora', sans-serif", minHeight: "100vh", background: "#0f172a", color: "#e2e8f0" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&family=DM+Mono:wght@400;500;700&display=swap');
        * { box-sizing: border-box; }
        textarea:focus { outline: none; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #334155; border-radius: 99px; }
        .tab-btn { transition: all .2s; cursor: pointer; }
        .tab-btn:hover { opacity: .85; }
        .action-btn { transition: all .2s; cursor: pointer; }
        .action-btn:hover { transform: translateY(-1px); opacity: .9; }
        .card { background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 24px; }
        .chip { display: inline-flex; align-items: center; gap: 5px; padding: 4px 12px; border-radius: 99px; font-size: 12px; font-weight: 600; }
        .pulse { animation: pulse 2s infinite; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }
        textarea { background: #0f172a; border: 1.5px solid #334155; border-radius: 12px; color: #e2e8f0; font-family: 'DM Mono', monospace; font-size: 13px; padding: 16px; resize: none; transition: border .2s; }
        textarea:focus { border-color: #6366f1; }
        textarea::placeholder { color: #475569; }
      `}</style>

      {/* Header */}
      <div style={{ borderBottom: "1px solid #1e293b", padding: "20px 32px", display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 36, height: 36, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>
          📊
        </div>
        <div>
          <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: "-0.02em" }}>ATS<span style={{ color: "#6366f1" }}>Score</span></div>
          <div style={{ fontSize: 11, color: "#64748b", fontFamily: "'DM Mono', monospace" }}>Applicant Tracking System Analyzer</div>
        </div>
        {result && (
          <button onClick={reset} className="action-btn" style={{ marginLeft: "auto", background: "transparent", border: "1px solid #334155", color: "#94a3b8", padding: "6px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
            ← Nouvelle analyse
          </button>
        )}
      </div>

      <div style={{ maxWidth: 960, margin: "0 auto", padding: "32px 24px" }}>

        {!result ? (
          /* ── INPUT PANEL ── */
          <div>
            <div style={{ textAlign: "center", marginBottom: 40 }}>
              <h1 style={{ fontSize: 36, fontWeight: 800, letterSpacing: "-0.03em", margin: 0 }}>
                Votre CV passe-t-il<br />
                <span style={{ background: "linear-gradient(90deg,#6366f1,#a78bfa)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>le filtre ATS ?</span>
              </h1>
              <p style={{ color: "#64748b", marginTop: 12, fontSize: 15 }}>
                Collez votre CV et l'offre d'emploi · Score sur 100 · Recommandations personnalisées
              </p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
              <div className="card">
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                  <span style={{ fontSize: 18 }}>📄</span>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>Votre CV</span>
                  <span style={{ marginLeft: "auto", fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#475569" }}>{cv.length} car.</span>
                </div>
                <textarea
                  value={cv}
                  onChange={(e) => setCv(e.target.value)}
                  placeholder="Collez ici le texte complet de votre CV..."
                  style={{ width: "100%", height: 300 }}
                />
              </div>

              <div className="card">
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                  <span style={{ fontSize: 18 }}>💼</span>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>Offre d'emploi</span>
                  <span style={{ marginLeft: "auto", fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#475569" }}>{jd.length} car.</span>
                </div>
                <textarea
                  value={jd}
                  onChange={(e) => setJd(e.target.value)}
                  placeholder="Collez ici la description complète du poste..."
                  style={{ width: "100%", height: 300 }}
                />
              </div>
            </div>

            {error && (
              <div style={{ background: "#450a0a", border: "1px solid #7f1d1d", borderRadius: 10, padding: "12px 18px", color: "#fca5a5", fontSize: 14, marginBottom: 20 }}>
                ⚠️ {error}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "center" }}>
              <button
                onClick={analyze}
                disabled={loading || !cv.trim() || !jd.trim()}
                className="action-btn"
                style={{
                  background: loading ? "#312e81" : "linear-gradient(135deg,#6366f1,#8b5cf6)",
                  border: "none", color: "white", padding: "14px 48px", borderRadius: 12,
                  fontFamily: "'Sora', sans-serif", fontWeight: 700, fontSize: 16,
                  cursor: loading || !cv.trim() || !jd.trim() ? "not-allowed" : "pointer",
                  opacity: !cv.trim() || !jd.trim() ? 0.4 : 1,
                  display: "flex", alignItems: "center", gap: 10,
                }}
              >
                {loading ? (
                  <><span className="pulse">⚙️</span> Analyse en cours…</>
                ) : (
                  <><span>🔍</span> Analyser mon ATS Score</>
                )}
              </button>
            </div>
          </div>
        ) : (
          /* ── RESULTS PANEL ── */
          <div>
            {/* Score Hero */}
            <div className="card" style={{ display: "flex", alignItems: "center", gap: 32, marginBottom: 24, background: "linear-gradient(135deg,#1e293b,#0f172a)", border: `1px solid ${scoreColor(result.scoreGlobal)}44` }}>
              <div style={{ textAlign: "center", flexShrink: 0 }}>
                <Gauge score={result.scoreGlobal} />
                <div style={{ marginTop: 8 }}>
                  <span style={{ fontSize: 18 }}>{scoreLabel(result.scoreGlobal).emoji}</span>
                  <div style={{ fontWeight: 700, fontSize: 14, color: scoreColor(result.scoreGlobal), marginTop: 4 }}>
                    {scoreLabel(result.scoreGlobal).text}
                  </div>
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: "#6366f1", fontFamily: "'DM Mono', monospace", fontWeight: 700, letterSpacing: "0.1em", marginBottom: 8 }}>VERDICT</div>
                <p style={{ fontSize: 15, color: "#cbd5e1", lineHeight: 1.7, margin: 0 }}>{result.verdict}</p>
              </div>
            </div>

            {/* Tabs */}
            <div style={{ display: "flex", gap: 6, marginBottom: 20, background: "#1e293b", borderRadius: 12, padding: 6, border: "1px solid #334155" }}>
              {[
                { id: "score", label: "📊 Score détaillé" },
                { id: "keywords", label: "🔑 Mots-clés" },
                { id: "action", label: "🛠️ Plan d'action" },
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className="tab-btn"
                  style={{
                    flex: 1, padding: "10px 16px", borderRadius: 8, border: "none",
                    background: activeTab === t.id ? "#6366f1" : "transparent",
                    color: activeTab === t.id ? "white" : "#64748b",
                    fontFamily: "'Sora', sans-serif", fontWeight: 600, fontSize: 13,
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Tab: Score */}
            {activeTab === "score" && (
              <div style={{ display: "grid", gap: 16 }}>
                {/* Categories */}
                <div className="card">
                  <div style={{ fontSize: 11, color: "#6366f1", fontFamily: "'DM Mono', monospace", fontWeight: 700, letterSpacing: "0.1em", marginBottom: 18 }}>SCORES PAR CATÉGORIE</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                    {result.categories.map((cat) => (
                      <div key={cat.nom}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                          <span style={{ fontWeight: 600, fontSize: 14 }}>{cat.nom}</span>
                        </div>
                        <BarChart score={cat.score} max={cat.max} />
                        <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>{cat.commentaire}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Points forts / lacunes */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <div className="card">
                    <div style={{ fontSize: 11, color: "#22c55e", fontFamily: "'DM Mono', monospace", fontWeight: 700, letterSpacing: "0.1em", marginBottom: 14 }}>✅ POINTS FORTS</div>
                    <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
                      {result.pointsForts.map((p, i) => (
                        <li key={i} style={{ display: "flex", gap: 10, fontSize: 13, color: "#cbd5e1", lineHeight: 1.5 }}>
                          <span style={{ color: "#22c55e", flexShrink: 0 }}>▸</span>
                          {p}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="card">
                    <div style={{ fontSize: 11, color: "#ef4444", fontFamily: "'DM Mono', monospace", fontWeight: 700, letterSpacing: "0.1em", marginBottom: 14 }}>❌ LACUNES</div>
                    <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
                      {result.lacunes.map((l, i) => (
                        <li key={i} style={{ display: "flex", gap: 10, fontSize: 13, color: "#cbd5e1", lineHeight: 1.5 }}>
                          <span style={{ color: "#ef4444", flexShrink: 0 }}>▸</span>
                          {l}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {/* Tab: Keywords */}
            {activeTab === "keywords" && (
              <div style={{ display: "grid", gap: 16 }}>
                <div className="card">
                  <div style={{ fontSize: 11, color: "#ef4444", fontFamily: "'DM Mono', monospace", fontWeight: 700, letterSpacing: "0.1em", marginBottom: 18 }}>🔑 MOTS-CLÉS MANQUANTS</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                    {result.motsClesManquants.map((m, i) => {
                      const s = importanceColor(m.importance);
                      return (
                        <div key={i} className="chip" style={{ background: s.bg, color: s.text }}>
                          <div style={{ width: 7, height: 7, borderRadius: "50%", background: s.dot, flexShrink: 0 }} />
                          {m.terme}
                          <span style={{ fontWeight: 400, opacity: 0.7 }}>· {m.importance}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ marginTop: 16, fontSize: 12, color: "#475569", display: "flex", gap: 16 }}>
                    <span><span style={{ color: "#ef4444" }}>●</span> critique</span>
                    <span><span style={{ color: "#f97316" }}>●</span> haute</span>
                    <span><span style={{ color: "#f59e0b" }}>●</span> moyenne</span>
                  </div>
                </div>

                <div className="card">
                  <div style={{ fontSize: 11, color: "#22c55e", fontFamily: "'DM Mono', monospace", fontWeight: 700, letterSpacing: "0.1em", marginBottom: 18 }}>✅ MOTS-CLÉS PRÉSENTS</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {result.motsClesPresents.map((m, i) => (
                      <div key={i} className="chip" style={{ background: "#052e16", color: "#86efac", border: "1px solid #166534" }}>
                        ✓ {m}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Tab: Action Plan */}
            {activeTab === "action" && (
              <div style={{ display: "grid", gap: 16 }}>
                <div className="card">
                  <div style={{ fontSize: 11, color: "#6366f1", fontFamily: "'DM Mono', monospace", fontWeight: 700, letterSpacing: "0.1em", marginBottom: 20 }}>🛠️ PLAN D'ACTION PRIORISÉ</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {result.planAction.map((item, i) => {
                      const s = prioriteStyle(item.priorite);
                      return (
                        <div key={i} style={{ borderLeft: `3px solid ${s.border}`, background: s.bg, borderRadius: "0 10px 10px 0", padding: "14px 18px", display: "flex", alignItems: "flex-start", gap: 14 }}>
                          <div style={{ fontFamily: "'DM Mono', monospace", fontWeight: 700, fontSize: 11, color: "white", background: s.badge, padding: "2px 10px", borderRadius: 99, flexShrink: 0, marginTop: 2 }}>
                            {i + 1}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: s.border, fontFamily: "'DM Mono', monospace", letterSpacing: "0.08em", marginBottom: 4 }}>
                              {s.label.toUpperCase()}
                            </div>
                            <div style={{ fontSize: 14, color: "#1e293b", fontWeight: 500, lineHeight: 1.6 }}>{item.action}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {result.conseilsFormat?.length > 0 && (
                  <div className="card" style={{ borderColor: "#1e3a5f", background: "#0c1e35" }}>
                    <div style={{ fontSize: 11, color: "#60a5fa", fontFamily: "'DM Mono', monospace", fontWeight: 700, letterSpacing: "0.1em", marginBottom: 14 }}>💡 CONSEILS FORMAT ATS</div>
                    <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
                      {result.conseilsFormat.map((c, i) => (
                        <li key={i} style={{ fontSize: 13, color: "#93c5fd", display: "flex", gap: 8 }}>
                          <span style={{ flexShrink: 0 }}>→</span>{c}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
