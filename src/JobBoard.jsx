import { useState, useRef, useCallback } from "react";

/* ─────────────────────────────────────────────
   LOCAL ATS SCORING — lightweight inline engine
   (mirrors the logic in ats-scorer-2.jsx)
───────────────────────────────────────────────*/
const STOP = new Set(["le","la","les","de","du","des","un","une","et","en","a","au","the","and","of","to","in","is","for","with","are","was","be","this","that","from","or","as"]);
const norm = t => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9\s]/g," ").replace(/\s+/g," ").trim();
const quickScore = (cv, jd) => {
  const cvN = norm(cv); const jdWords = norm(jd).split(" ").filter(w=>w.length>3&&!STOP.has(w));
  const uniq = [...new Set(jdWords)].slice(0,50);
  const matched = uniq.filter(w=>cvN.includes(w));
  const base = Math.round((matched.length/Math.max(uniq.length,1))*100);
  return Math.min(98, Math.max(12, base));
};

/* ─────────────────────────────────────────────
   GEMINI CALL HELPER
───────────────────────────────────────────────*/
const MODELS = ["gemini-2.5-flash","gemini-2.0-flash","gemini-2.5-flash-lite"];
async function gemini(key, prompt) {
  for (const model of MODELS) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,{
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ contents:[{parts:[{text:prompt}]}], generationConfig:{temperature:0.3} })
      });
      if (!res.ok) continue;
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return text;
    } catch(_) { continue; }
  }
  throw new Error("Tous les modèles Gemini sont surchargés, réessaie dans quelques secondes.");
}

/* ─────────────────────────────────────────────
   FILE TEXT EXTRACTION (PDF/DOCX)
───────────────────────────────────────────────*/
const loadScript = src => new Promise((res,rej)=>{
  if(document.querySelector(`script[src="${src}"]`)&&window.mammoth){res();return;}
  const s=document.createElement("script"); s.src=src; s.onload=res; s.onerror=rej; document.head.appendChild(s);
});
const loadPdfJs = () => new Promise((res,rej)=>{
  if(window.pdfjsLib){res(window.pdfjsLib);return;}
  const s=document.createElement("script");
  s.src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
  s.onload=()=>{window.pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";res(window.pdfjsLib);};
  s.onerror=rej; document.head.appendChild(s);
});
async function extractText(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  if(ext==="docx"){
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js");
    const buf = await file.arrayBuffer();
    return (await window.mammoth.extractRawText({arrayBuffer:buf})).value;
  } else if(ext==="pdf"){
    const lib = await loadPdfJs(); const buf = await file.arrayBuffer();
    const pdf = await lib.getDocument({data:new Uint8Array(buf)}).promise;
    let out=""; for(let i=1;i<=pdf.numPages;i++){const p=await pdf.getPage(i);const c=await p.getTextContent();out+=c.items.map(x=>x.str).join(" ")+"\n";}
    return out;
  }
  throw new Error("Format non supporté. Utilisez .pdf ou .docx");
}

/* ─────────────────────────────────────────────
   MAIN COMPONENT
───────────────────────────────────────────────*/
export default function JobBoard({ onBack, lang = "fr" }) {
  /* Config */
  const [rapidKey, setRapidKey]   = useState(() => localStorage.getItem("tj_rapid_key") || "");
  const [geminiKey, setGeminiKey] = useState(() => localStorage.getItem("gemini_api_key") || "");
  const [showConfig, setShowConfig] = useState(false);

  /* CV */
  const [cv, setCv]               = useState(() => localStorage.getItem("tj_cv") || "");
  const [cvName, setCvName]       = useState(() => localStorage.getItem("tj_cv_name") || "");
  const [cvLoading, setCvLoading] = useState(false);
  const fileRef = useRef(null);

  /* Search */
  const [query, setQuery]         = useState("");
  const [location, setLocation]   = useState("");
  const [remote, setRemote]       = useState(false);
  const [jobs, setJobs]           = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState("");
  const [searched, setSearched]   = useState(false);

  /* Job detail */
  const [selected, setSelected]   = useState(null);

  /* AI tools */
  const [aiTab, setAiTab]         = useState(null); // null | 'ats' | 'tailor' | 'cover'
  const [aiResult, setAiResult]   = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiErr, setAiErr]         = useState("");
  const [copied, setCopied]       = useState(false);

  /* ── CV upload ── */
  const handleCV = async file => {
    if (!file) return;
    setCvLoading(true);
    try {
      const text = await extractText(file);
      setCv(text); setCvName(file.name);
      localStorage.setItem("tj_cv", text);
      localStorage.setItem("tj_cv_name", file.name);
    } catch(e) { alert("Erreur lecture fichier : " + e.message); }
    finally { setCvLoading(false); }
  };

  /* ── Save keys ── */
  const saveKeys = () => {
    localStorage.setItem("tj_rapid_key", rapidKey);
    localStorage.setItem("gemini_api_key", geminiKey);
    setShowConfig(false);
  };

  /* ── Job search via JSearch API ── */
  const searchJobs = async () => {
    if (!rapidKey.trim()) { setShowConfig(true); return; }
    if (!query.trim()) { setSearchErr(lang==="fr" ? "Entre un mot-clé de recherche." : "Enter a search keyword."); return; }
    setSearching(true); setSearchErr(""); setJobs([]); setSelected(null); setSearched(false);
    try {
      const q = [query.trim(), location.trim()].filter(Boolean).join(" ");
      const url = new URL("https://jsearch.p.rapidapi.com/search");
      url.searchParams.set("query", q);
      url.searchParams.set("page", "1");
      url.searchParams.set("num_pages", "1");
      url.searchParams.set("remote_jobs_only", remote ? "true" : "false");
      url.searchParams.set("date_posted", "all");
      const res = await fetch(url.toString(), {
        method: "GET",
        headers: { "X-RapidAPI-Key": rapidKey.trim(), "X-RapidAPI-Host": "jsearch.p.rapidapi.com" }
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Erreur API (${res.status})`);
      }
      const data = await res.json();
      setJobs(data.data || []);
      setSearched(true);
      if ((data.data || []).length === 0) setSearchErr(lang==="fr" ? "Aucune offre trouvée. Essaie d'autres mots-clés." : "No jobs found. Try different keywords.");
    } catch(e) { setSearchErr(e.message); }
    finally { setSearching(false); }
  };

  /* ── Select a job & reset AI ── */
  const selectJob = job => { setSelected(job); setAiTab(null); setAiResult(""); setAiErr(""); };

  /* ── ATS Score ── */
  const runATS = () => {
    if (!cv) { setAiErr(lang==="fr" ? "Uploade ton CV d'abord." : "Upload your resume first."); return; }
    setAiTab("ats");
    const score = quickScore(cv, selected.job_description || "");
    const color = score>=80?"#22c55e":score>=60?"#f59e0b":"#ef4444";
    const label = score>=80?(lang==="fr"?"Excellente compatibilité":"Excellent match"):score>=60?(lang==="fr"?"Bonne compatibilité":"Good match"):(lang==="fr"?"Compatibilité partielle":"Partial match");
    setAiResult(JSON.stringify({score,color,label}));
  };

  /* ── Tailor Resume ── */
  const runTailor = async () => {
    if (!cv) { setAiErr(lang==="fr" ? "Uploade ton CV d'abord." : "Upload your resume first."); return; }
    if (!geminiKey) { setShowConfig(true); return; }
    setAiTab("tailor"); setAiLoading(true); setAiResult(""); setAiErr("");
    const prompt = `Tu es un expert en recrutement. Adapte ce CV pour ce poste spécifique.

RÈGLES STRICTES :
- N'invente AUCUNE expérience ou compétence non présente dans le CV original
- Reformule les expériences existantes avec les mots-clés du poste
- Réordonne les bullets pour mettre en avant ce qui est le plus pertinent
- Adapte le résumé/profil au poste ciblé
- Utilise les termes exacts de l'offre d'emploi quand c'est authentique
- Retourne le CV complet en Markdown propre, prêt à copier-coller

CV ORIGINAL :
${cv.slice(0, 8000)}

OFFRE D'EMPLOI (${selected.job_title} chez ${selected.employer_name}) :
${(selected.job_description || "").slice(0, 5000)}`;
    try {
      const result = await gemini(geminiKey, prompt);
      setAiResult(result);
    } catch(e) { setAiErr(e.message); }
    finally { setAiLoading(false); }
  };

  /* ── Cover Letter ── */
  const runCover = async () => {
    if (!cv) { setAiErr(lang==="fr" ? "Uploade ton CV d'abord." : "Upload your resume first."); return; }
    if (!geminiKey) { setShowConfig(true); return; }
    setAiTab("cover"); setAiLoading(true); setAiResult(""); setAiErr("");
    const prompt = `Tu es un expert en lettre de motivation. Rédige une lettre de motivation professionnelle et authentique.

RÈGLES :
- Commence par "Dear Hiring Manager,"
- Termine par "Regards, [Nom du candidat]" (extrait du CV)
- 250-350 mots maximum
- Connecte 2-3 réalisations spécifiques du CV aux besoins de l'employeur
- Ton professionnel mais humain — évite le style robotique
- N'utilise pas de tirets longs (—), seulement des virgules, points, deux-points
- N'invente aucune information qui n'est pas dans le CV

CV :
${cv.slice(0, 6000)}

POSTE : ${selected.job_title} chez ${selected.employer_name}
DESCRIPTION :
${(selected.job_description || "").slice(0, 4000)}`;
    try {
      const result = await gemini(geminiKey, prompt);
      setAiResult(result);
    } catch(e) { setAiErr(e.message); }
    finally { setAiLoading(false); }
  };

  const copyResult = () => {
    navigator.clipboard?.writeText(aiResult).then(() => { setCopied(true); setTimeout(()=>setCopied(false), 2000); });
  };

  /* ── Helpers ── */
  const formatDate = iso => {
    if (!iso) return "";
    try { return new Date(iso).toLocaleDateString(lang==="fr"?"fr-FR":"en-US",{day:"numeric",month:"short"}); }
    catch(_) { return ""; }
  };
  const salaryStr = job => {
    if (!job.job_salary_min && !job.job_salary_max) return null;
    const cur = job.job_salary_currency || "USD";
    const fmt = n => n >= 1000 ? `${Math.round(n/1000)}k` : n;
    if (job.job_salary_min && job.job_salary_max) return `${fmt(job.job_salary_min)}-${fmt(job.job_salary_max)} ${cur}`;
    if (job.job_salary_min) return `${fmt(job.job_salary_min)}+ ${cur}`;
    return `≤${fmt(job.job_salary_max)} ${cur}`;
  };

  const T = {
    fr: {
      back: "← Retour",
      searchPlaceholder: "Ex: Product Manager, React developer…",
      locationPlaceholder: "Paris, Remote, France…",
      remoteLabel: "Remote uniquement",
      searchBtn: "Rechercher",
      configTitle: "Configuration des clés API",
      rapidLabel: "Clé RapidAPI (JSearch)",
      rapidHint: "Gratuit sur rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch — 500 req/mois",
      geminiLabel: "Clé Gemini (outils IA)",
      geminiHint: "Gratuit sur aistudio.google.com/app/apikey",
      saveConfig: "Enregistrer",
      cancelConfig: "Annuler",
      cvLabel: "Ton CV",
      cvUploaded: "CV chargé",
      cvDrop: "Dépose ton CV ici",
      cvSub: "ou clique pour sélectionner (.pdf, .docx)",
      cvChange: "× Changer",
      noResults: "Lance une recherche pour voir les offres.",
      applyBtn: "Postuler →",
      atsBtn: "📊 Score ATS",
      tailorBtn: "📄 Adapter mon CV",
      coverBtn: "✉️ Lettre de motivation",
      atsTitle: "Score ATS",
      tailorTitle: "CV Adapté",
      coverTitle: "Lettre de motivation",
      copyBtn: "📋 Copier",
      copiedBtn: "✓ Copié !",
      generating: "Génération en cours…",
      configNeeded: "⚙️ Configure ta clé RapidAPI",
      configSub: "Gratuit · 500 offres/mois",
      noCV: "Upload ton CV pour utiliser les outils IA",
      fullTime: "Temps plein",
      partTime: "Temps partiel",
      contract: "Contrat",
      remote: "Remote",
    },
    en: {
      back: "← Back",
      searchPlaceholder: "e.g. Product Manager, React developer…",
      locationPlaceholder: "Paris, Remote, France…",
      remoteLabel: "Remote only",
      searchBtn: "Search",
      configTitle: "API Keys Setup",
      rapidLabel: "RapidAPI Key (JSearch)",
      rapidHint: "Free at rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch — 500 req/month",
      geminiLabel: "Gemini Key (AI tools)",
      geminiHint: "Free at aistudio.google.com/app/apikey",
      saveConfig: "Save",
      cancelConfig: "Cancel",
      cvLabel: "Your Resume",
      cvUploaded: "Resume loaded",
      cvDrop: "Drop your resume here",
      cvSub: "or click to select (.pdf, .docx)",
      cvChange: "× Change",
      noResults: "Search jobs to see listings.",
      applyBtn: "Apply →",
      atsBtn: "📊 ATS Score",
      tailorBtn: "📄 Tailor my resume",
      coverBtn: "✉️ Cover letter",
      atsTitle: "ATS Score",
      tailorTitle: "Tailored Resume",
      coverTitle: "Cover Letter",
      copyBtn: "📋 Copy",
      copiedBtn: "✓ Copied!",
      generating: "Generating…",
      configNeeded: "⚙️ Configure your RapidAPI key",
      configSub: "Free · 500 jobs/month",
      noCV: "Upload your resume to use AI tools",
      fullTime: "Full-time",
      partTime: "Part-time",
      contract: "Contract",
      remote: "Remote",
    }
  };
  const t = T[lang];

  const empType = type => {
    const map = { FULLTIME: t.fullTime, PARTTIME: t.partTime, CONTRACTOR: t.contract, INTERN: "Internship" };
    return map[type] || type;
  };

  /* ─────── RENDER ─────── */
  return (
    <div style={{ fontFamily:"'Sora',sans-serif", background:"#0f172a", color:"#e2e8f0", minHeight:"100vh", display:"flex", flexDirection:"column" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&family=DM+Mono:wght@400;500;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:4px;} ::-webkit-scrollbar-thumb{background:#334155;border-radius:99px;}
        .jb-btn{transition:all .15s;cursor:pointer;} .jb-btn:hover{opacity:.85;transform:translateY(-1px);}
        .job-card{transition:all .18s;cursor:pointer;}
        .job-card:hover{border-color:#6366f1!important;transform:translateX(3px);}
        .job-card.selected{border-color:#6366f1!important;background:#1a1b4b!important;}
        .ai-tab{transition:all .15s;cursor:pointer;} .ai-tab:hover{opacity:.85;}
        .spin{animation:spin 1s linear infinite;} @keyframes spin{to{transform:rotate(360deg);}}
        input,textarea{font-family:'DM Mono',monospace!important;}
        .config-overlay{position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:100;display:flex;align-items:center;justify-content:center;padding:24px;}
      `}</style>

      {/* ── CONFIG MODAL ── */}
      {showConfig && (
        <div className="config-overlay">
          <div style={{background:"#1e293b",border:"1px solid #334155",borderRadius:20,padding:32,width:"100%",maxWidth:480}}>
            <div style={{fontWeight:800,fontSize:20,marginBottom:24}}>{t.configTitle}</div>

            <div style={{marginBottom:20}}>
              <label style={{fontSize:13,fontWeight:600,color:"#94a3b8",display:"block",marginBottom:8}}>{t.rapidLabel}</label>
              <input type="password" value={rapidKey} onChange={e=>setRapidKey(e.target.value)}
                placeholder="e27d3a..."
                style={{width:"100%",padding:"10px 14px",background:"#0f172a",border:"1px solid #334155",borderRadius:8,color:"white",fontSize:13}} />
              <div style={{fontSize:11,color:"#475569",marginTop:6}}>{t.rapidHint} · <a href="https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch" target="_blank" rel="noreferrer" style={{color:"#6366f1"}}>Obtenir une clé gratuite</a></div>
            </div>

            <div style={{marginBottom:28}}>
              <label style={{fontSize:13,fontWeight:600,color:"#94a3b8",display:"block",marginBottom:8}}>{t.geminiLabel}</label>
              <input type="password" value={geminiKey} onChange={e=>setGeminiKey(e.target.value)}
                placeholder="AIzaSy..."
                style={{width:"100%",padding:"10px 14px",background:"#0f172a",border:"1px solid #334155",borderRadius:8,color:"white",fontSize:13}} />
              <div style={{fontSize:11,color:"#475569",marginTop:6}}>{t.geminiHint} · <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" style={{color:"#8b5cf6"}}>Obtenir une clé gratuite</a></div>
            </div>

            <div style={{display:"flex",gap:12}}>
              <button onClick={saveKeys} className="jb-btn"
                style={{flex:1,background:"linear-gradient(135deg,#6366f1,#8b5cf6)",border:"none",color:"white",padding:"12px",borderRadius:10,fontFamily:"'Sora',sans-serif",fontWeight:700,fontSize:15}}>
                {t.saveConfig}
              </button>
              <button onClick={()=>setShowConfig(false)} className="jb-btn"
                style={{padding:"12px 20px",background:"transparent",border:"1px solid #334155",color:"#94a3b8",borderRadius:10,fontFamily:"'Sora',sans-serif",fontWeight:600,fontSize:15}}>
                {t.cancelConfig}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── TOP NAV ── */}
      <nav style={{borderBottom:"1px solid #1e293b",padding:"0 24px",height:60,display:"flex",alignItems:"center",gap:16,flexShrink:0,background:"rgba(15,23,42,0.97)",position:"sticky",top:0,zIndex:50}}>
        <button onClick={onBack} className="jb-btn"
          style={{background:"transparent",border:"1px solid #334155",color:"#94a3b8",padding:"6px 14px",borderRadius:8,fontFamily:"'Sora',sans-serif",fontSize:13,fontWeight:600}}>
          {t.back}
        </button>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{width:28,height:28,background:"linear-gradient(135deg,#6366f1,#8b5cf6)",borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Mono',monospace",fontSize:11,fontWeight:700,color:"white"}}>TJ</div>
          <span style={{fontWeight:800,fontSize:16,letterSpacing:"-0.02em"}}>Tracker<span style={{color:"#6366f1"}}>Job</span></span>
        </div>

        {/* Config button */}
        <button onClick={()=>setShowConfig(true)} className="jb-btn"
          style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:6,background:rapidKey?"#052e16":"#450a0a",border:`1px solid ${rapidKey?"#166534":"#7f1d1d"}`,color:rapidKey?"#86efac":"#fca5a5",padding:"5px 12px",borderRadius:8,fontSize:12,fontWeight:600,fontFamily:"'DM Mono',monospace"}}>
          <span>{rapidKey?"✓":"!"}</span> API
        </button>
      </nav>

      {/* ── SEARCH BAR ── */}
      <div style={{borderBottom:"1px solid #1e293b",padding:"16px 24px",background:"#0a1120",flexShrink:0}}>
        <div style={{maxWidth:1400,margin:"0 auto",display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
          <input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&searchJobs()}
            placeholder={t.searchPlaceholder}
            style={{flex:"2 1 260px",padding:"10px 16px",background:"#1e293b",border:"1.5px solid #334155",borderRadius:10,color:"#e2e8f0",fontSize:14}} />
          <input value={location} onChange={e=>setLocation(e.target.value)} onKeyDown={e=>e.key==="Enter"&&searchJobs()}
            placeholder={t.locationPlaceholder}
            style={{flex:"1 1 180px",padding:"10px 16px",background:"#1e293b",border:"1.5px solid #334155",borderRadius:10,color:"#e2e8f0",fontSize:14}} />
          <label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,color:"#94a3b8",cursor:"pointer",whiteSpace:"nowrap"}}>
            <input type="checkbox" checked={remote} onChange={e=>setRemote(e.target.checked)} style={{accentColor:"#6366f1",width:15,height:15}} />
            {t.remoteLabel}
          </label>
          <button onClick={searchJobs} className="jb-btn"
            style={{background:"linear-gradient(135deg,#6366f1,#8b5cf6)",border:"none",color:"white",padding:"10px 28px",borderRadius:10,fontFamily:"'Sora',sans-serif",fontWeight:700,fontSize:15,whiteSpace:"nowrap"}}>
            {searching ? <span className="spin">⟳</span> : t.searchBtn}
          </button>
        </div>
        {searchErr && <div style={{maxWidth:1400,margin:"10px auto 0",color:"#fca5a5",fontSize:13}}>{searchErr}</div>}
      </div>

      {/* ── MAIN BODY ── */}
      <div style={{flex:1,display:"flex",maxWidth:1400,margin:"0 auto",width:"100%",padding:"0 16px",gap:0,overflow:"hidden",height:"calc(100vh - 120px)"}}>

        {/* ── LEFT: CV UPLOAD + JOB LIST ── */}
        <div style={{width:selected?"380px":"100%",flexShrink:0,overflowY:"auto",padding:"16px 8px 16px 0",transition:"width .2s"}}>

          {/* CV Card */}
          <div
            style={{background:"#1e293b",border:`1.5px dashed ${cv?"#166534":"#334155"}`,borderRadius:14,padding:"14px 16px",marginBottom:16,cursor:cv?"default":"pointer",display:"flex",alignItems:"center",gap:12}}
            onClick={()=>!cv&&fileRef.current?.click()}
            onDrop={e=>{e.preventDefault();handleCV(e.dataTransfer.files[0]);}}
            onDragOver={e=>e.preventDefault()}
          >
            <div style={{fontSize:22}}>{cvLoading?"⚙️":cv?"✅":"📄"}</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:12,fontWeight:700,color:"#94a3b8",marginBottom:2}}>{t.cvLabel}</div>
              {cvLoading ? <div style={{fontSize:13,color:"#64748b"}}>Extraction…</div>
                : cv ? <div style={{fontSize:13,color:"#86efac",fontFamily:"'DM Mono',monospace",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{cvName || t.cvUploaded}</div>
                : <div style={{fontSize:13,color:"#475569"}}>{t.cvDrop} <span style={{color:"#64748b"}}>· .pdf .docx</span></div>}
            </div>
            {cv && <button onClick={e=>{e.stopPropagation();setCv("");setCvName("");fileRef.current&&(fileRef.current.value="");localStorage.removeItem("tj_cv");localStorage.removeItem("tj_cv_name");}}
              style={{background:"transparent",border:"1px solid #334155",color:"#64748b",padding:"3px 10px",borderRadius:6,fontSize:11,cursor:"pointer",fontFamily:"'DM Mono',monospace",whiteSpace:"nowrap"}}>
              {t.cvChange}
            </button>}
            {!cv && <button onClick={e=>{e.stopPropagation();fileRef.current?.click();}}
              style={{background:"#6366f1",border:"none",color:"white",padding:"5px 14px",borderRadius:7,fontSize:12,cursor:"pointer",fontFamily:"'Sora',sans-serif",fontWeight:600,whiteSpace:"nowrap"}}>
              Upload
            </button>}
          </div>
          <input ref={fileRef} type="file" accept=".pdf,.docx" style={{display:"none"}} onChange={e=>handleCV(e.target.files[0])} />

          {/* Job count */}
          {jobs.length > 0 && (
            <div style={{fontSize:12,color:"#475569",fontFamily:"'DM Mono',monospace",marginBottom:12,paddingLeft:4}}>
              {jobs.length} {lang==="fr" ? "offres trouvées" : "jobs found"}
            </div>
          )}

          {/* Empty state */}
          {!searching && !searched && jobs.length === 0 && (
            <div style={{textAlign:"center",padding:"60px 20px",color:"#334155"}}>
              <div style={{fontSize:48,marginBottom:16}}>🔍</div>
              <div style={{fontSize:15,fontWeight:600,color:"#475569",marginBottom:8}}>{t.noResults}</div>
              {!rapidKey && (
                <button onClick={()=>setShowConfig(true)} className="jb-btn"
                  style={{marginTop:16,background:"#1e293b",border:"1px solid #334155",color:"#6366f1",padding:"8px 20px",borderRadius:8,fontFamily:"'Sora',sans-serif",fontSize:13,fontWeight:600}}>
                  {t.configNeeded}
                </button>
              )}
            </div>
          )}

          {/* Job cards */}
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {jobs.map(job => {
              const sal = salaryStr(job);
              const isSelected = selected?.job_id === job.job_id;
              return (
                <div key={job.job_id} className={`job-card${isSelected?" selected":""}`}
                  onClick={() => selectJob(job)}
                  style={{background:"#1e293b",border:`1.5px solid ${isSelected?"#6366f1":"#1e293b"}`,borderRadius:14,padding:"16px",cursor:"pointer"}}>
                  <div style={{display:"flex",gap:12,alignItems:"flex-start"}}>
                    {job.employer_logo
                      ? <img src={job.employer_logo} alt="" style={{width:40,height:40,borderRadius:8,objectFit:"contain",background:"white",padding:3,flexShrink:0}} onError={e=>e.target.style.display="none"} />
                      : <div style={{width:40,height:40,borderRadius:8,background:"linear-gradient(135deg,#6366f1,#8b5cf6)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:14,color:"white",flexShrink:0}}>
                          {(job.employer_name||"?")[0].toUpperCase()}
                        </div>
                    }
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:700,fontSize:14,color:"#f1f5f9",lineHeight:1.3,marginBottom:4}}>{job.job_title}</div>
                      <div style={{fontSize:13,color:"#64748b",marginBottom:6}}>{job.employer_name}</div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                        {job.job_city && <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:"#94a3b8"}}>📍 {job.job_city}{job.job_country&&job.job_country!=="US"?`, ${job.job_country}`:""}</span>}
                        {job.job_is_remote && <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,background:"#0c2e1a",color:"#4ade80",border:"1px solid #166534",padding:"1px 7px",borderRadius:99}}>Remote</span>}
                        {job.job_employment_type && <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,background:"#1e1b4b",color:"#a5b4fc",border:"1px solid #3730a3",padding:"1px 7px",borderRadius:99}}>{empType(job.job_employment_type)}</span>}
                        {sal && <span style={{fontFamily:"'DM Mono',monospace",fontSize:10,background:"#0f2e1a",color:"#86efac",border:"1px solid #166534",padding:"1px 7px",borderRadius:99}}>{sal}</span>}
                      </div>
                    </div>
                    {job.job_posted_at_datetime_utc && (
                      <div style={{fontSize:10,color:"#475569",fontFamily:"'DM Mono',monospace",whiteSpace:"nowrap",flexShrink:0}}>{formatDate(job.job_posted_at_datetime_utc)}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── RIGHT: JOB DETAIL + AI TOOLS ── */}
        {selected && (
          <div style={{flex:1,overflowY:"auto",padding:"16px 0 16px 16px",borderLeft:"1px solid #1e293b"}}>

            {/* Job header */}
            <div style={{background:"#1e293b",border:"1px solid #334155",borderRadius:16,padding:"24px",marginBottom:16}}>
              <div style={{display:"flex",gap:14,alignItems:"flex-start",marginBottom:16}}>
                {selected.employer_logo
                  ? <img src={selected.employer_logo} alt="" style={{width:52,height:52,borderRadius:10,objectFit:"contain",background:"white",padding:4,flexShrink:0}} onError={e=>e.target.style.display="none"} />
                  : <div style={{width:52,height:52,borderRadius:10,background:"linear-gradient(135deg,#6366f1,#8b5cf6)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700,fontSize:20,color:"white",flexShrink:0}}>
                      {(selected.employer_name||"?")[0].toUpperCase()}
                    </div>
                }
                <div style={{flex:1}}>
                  <h2 style={{fontSize:20,fontWeight:800,letterSpacing:"-0.02em",color:"#f1f5f9",marginBottom:4}}>{selected.job_title}</h2>
                  <div style={{fontSize:15,color:"#94a3b8",marginBottom:8}}>{selected.employer_name}</div>
                  <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                    {selected.job_city && <span style={{fontSize:13,color:"#64748b"}}>📍 {selected.job_city}{selected.job_country?`, ${selected.job_country}`:""}</span>}
                    {selected.job_is_remote && <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,background:"#0c2e1a",color:"#4ade80",border:"1px solid #166534",padding:"2px 9px",borderRadius:99}}>Remote</span>}
                    {salaryStr(selected) && <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,background:"#0f2e1a",color:"#86efac",border:"1px solid #166534",padding:"2px 9px",borderRadius:99}}>{salaryStr(selected)}</span>}
                  </div>
                </div>
              </div>

              {/* Apply button */}
              {selected.job_apply_link && (
                <a href={selected.job_apply_link} target="_blank" rel="noreferrer"
                  style={{display:"inline-flex",alignItems:"center",gap:8,background:"linear-gradient(135deg,#6366f1,#8b5cf6)",color:"white",padding:"10px 24px",borderRadius:10,fontFamily:"'Sora',sans-serif",fontWeight:700,fontSize:14,textDecoration:"none"}}>
                  {t.applyBtn}
                </a>
              )}
            </div>

            {/* ── AI TOOLS ── */}
            <div style={{background:"#1e293b",border:"1px solid #334155",borderRadius:16,padding:"20px",marginBottom:16}}>
              {/* Tab buttons */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:aiTab?16:0}}>
                {[
                  {id:"ats", label:t.atsBtn, action:runATS},
                  {id:"tailor", label:t.tailorBtn, action:runTailor},
                  {id:"cover", label:t.coverBtn, action:runCover},
                ].map(({id,label,action}) => (
                  <button key={id} onClick={action} className="ai-tab"
                    style={{padding:"10px 8px",borderRadius:10,border:`1.5px solid ${aiTab===id?"#6366f1":"#334155"}`,background:aiTab===id?"#1a1b4b":"transparent",color:aiTab===id?"#a5b4fc":"#94a3b8",fontFamily:"'Sora',sans-serif",fontWeight:600,fontSize:13,cursor:"pointer",textAlign:"center",lineHeight:1.3}}>
                    {label}
                  </button>
                ))}
              </div>

              {/* AI output */}
              {aiTab && (
                <div>
                  {/* Title */}
                  <div style={{fontSize:11,color:"#6366f1",fontFamily:"'DM Mono',monospace",fontWeight:700,letterSpacing:"0.1em",marginBottom:12}}>
                    {aiTab==="ats"?t.atsTitle:aiTab==="tailor"?t.tailorTitle:t.coverTitle}
                  </div>

                  {/* Error */}
                  {aiErr && <div style={{background:"#450a0a",border:"1px solid #7f1d1d",borderRadius:8,padding:"10px 14px",color:"#fca5a5",fontSize:13,marginBottom:12}}>⚠️ {aiErr}</div>}

                  {/* ATS Score result */}
                  {aiTab==="ats" && aiResult && (() => {
                    const {score,color,label} = JSON.parse(aiResult);
                    return (
                      <div>
                        {!cv && <div style={{color:"#f59e0b",fontSize:13,marginBottom:12}}>⚠️ {t.noCV}</div>}
                        <div style={{display:"flex",alignItems:"center",gap:20,padding:"20px",background:"#0f172a",borderRadius:12,border:`1px solid ${color}44`}}>
                          <div style={{textAlign:"center"}}>
                            <div style={{fontSize:52,fontWeight:800,color,fontFamily:"'DM Mono',monospace",lineHeight:1}}>{score}</div>
                            <div style={{fontSize:12,color:"#475569",fontFamily:"'DM Mono',monospace"}}>/100</div>
                          </div>
                          <div>
                            <div style={{fontSize:16,fontWeight:700,color,marginBottom:4}}>{label}</div>
                            <div style={{fontSize:13,color:"#64748b",lineHeight:1.5}}>
                              {lang==="fr"
                                ? score>=80?"Votre profil correspond très bien à cette offre. Postulez !"
                                  :score>=60?"Bonne correspondance. Adaptez votre CV pour améliorer le score."
                                  :"Correspondance partielle. Taillez votre CV avec les mots-clés du poste."
                                : score>=80?"Your profile matches this job very well. Apply now!"
                                  :score>=60?"Good match. Tailor your resume to improve the score."
                                  :"Partial match. Tailor your resume with this job's keywords."
                              }
                            </div>
                          </div>
                        </div>
                        {score < 80 && (
                          <button onClick={runTailor} className="jb-btn"
                            style={{marginTop:12,width:"100%",background:"linear-gradient(135deg,#6366f1,#8b5cf6)",border:"none",color:"white",padding:"11px",borderRadius:10,fontFamily:"'Sora',sans-serif",fontWeight:700,fontSize:14}}>
                            📄 {t.tailorBtn}
                          </button>
                        )}
                      </div>
                    );
                  })()}

                  {/* Loading */}
                  {aiLoading && (
                    <div style={{textAlign:"center",padding:"32px",color:"#64748b"}}>
                      <div className="spin" style={{fontSize:28,display:"inline-block",marginBottom:12}}>⚙️</div>
                      <div style={{fontSize:14}}>{t.generating}</div>
                    </div>
                  )}

                  {/* Text result (tailor / cover) */}
                  {!aiLoading && aiResult && aiTab !== "ats" && (
                    <div>
                      <div style={{position:"relative"}}>
                        <pre style={{background:"#0f172a",border:"1px solid #1e293b",borderRadius:10,padding:"16px",color:"#cbd5e1",fontSize:13,lineHeight:1.7,whiteSpace:"pre-wrap",wordBreak:"break-word",maxHeight:420,overflowY:"auto",fontFamily:"'DM Mono',monospace"}}>
                          {aiResult}
                        </pre>
                      </div>
                      <button onClick={copyResult} className="jb-btn"
                        style={{marginTop:10,width:"100%",background:copied?"#052e16":"#1e293b",border:`1px solid ${copied?"#166534":"#334155"}`,color:copied?"#86efac":"#94a3b8",padding:"10px",borderRadius:10,fontFamily:"'Sora',sans-serif",fontWeight:600,fontSize:14}}>
                        {copied ? t.copiedBtn : t.copyBtn}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Job description */}
            <div style={{background:"#1e293b",border:"1px solid #334155",borderRadius:16,padding:"20px"}}>
              <div style={{fontSize:11,color:"#6366f1",fontFamily:"'DM Mono',monospace",fontWeight:700,letterSpacing:"0.1em",marginBottom:14}}>
                {lang==="fr" ? "DESCRIPTION DU POSTE" : "JOB DESCRIPTION"}
              </div>
              <div style={{fontSize:14,color:"#94a3b8",lineHeight:1.75,whiteSpace:"pre-wrap"}}>
                {selected.job_description || (lang==="fr" ? "Aucune description disponible." : "No description available.")}
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}
