import { useState, useCallback } from "react";

/* ── Gemini helper ── */
const MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.5-flash-lite"];
async function callGemini(key, prompt) {
  for (const model of MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.35 },
          }),
        }
      );
      if (!res.ok) continue;
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return text;
    } catch (_) { continue; }
  }
  throw new Error("Gemini indisponible. Réessaie dans quelques secondes.");
}

/* ── Inline ATS scorer ── */
function quickScore(cv, jd) {
  if (!cv || !jd) return null;
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  const cvW = new Set(norm(cv).split(/\s+/).filter((w) => w.length > 3));
  const jdW = norm(jd).split(/\s+/).filter((w) => w.length > 3);
  const total = jdW.length;
  if (!total) return null;
  const hits = jdW.filter((w) => cvW.has(w));
  const score = Math.min(100, Math.round((hits.length / total) * 180));
  const missing = [...new Set(jdW.filter((w) => !cvW.has(w)))].slice(0, 12);
  return { score, missing };
}

export default function NetworkScan({ onBack }) {
  /* ── Data from localStorage ── */
  const contacts = (() => {
    try { return JSON.parse(localStorage.getItem("tj_contacts") || "[]"); }
    catch (_) { return []; }
  })();
  const prefs = (() => {
    try { return JSON.parse(localStorage.getItem("tj_preferences") || "{}"); }
    catch (_) { return {}; }
  })();
  const cv = localStorage.getItem("tj_cv") || "";

  /* ── Group contacts by company ── */
  const companiesMap = contacts.reduce((acc, c) => {
    const co = c.company?.trim();
    if (!co) return acc;
    if (!acc[co]) acc[co] = [];
    acc[co].push(c);
    return acc;
  }, {});
  const allCompanies = Object.keys(companiesMap).sort();

  /* ── State ── */
  const [rapidKey, setRapidKey] = useState(() => localStorage.getItem("rapid_api_key") || "");
  const [geminiKey, setGeminiKey] = useState(() => localStorage.getItem("gemini_api_key") || "");
  const [showConfig, setShowConfig] = useState(false);

  const [selected, setSelected] = useState(() => new Set(allCompanies));
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, current: "" });
  const [results, setResults] = useState({}); // { company: { jobs: [], error } }

  const [activeJob, setActiveJob] = useState(null);
  const [aiTab, setAiTab] = useState(null); // null | "ats" | "tailor" | "cover"
  const [aiResult, setAiResult] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const [filterQuery, setFilterQuery] = useState("");

  /* ── Save keys ── */
  const saveKeys = () => {
    localStorage.setItem("rapid_api_key", rapidKey);
    localStorage.setItem("gemini_api_key", geminiKey);
    setShowConfig(false);
  };

  /* ── Toggle company selection ── */
  const toggleCompany = (co) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(co) ? next.delete(co) : next.add(co);
      return next;
    });
  };
  const selectAll = () => setSelected(new Set(allCompanies));
  const selectNone = () => setSelected(new Set());

  /* ── Scan ── */
  const runScan = useCallback(async () => {
    if (!rapidKey) { setShowConfig(true); return; }
    const companies = [...selected];
    if (!companies.length) return;
    const targetRoles = prefs.targetRoles || "developer engineer";
    setScanning(true);
    setResults({});
    setActiveJob(null);
    setProgress({ done: 0, total: companies.length, current: "" });

    for (let i = 0; i < companies.length; i++) {
      const co = companies[i];
      setProgress({ done: i, total: companies.length, current: co });
      try {
        const url = new URL("https://jsearch.p.rapidapi.com/search");
        url.searchParams.set("query", `${targetRoles} at ${co}`);
        url.searchParams.set("num_pages", "1");
        url.searchParams.set("page", "1");
        const resp = await fetch(url.toString(), {
          headers: {
            "X-RapidAPI-Key": rapidKey,
            "X-RapidAPI-Host": "jsearch.p.rapidapi.com",
          },
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        const jobs = (data.data || []).filter((j) =>
          j.employer_name?.toLowerCase().includes(co.toLowerCase()) ||
          co.toLowerCase().includes(j.employer_name?.toLowerCase() || "")
        );
        setResults((prev) => ({ ...prev, [co]: { jobs } }));
      } catch (e) {
        setResults((prev) => ({ ...prev, [co]: { jobs: [], error: e.message } }));
      }
      // Throttle to stay within free tier
      if (i < companies.length - 1) await new Promise((r) => setTimeout(r, 300));
    }
    setProgress((p) => ({ ...p, done: p.total, current: "" }));
    setScanning(false);
  }, [rapidKey, selected, prefs.targetRoles]);

  /* ── AI actions ── */
  const runAI = async (tab) => {
    if (!activeJob) return;
    setAiTab(tab);
    setAiResult("");
    if (tab === "ats") {
      const res = quickScore(cv, activeJob.job_description || "");
      if (!res) { setAiResult("Upload ton CV dans Setup d'abord."); return; }
      setAiResult(
        `Score ATS : ${res.score}/100\n\nMots-clés manquants :\n${res.missing.map((w) => `• ${w}`).join("\n")}`
      );
      return;
    }
    if (!geminiKey) { setAiResult("Configure ta clé Gemini (⚙️)."); return; }
    if (!cv) { setAiResult("Upload ton CV dans Setup d'abord."); return; }
    setAiLoading(true);
    try {
      const jd = activeJob.job_description?.slice(0, 3000) || activeJob.job_title;
      const prompt =
        tab === "tailor"
          ? `Tu es un expert en recrutement. Adapte ce CV pour maximiser le score ATS sur cette offre.\n\nCV :\n${cv.slice(0, 3000)}\n\nOffre :\n${jd}\n\nRègles : ne rien inventer, garder le format Markdown, mettre en avant les compétences pertinentes.`
          : `Rédige une lettre de motivation percutante (250-350 mots) pour ce poste.\n\nCV :\n${cv.slice(0, 2000)}\n\nOffre :\n${jd}\n\nTon : professionnel, direct, ancré dans des accomplissements concrets. Pas de formules génériques.`;
      const result = await callGemini(geminiKey, prompt);
      setAiResult(result);
    } catch (e) {
      setAiResult(`Erreur : ${e.message}`);
    }
    setAiLoading(false);
  };

  const copyResult = () => {
    navigator.clipboard.writeText(aiResult).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  /* ── Derived: all jobs flattened ── */
  const allJobs = Object.entries(results).flatMap(([co, r]) =>
    (r.jobs || []).map((j) => ({ ...j, _company: co }))
  );
  const totalJobs = allJobs.length;
  const scannedCount = Object.keys(results).length;

  /* ── Filter companies with jobs ── */
  const companiesWithJobs = Object.entries(results)
    .filter(([, r]) => r.jobs?.length > 0)
    .sort((a, b) => b[1].jobs.length - a[1].jobs.length);

  /* ── Filtered company list (left panel) ── */
  const filteredCompanies = allCompanies.filter((co) =>
    co.toLowerCase().includes(filterQuery.toLowerCase())
  );

  /* ── No contacts state ── */
  if (!contacts.length) {
    return (
      <div style={{ fontFamily: "'Sora',sans-serif", background: "#0f172a", color: "#e2e8f0", minHeight: "100vh" }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&family=DM+Mono:wght@400;500;700&display=swap');*{box-sizing:border-box;margin:0;padding:0;}`}</style>
        <nav style={{ borderBottom: "1px solid #1e293b", padding: "0 24px", height: 60, display: "flex", alignItems: "center", gap: 16, background: "rgba(15,23,42,0.97)", position: "sticky", top: 0, zIndex: 50 }}>
          <button onClick={onBack} style={{ background: "transparent", border: "1px solid #334155", color: "#94a3b8", padding: "6px 14px", borderRadius: 8, fontFamily: "'Sora',sans-serif", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>← Retour</button>
          <span style={{ fontWeight: 800, fontSize: 16 }}>Tracker<span style={{ color: "#6366f1" }}>Job</span> · Network Scan</span>
        </nav>
        <div style={{ maxWidth: 480, margin: "80px auto", padding: "0 24px", textAlign: "center" }}>
          <div style={{ fontSize: 56, marginBottom: 20 }}>🌐</div>
          <h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 12 }}>Aucun contact LinkedIn</h2>
          <p style={{ color: "#64748b", fontSize: 15, marginBottom: 28, lineHeight: 1.65 }}>
            Importe tes connexions LinkedIn dans Setup pour scanner les opportunités dans ton réseau.
          </p>
          <button onClick={() => onBack("setup")} style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)", border: "none", color: "white", padding: "12px 28px", borderRadius: 10, fontFamily: "'Sora',sans-serif", fontWeight: 700, fontSize: 15, cursor: "pointer" }}>
            ⚙️ Aller au Setup
          </button>
        </div>
      </div>
    );
  }

  const panelWidth = activeJob ? 340 : "100%";

  return (
    <div style={{ fontFamily: "'Sora',sans-serif", background: "#0f172a", color: "#e2e8f0", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&family=DM+Mono:wght@400;500;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:4px;} ::-webkit-scrollbar-thumb{background:#334155;border-radius:99px;}
        .ns-btn{transition:all .15s;cursor:pointer;} .ns-btn:hover{opacity:.85;}
        .co-row{transition:background .1s,border-color .1s;cursor:pointer;}
        .co-row:hover{background:#1e293b!important;}
        .job-row{transition:background .1s;cursor:pointer;border-left:3px solid transparent;}
        .job-row:hover{background:#1a1b2e!important;}
        .job-row.active{border-left-color:#6366f1!important;background:#1a1b4b!important;}
        .spin{animation:spin 1s linear infinite;display:inline-block;} @keyframes spin{to{transform:rotate(360deg)}}
        .ai-out pre{white-space:pre-wrap;font-size:13px;line-height:1.7;font-family:'DM Mono',monospace;}
      `}</style>

      {/* Config modal */}
      {showConfig && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 20, padding: 32, width: "100%", maxWidth: 480 }}>
            <h3 style={{ fontWeight: 800, fontSize: 20, marginBottom: 24 }}>⚙️ Configuration API</h3>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", display: "block", marginBottom: 6, fontFamily: "'DM Mono',monospace" }}>
                RAPIDAPI KEY <span style={{ color: "#f87171" }}>*</span>
              </label>
              <p style={{ fontSize: 11, color: "#475569", marginBottom: 8, lineHeight: 1.5 }}>Crée un compte sur rapidapi.com → cherche "JSearch" → abonne-toi gratuitement (500 req/mois)</p>
              <input value={rapidKey} onChange={(e) => setRapidKey(e.target.value)} placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" type="password"
                style={{ width: "100%", padding: "10px 14px", background: "#0f172a", border: "1.5px solid #334155", borderRadius: 10, color: "#e2e8f0", fontSize: 13, fontFamily: "'DM Mono',monospace", outline: "none" }} />
            </div>
            <div style={{ marginBottom: 28 }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", display: "block", marginBottom: 6, fontFamily: "'DM Mono',monospace" }}>
                GEMINI API KEY <span style={{ color: "#64748b" }}>(optionnel)</span>
              </label>
              <p style={{ fontSize: 11, color: "#475569", marginBottom: 8 }}>Pour l'analyse IA des offres. Gratuit sur aistudio.google.com</p>
              <input value={geminiKey} onChange={(e) => setGeminiKey(e.target.value)} placeholder="AIzaXXXXXXXXXXXXXXXXXXXXXXXXXXXX" type="password"
                style={{ width: "100%", padding: "10px 14px", background: "#0f172a", border: "1.5px solid #334155", borderRadius: 10, color: "#e2e8f0", fontSize: 13, fontFamily: "'DM Mono',monospace", outline: "none" }} />
            </div>
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
              <button onClick={() => setShowConfig(false)} className="ns-btn" style={{ background: "transparent", border: "1px solid #334155", color: "#94a3b8", padding: "10px 20px", borderRadius: 10, fontFamily: "'Sora',sans-serif", fontWeight: 600 }}>Annuler</button>
              <button onClick={saveKeys} className="ns-btn" style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)", border: "none", color: "white", padding: "10px 24px", borderRadius: 10, fontFamily: "'Sora',sans-serif", fontWeight: 700 }}>Enregistrer</button>
            </div>
          </div>
        </div>
      )}

      {/* NAV */}
      <nav style={{ borderBottom: "1px solid #1e293b", padding: "0 20px", height: 60, display: "flex", alignItems: "center", gap: 14, background: "rgba(15,23,42,0.97)", position: "sticky", top: 0, zIndex: 50, flexShrink: 0 }}>
        <button onClick={onBack} className="ns-btn" style={{ background: "transparent", border: "1px solid #334155", color: "#94a3b8", padding: "6px 14px", borderRadius: 8, fontFamily: "'Sora',sans-serif", fontSize: 13, fontWeight: 600 }}>
          ← Retour
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 28, height: 28, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Mono',monospace", fontSize: 11, fontWeight: 700, color: "white" }}>TJ</div>
          <span style={{ fontWeight: 800, fontSize: 16, letterSpacing: "-0.02em" }}>Tracker<span style={{ color: "#6366f1" }}>Job</span> · Network Scan</span>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
          {scannedCount > 0 && (
            <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, color: "#64748b" }}>
              <span style={{ color: "#a78bfa" }}>{totalJobs}</span> offres · <span style={{ color: "#a78bfa" }}>{companiesWithJobs.length}</span> entreprises
            </div>
          )}
          <button onClick={() => setShowConfig(true)} className="ns-btn" style={{ background: "transparent", border: "1px solid #334155", color: "#64748b", padding: "6px 12px", borderRadius: 8, fontFamily: "'DM Mono',monospace", fontSize: 12 }}>
            ⚙️
          </button>
        </div>
      </nav>

      {/* Body */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden", height: "calc(100vh - 60px)" }}>

        {/* LEFT: company selector */}
        <div style={{ width: panelWidth, minWidth: activeJob ? 340 : undefined, borderRight: "1px solid #1e293b", display: "flex", flexDirection: "column", flexShrink: 0, transition: "width .2s" }}>

          {/* Toolbar */}
          <div style={{ padding: "14px 16px", borderBottom: "1px solid #1e293b", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input value={filterQuery} onChange={(e) => setFilterQuery(e.target.value)} placeholder="Filtrer entreprises…"
                style={{ flex: 1, padding: "7px 12px", background: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0", fontSize: 13, fontFamily: "'DM Mono',monospace", outline: "none" }} />
              <button onClick={selectAll} className="ns-btn" style={{ background: "transparent", border: "1px solid #334155", color: "#64748b", padding: "7px 10px", borderRadius: 8, fontSize: 11, fontFamily: "'DM Mono',monospace" }}>Tout</button>
              <button onClick={selectNone} className="ns-btn" style={{ background: "transparent", border: "1px solid #334155", color: "#64748b", padding: "7px 10px", borderRadius: 8, fontSize: 11, fontFamily: "'DM Mono',monospace" }}>Aucun</button>
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "#475569", flex: 1, fontFamily: "'DM Mono',monospace" }}>
                {selected.size}/{allCompanies.length} sélectionnées
              </span>
              <button
                onClick={runScan}
                disabled={scanning || selected.size === 0}
                className="ns-btn"
                style={{ background: scanning ? "#1e293b" : "linear-gradient(135deg,#6366f1,#8b5cf6)", border: "none", color: scanning ? "#475569" : "white", padding: "8px 18px", borderRadius: 8, fontFamily: "'Sora',sans-serif", fontWeight: 700, fontSize: 13, opacity: selected.size === 0 ? 0.5 : 1 }}
              >
                {scanning ? <><span className="spin">⚙️</span> {progress.done}/{progress.total}</> : "🔍 Scanner"}
              </button>
            </div>

            {scanning && progress.current && (
              <div style={{ fontSize: 11, color: "#6366f1", fontFamily: "'DM Mono',monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                → {progress.current}
              </div>
            )}

            {prefs.targetRoles && (
              <div style={{ fontSize: 11, color: "#475569", fontFamily: "'DM Mono',monospace" }}>
                Recherche : <span style={{ color: "#94a3b8" }}>{prefs.targetRoles.slice(0, 50)}{prefs.targetRoles.length > 50 ? "…" : ""}</span>
              </div>
            )}
          </div>

          {/* Company list / Results */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {scannedCount > 0 ? (
              /* Show scanned results grouped */
              <div>
                {companiesWithJobs.map(([co, r]) => (
                  <div key={co}>
                    <div style={{ padding: "10px 16px 6px", background: "#080f1e", borderBottom: "1px solid #1e293b", position: "sticky", top: 0, zIndex: 5 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontWeight: 700, fontSize: 13, color: "#f1f5f9" }}>{co}</span>
                        <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: "#6366f1", background: "#1a1b4b", padding: "2px 8px", borderRadius: 6 }}>{r.jobs.length}</span>
                      </div>
                      <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>
                        {companiesMap[co]?.map((c) => `${c.firstName} ${c.lastName}`).join(", ").slice(0, 60)}
                        {(companiesMap[co]?.map((c) => `${c.firstName} ${c.lastName}`).join(", ").length || 0) > 60 ? "…" : ""}
                      </div>
                    </div>
                    {r.jobs.map((job) => (
                      <div key={job.job_id}
                        onClick={() => { setActiveJob(job); setAiTab(null); setAiResult(""); }}
                        className={`job-row ${activeJob?.job_id === job.job_id ? "active" : ""}`}
                        style={{ padding: "10px 16px", borderBottom: "1px solid #0f172a" }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", marginBottom: 2, lineHeight: 1.3 }}>{job.job_title}</div>
                        <div style={{ fontSize: 11, color: "#64748b", fontFamily: "'DM Mono',monospace" }}>
                          {job.job_city || job.job_country || ""}
                          {job.job_employment_type ? ` · ${job.job_employment_type}` : ""}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
                {/* Companies with no results */}
                {Object.entries(results).filter(([, r]) => !r.jobs?.length).map(([co, r]) => (
                  <div key={co} style={{ padding: "10px 16px", borderBottom: "1px solid #0f172a", opacity: 0.4 }}>
                    <div style={{ fontSize: 12, color: "#475569" }}>{co}</div>
                    <div style={{ fontSize: 11, color: "#334155", fontFamily: "'DM Mono',monospace" }}>{r.error ? `Erreur: ${r.error}` : "Aucune offre trouvée"}</div>
                  </div>
                ))}
              </div>
            ) : (
              /* Pre-scan: show selectable companies */
              filteredCompanies.map((co) => {
                const isSel = selected.has(co);
                const people = companiesMap[co] || [];
                return (
                  <div key={co} onClick={() => toggleCompany(co)}
                    className="co-row"
                    style={{ padding: "10px 16px", borderBottom: "1px solid #0f172a", background: isSel ? "#111827" : "transparent", display: "flex", alignItems: "flex-start", gap: 12 }}>
                    <div style={{ width: 18, height: 18, borderRadius: 5, border: `2px solid ${isSel ? "#6366f1" : "#334155"}`, background: isSel ? "#6366f1" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1, fontSize: 11 }}>
                      {isSel && "✓"}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: isSel ? "#e2e8f0" : "#64748b", marginBottom: 2 }}>{co}</div>
                      <div style={{ fontSize: 11, color: "#334155", fontFamily: "'DM Mono',monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {people.map((c) => `${c.firstName} ${c.lastName}`).join(", ")}
                      </div>
                    </div>
                    <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#475569", flexShrink: 0 }}>{people.length}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT: job detail */}
        {activeJob && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {/* Job header */}
            <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid #1e293b", flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
                <div>
                  <h2 style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.025em", marginBottom: 4 }}>{activeJob.job_title}</h2>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: 14, color: "#94a3b8", fontWeight: 600 }}>{activeJob.employer_name}</span>
                    {activeJob.job_city && <span style={{ fontSize: 12, color: "#475569" }}>📍 {activeJob.job_city}{activeJob.job_country ? `, ${activeJob.job_country}` : ""}</span>}
                    {activeJob.job_employment_type && <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: "#6366f1", background: "#1a1b4b", padding: "2px 8px", borderRadius: 6 }}>{activeJob.job_employment_type}</span>}
                    {activeJob.job_is_remote && <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: "#22c55e", background: "#052e16", padding: "2px 8px", borderRadius: 6 }}>Remote</span>}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  {/* Contact badge */}
                  {companiesMap[activeJob._company]?.length > 0 && (
                    <div style={{ background: "#1a1b4b", border: "1px solid #3730a3", borderRadius: 8, padding: "6px 12px", fontSize: 12 }}>
                      <div style={{ color: "#a5b4fc", fontWeight: 700, marginBottom: 1 }}>🤝 Contact</div>
                      <div style={{ color: "#e2e8f0", fontSize: 11 }}>
                        {companiesMap[activeJob._company].slice(0, 2).map((c) => `${c.firstName} ${c.lastName}`).join(", ")}
                        {companiesMap[activeJob._company].length > 2 ? ` +${companiesMap[activeJob._company].length - 2}` : ""}
                      </div>
                    </div>
                  )}
                  {activeJob.job_apply_link && (
                    <a href={activeJob.job_apply_link} target="_blank" rel="noreferrer"
                      style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "white", padding: "8px 18px", borderRadius: 8, fontFamily: "'Sora',sans-serif", fontWeight: 700, fontSize: 13, textDecoration: "none", display: "flex", alignItems: "center" }}>
                      Postuler →
                    </a>
                  )}
                </div>
              </div>

              {/* AI tabs */}
              <div style={{ display: "flex", gap: 8 }}>
                {[
                  { id: "ats", label: "Score ATS", icon: "📊" },
                  { id: "tailor", label: "Adapter CV", icon: "📄" },
                  { id: "cover", label: "Lettre de motivation", icon: "✉️" },
                ].map((tab) => (
                  <button key={tab.id} onClick={() => runAI(tab.id)} className="ns-btn"
                    style={{ background: aiTab === tab.id ? "#1a1b4b" : "#1e293b", border: `1px solid ${aiTab === tab.id ? "#6366f1" : "#334155"}`, color: aiTab === tab.id ? "#a5b4fc" : "#64748b", padding: "7px 14px", borderRadius: 8, fontFamily: "'Sora',sans-serif", fontWeight: 600, fontSize: 13 }}>
                    {tab.icon} {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Scrollable content */}
            <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
              {aiTab ? (
                <div className="ai-out">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8" }}>
                      {aiTab === "ats" ? "Score ATS" : aiTab === "tailor" ? "CV Adapté" : "Lettre de motivation"}
                    </span>
                    {aiResult && (
                      <button onClick={copyResult} className="ns-btn"
                        style={{ background: copied ? "#052e16" : "#1e293b", border: `1px solid ${copied ? "#166534" : "#334155"}`, color: copied ? "#86efac" : "#64748b", padding: "5px 14px", borderRadius: 7, fontSize: 12, fontFamily: "'DM Mono',monospace" }}>
                        {copied ? "✓ Copié" : "Copier"}
                      </button>
                    )}
                  </div>
                  {aiLoading ? (
                    <div style={{ textAlign: "center", padding: "40px 0", color: "#475569" }}>
                      <span className="spin" style={{ fontSize: 28 }}>⚙️</span>
                      <div style={{ marginTop: 12, fontSize: 13 }}>Génération en cours…</div>
                    </div>
                  ) : (
                    <pre style={{ background: "#0a1120", border: "1px solid #1e293b", borderRadius: 12, padding: "18px 20px", color: "#cbd5e1" }}>
                      {aiResult}
                    </pre>
                  )}
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#64748b", marginBottom: 14, fontFamily: "'DM Mono',monospace" }}>DESCRIPTION DU POSTE</div>
                  <div style={{ fontSize: 14, color: "#94a3b8", lineHeight: 1.75, whiteSpace: "pre-wrap" }}>
                    {activeJob.job_description?.slice(0, 4000) || "Aucune description disponible."}
                    {activeJob.job_description?.length > 4000 ? "\n\n[Description tronquée — cliquer Postuler pour voir la suite]" : ""}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Empty right state */}
        {!activeJob && scannedCount > 0 && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12, color: "#334155" }}>
            <div style={{ fontSize: 40 }}>👈</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#475569" }}>Sélectionne une offre</div>
          </div>
        )}

        {/* Pre-scan empty right state */}
        {!activeJob && scannedCount === 0 && !scanning && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16, padding: 40, textAlign: "center" }}>
            <div style={{ fontSize: 56 }}>🌐</div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.025em", marginBottom: 8 }}>Scanner ton réseau</div>
              <div style={{ fontSize: 14, color: "#64748b", maxWidth: 380, lineHeight: 1.65 }}>
                Sélectionne les entreprises à gauche et clique <strong style={{ color: "#a78bfa" }}>Scanner</strong> pour trouver les offres dans ton réseau LinkedIn.
              </div>
            </div>
            <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: "16px 20px", maxWidth: 340 }}>
              <div style={{ fontSize: 12, color: "#475569", fontFamily: "'DM Mono',monospace", marginBottom: 8 }}>CONTACTS IMPORTÉS</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: "#a78bfa", marginBottom: 4 }}>{contacts.length}</div>
              <div style={{ fontSize: 13, color: "#64748b" }}>dans <strong style={{ color: "#94a3b8" }}>{allCompanies.length}</strong> entreprises uniques</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
