import { useState, useRef } from "react";

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
            generationConfig: { temperature: 0.4 },
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

/* ── File extraction ── */
const loadScript = (src) =>
  new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`) && window.mammoth) { res(); return; }
    const s = document.createElement("script");
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
const loadPdfJs = () =>
  new Promise((res, rej) => {
    if (window.pdfjsLib) { res(window.pdfjsLib); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    s.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      res(window.pdfjsLib);
    };
    s.onerror = rej;
    document.head.appendChild(s);
  });
async function extractText(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (ext === "docx") {
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js");
    return (await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
  }
  if (ext === "pdf") {
    const lib = await loadPdfJs();
    const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    let out = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const p = await pdf.getPage(i);
      out += (await p.getTextContent()).items.map((x) => x.str).join(" ") + "\n";
    }
    return out;
  }
  throw new Error("Format non supporté. Utilisez .pdf ou .docx");
}

/* ── Parse LinkedIn CSV ── */
function parseLinkedIn(csvText) {
  const lines = csvText.split("\n").filter((l) => l.trim());
  const headerIdx = lines.findIndex((l) =>
    /first.name|prénom/i.test(l) || /company|entreprise/i.test(l)
  );
  if (headerIdx === -1) return [];
  const headers = lines[headerIdx].split(",").map((h) => h.replace(/"/g, "").trim().toLowerCase());
  const col = (row, ...keys) => {
    for (const k of keys) {
      const i = headers.findIndex((h) => h.includes(k));
      if (i !== -1 && row[i]) return row[i].replace(/"/g, "").trim();
    }
    return "";
  };
  return lines
    .slice(headerIdx + 1)
    .filter((l) => l.trim() && l !== "\r")
    .map((line) => {
      const row = line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
      return {
        firstName: col(row, "first"),
        lastName: col(row, "last"),
        company: col(row, "company", "entreprise", "organisation"),
        position: col(row, "position", "poste", "titre", "title"),
        connectedOn: col(row, "connected", "date"),
      };
    })
    .filter((c) => c.company);
}

const STEPS = [
  { id: "cv", icon: "📄", label: "Mon CV" },
  { id: "prefs", icon: "🎯", label: "Préférences" },
  { id: "linkedin", icon: "🌐", label: "LinkedIn" },
  { id: "interview", icon: "🧠", label: "Historique" },
];

export default function SetupWizard({ onBack, onDone, lang = "fr" }) {
  const [step, setStep] = useState(0);

  /* CV */
  const [cv, setCv] = useState(() => localStorage.getItem("tj_cv") || "");
  const [cvName, setCvName] = useState(() => localStorage.getItem("tj_cv_name") || "");
  const [cvLoading, setCvLoading] = useState(false);
  const fileRef = useRef(null);

  /* Preferences */
  const [prefs, setPrefs] = useState(() => {
    try { return JSON.parse(localStorage.getItem("tj_preferences") || "{}"); }
    catch (_) { return {}; }
  });

  /* LinkedIn */
  const [linkedinRaw, setLinkedinRaw] = useState(() => localStorage.getItem("tj_linkedin_raw") || "");
  const [contacts, setContacts] = useState(() => {
    try { return JSON.parse(localStorage.getItem("tj_contacts") || "[]"); }
    catch (_) { return []; }
  });
  const linkedinRef = useRef(null);

  /* Interview */
  const [geminiKey] = useState(() => localStorage.getItem("gemini_api_key") || "");
  const [messages, setMessages] = useState(() => {
    try { return JSON.parse(localStorage.getItem("tj_interview_messages") || "[]"); }
    catch (_) { return []; }
  });
  const [userInput, setUserInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [profileSaved, setProfileSaved] = useState(!!localStorage.getItem("tj_work_profile"));
  const messagesEndRef = useRef(null);

  /* ── Step helpers ── */
  const updatePref = (key, val) => setPrefs((p) => ({ ...p, [key]: val }));
  const savePref = () => localStorage.setItem("tj_preferences", JSON.stringify(prefs));

  const handleCV = async (file) => {
    if (!file) return;
    setCvLoading(true);
    try {
      const text = await extractText(file);
      setCv(text); setCvName(file.name);
      localStorage.setItem("tj_cv", text);
      localStorage.setItem("tj_cv_name", file.name);
    } catch (e) { alert(e.message); }
    finally { setCvLoading(false); }
  };

  const handleLinkedIn = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const raw = e.target.result;
      const parsed = parseLinkedIn(raw);
      setLinkedinRaw(raw);
      setContacts(parsed);
      localStorage.setItem("tj_linkedin_raw", raw);
      localStorage.setItem("tj_contacts", JSON.stringify(parsed));
    };
    reader.readAsText(file);
  };

  /* ── Interview chat ── */
  const buildSystemPrompt = () => `Tu es un recruteur expert qui conduit un entretien de carrière approfondi.
Ton but : extraire des informations détaillées sur le parcours professionnel du candidat pour créer un profil complet.

CV du candidat :
${cv.slice(0, 4000)}

Conduis l'entretien en français, de façon naturelle et conversationnelle. Pose UNE question à la fois.
Commence par te présenter brièvement et poser une première question sur le poste le plus récent.
Quand tu as couvert 2-3 rôles importants, propose de générer le profil avec [PROFIL_PRÊT].`;

  const startInterview = async () => {
    if (!geminiKey) { alert("Configure ta clé Gemini d'abord (⚙️ dans le job board)."); return; }
    if (!cv) { alert("Upload ton CV à l'étape 1 d'abord."); return; }
    setChatLoading(true);
    try {
      const firstMsg = await callGemini(
        geminiKey,
        buildSystemPrompt() + "\n\nLance l'entretien maintenant."
      );
      const msgs = [{ role: "assistant", content: firstMsg }];
      setMessages(msgs);
      localStorage.setItem("tj_interview_messages", JSON.stringify(msgs));
    } catch (e) { alert(e.message); }
    finally { setChatLoading(false); }
  };

  const sendMessage = async () => {
    if (!userInput.trim() || chatLoading) return;
    const newMsgs = [...messages, { role: "user", content: userInput }];
    setMessages(newMsgs);
    setUserInput("");
    setChatLoading(true);
    try {
      const history = newMsgs
        .map((m) => `${m.role === "user" ? "Candidat" : "Recruteur"}: ${m.content}`)
        .join("\n\n");
      const reply = await callGemini(
        geminiKey,
        buildSystemPrompt() +
          "\n\nHistorique de l'entretien :\n" + history +
          "\n\nContinue l'entretien. Pose la prochaine question ou génère le profil si tu as assez d'informations."
      );
      const updated = [...newMsgs, { role: "assistant", content: reply }];
      setMessages(updated);
      localStorage.setItem("tj_interview_messages", JSON.stringify(updated));
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);

      if (reply.includes("[PROFIL_PRÊT]")) await generateProfile(updated);
    } catch (e) { alert(e.message); }
    finally { setChatLoading(false); }
  };

  const generateProfile = async (msgs) => {
    const history = msgs.map((m) => `${m.role === "user" ? "Candidat" : "Recruteur"}: ${m.content}`).join("\n\n");
    const profile = await callGemini(
      geminiKey,
      `À partir de cet entretien de carrière, génère un profil professionnel structuré en Markdown.

Inclus : aperçu du candidat, rôles détaillés (accomplissements avec métriques si disponibles), compétences clés, patterns de carrière.

Entretien :
${history}`
    );
    localStorage.setItem("tj_work_profile", profile);
    setProfileSaved(true);
  };

  const forceGenProfile = async () => {
    if (!geminiKey || messages.length < 2) return;
    setChatLoading(true);
    try { await generateProfile(messages); }
    catch (e) { alert(e.message); }
    finally { setChatLoading(false); }
  };

  /* ── Completion check ── */
  const completionStatus = {
    cv: !!cv,
    prefs: !!(prefs.targetRoles),
    linkedin: contacts.length > 0,
    interview: profileSaved,
  };

  /* ── Styles ── */
  const card = {
    background: "#1e293b", border: "1px solid #334155", borderRadius: 16, padding: "24px",
  };
  const inputStyle = {
    width: "100%", padding: "10px 14px", background: "#0f172a", border: "1.5px solid #334155",
    borderRadius: 10, color: "#e2e8f0", fontSize: 14, fontFamily: "'DM Mono', monospace",
    outline: "none", marginTop: 6,
  };
  const labelStyle = { fontSize: 13, fontWeight: 600, color: "#94a3b8", display: "block", marginBottom: 2 };

  return (
    <div style={{ fontFamily: "'Sora',sans-serif", background: "#0f172a", color: "#e2e8f0", minHeight: "100vh" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&family=DM+Mono:wght@400;500;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:4px;} ::-webkit-scrollbar-thumb{background:#334155;border-radius:99px;}
        .sw-btn{transition:all .15s;cursor:pointer;} .sw-btn:hover{opacity:.85;}
        textarea,input{transition:border-color .15s;}
        textarea:focus,input:focus{outline:none;border-color:#6366f1!important;}
        .chat-msg{animation:fadeUp .2s ease both;} @keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
        .spin{animation:spin 1s linear infinite;} @keyframes spin{to{transform:rotate(360deg)}}
      `}</style>

      {/* NAV */}
      <nav style={{ borderBottom: "1px solid #1e293b", padding: "0 24px", height: 60, display: "flex", alignItems: "center", gap: 16, background: "rgba(15,23,42,0.97)", position: "sticky", top: 0, zIndex: 50 }}>
        <button onClick={onBack} className="sw-btn" style={{ background: "transparent", border: "1px solid #334155", color: "#94a3b8", padding: "6px 14px", borderRadius: 8, fontFamily: "'Sora',sans-serif", fontSize: 13, fontWeight: 600 }}>
          ← Retour
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 28, height: 28, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Mono',monospace", fontSize: 11, fontWeight: 700, color: "white" }}>TJ</div>
          <span style={{ fontWeight: 800, fontSize: 16, letterSpacing: "-0.02em" }}>Tracker<span style={{ color: "#6366f1" }}>Job</span> · Setup</span>
        </div>
      </nav>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "40px 24px" }}>

        {/* Progress */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 40 }}>
          {STEPS.map((s, i) => {
            const done = completionStatus[s.id];
            const active = i === step;
            return (
              <button key={s.id} onClick={() => setStep(i)} className="sw-btn"
                style={{ background: active ? "#1a1b4b" : "#1e293b", border: `1.5px solid ${active ? "#6366f1" : done ? "#166534" : "#334155"}`, borderRadius: 12, padding: "12px 8px", textAlign: "center" }}>
                <div style={{ fontSize: 20, marginBottom: 4 }}>{done ? "✅" : s.icon}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: active ? "#a5b4fc" : done ? "#86efac" : "#475569" }}>{s.label}</div>
              </button>
            );
          })}
        </div>

        {/* ── STEP 0: CV ── */}
        {step === 0 && (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em", marginBottom: 8 }}>📄 Ton CV</h2>
            <p style={{ color: "#64748b", fontSize: 14, marginBottom: 28 }}>Uploade ton CV — il sera utilisé dans tous les outils IA du site.</p>

            <div style={card}>
              <div
                onDrop={(e) => { e.preventDefault(); handleCV(e.dataTransfer.files[0]); }}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => !cv && fileRef.current?.click()}
                style={{ border: `2px dashed ${cv ? "#166534" : "#334155"}`, borderRadius: 12, padding: "40px 24px", textAlign: "center", cursor: cv ? "default" : "pointer", background: cv ? "#052e16" : "#0f172a" }}
              >
                {cvLoading ? (
                  <div><div className="spin" style={{ fontSize: 32, display: "inline-block" }}>⚙️</div><div style={{ color: "#64748b", marginTop: 8, fontSize: 13 }}>Extraction…</div></div>
                ) : cv ? (
                  <div>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
                    <div style={{ color: "#86efac", fontWeight: 700, marginBottom: 4 }}>{cvName}</div>
                    <div style={{ color: "#64748b", fontSize: 12, fontFamily: "'DM Mono',monospace", maxHeight: 120, overflow: "hidden", textAlign: "left", lineHeight: 1.6 }}>{cv.slice(0, 300)}…</div>
                    <button onClick={(e) => { e.stopPropagation(); setCv(""); setCvName(""); localStorage.removeItem("tj_cv"); localStorage.removeItem("tj_cv_name"); }}
                      style={{ marginTop: 12, background: "transparent", border: "1px solid #334155", color: "#94a3b8", padding: "4px 12px", borderRadius: 6, fontSize: 12, cursor: "pointer" }}>
                      × Changer
                    </button>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>📂</div>
                    <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Dépose ton CV ici</div>
                    <div style={{ color: "#475569", fontSize: 13 }}>ou clique pour sélectionner · .pdf .docx</div>
                  </div>
                )}
              </div>
              <input ref={fileRef} type="file" accept=".pdf,.docx" style={{ display: "none" }} onChange={(e) => handleCV(e.target.files[0])} />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 24 }}>
              <button onClick={() => setStep(1)} className="sw-btn"
                style={{ background: cv ? "linear-gradient(135deg,#6366f1,#8b5cf6)" : "#1e293b", border: cv ? "none" : "1px solid #334155", color: cv ? "white" : "#475569", padding: "12px 32px", borderRadius: 10, fontFamily: "'Sora',sans-serif", fontWeight: 700, fontSize: 15 }}>
                {cv ? "Continuer →" : "Passer →"}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 1: PREFS ── */}
        {step === 1 && (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em", marginBottom: 8 }}>🎯 Tes préférences</h2>
            <p style={{ color: "#64748b", fontSize: 14, marginBottom: 28 }}>Utilisées pour filtrer les offres et personnaliser tes candidatures.</p>

            <div style={{ ...card, display: "flex", flexDirection: "column", gap: 20 }}>
              <div>
                <label style={labelStyle}>Postes recherchés *</label>
                <div style={{ fontSize: 11, color: "#475569", marginBottom: 6 }}>Ex: Product Manager, Growth Manager, Chef de Projet Digital</div>
                <input value={prefs.targetRoles || ""} onChange={(e) => updatePref("targetRoles", e.target.value)} placeholder="Product Manager, Data Analyst…" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Localisation</label>
                <input value={prefs.location || ""} onChange={(e) => updatePref("location", e.target.value)} placeholder="Paris, Remote, Île-de-France…" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Salaire cible</label>
                <input value={prefs.salary || ""} onChange={(e) => updatePref("salary", e.target.value)} placeholder="50k-70k€, +80k€…" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Must-haves</label>
                <textarea value={prefs.mustHaves || ""} onChange={(e) => updatePref("mustHaves", e.target.value)} placeholder="Remote possible, startup série B+, management d'équipe…" rows={2}
                  style={{ ...inputStyle, resize: "none" }} />
              </div>
              <div>
                <label style={labelStyle}>Dealbreakers</label>
                <textarea value={prefs.dealbreakers || ""} onChange={(e) => updatePref("dealbreakers", e.target.value)} placeholder="Agences, retail, moins de 3 ans d'expérience requise…" rows={2}
                  style={{ ...inputStyle, resize: "none" }} />
              </div>
              <div>
                <label style={labelStyle}>Nice-to-haves</label>
                <textarea value={prefs.niceToHaves || ""} onChange={(e) => updatePref("niceToHaves", e.target.value)} placeholder="International, scale-up, impact social…" rows={2}
                  style={{ ...inputStyle, resize: "none" }} />
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 24 }}>
              <button onClick={() => setStep(0)} className="sw-btn" style={{ background: "transparent", border: "1px solid #334155", color: "#94a3b8", padding: "12px 24px", borderRadius: 10, fontFamily: "'Sora',sans-serif", fontWeight: 600 }}>← Retour</button>
              <button onClick={() => { savePref(); setStep(2); }} className="sw-btn"
                style={{ background: prefs.targetRoles ? "linear-gradient(135deg,#6366f1,#8b5cf6)" : "#1e293b", border: prefs.targetRoles ? "none" : "1px solid #334155", color: prefs.targetRoles ? "white" : "#475569", padding: "12px 32px", borderRadius: 10, fontFamily: "'Sora',sans-serif", fontWeight: 700, fontSize: 15 }}>
                {prefs.targetRoles ? "Enregistrer →" : "Passer →"}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 2: LINKEDIN ── */}
        {step === 2 && (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em", marginBottom: 8 }}>🌐 Contacts LinkedIn</h2>
            <p style={{ color: "#64748b", fontSize: 14, marginBottom: 28 }}>Importe tes connexions pour détecter les opportunités dans ton réseau.</p>

            {/* How to export */}
            <div style={{ background: "#0a1120", border: "1px solid #1e3a5f", borderRadius: 12, padding: "16px 20px", marginBottom: 20 }}>
              <div style={{ fontSize: 12, color: "#60a5fa", fontWeight: 700, fontFamily: "'DM Mono',monospace", marginBottom: 10 }}>COMMENT EXPORTER TES CONTACTS LINKEDIN</div>
              {["Va sur linkedin.com/mypreferences/d/download-my-data", "Sélectionne uniquement \"Connections\" et clique \"Request archive\"", "LinkedIn t'envoie un email (quelques minutes)", "Télécharge le ZIP et trouve le fichier Connections.csv"].map((s, i) => (
                <div key={i} style={{ display: "flex", gap: 10, marginBottom: 6, fontSize: 13, color: "#93c5fd" }}>
                  <span style={{ fontFamily: "'DM Mono',monospace", fontWeight: 700, color: "#6366f1", flexShrink: 0 }}>{i + 1}.</span>
                  {s}
                </div>
              ))}
            </div>

            <div style={card}>
              <div
                onDrop={(e) => { e.preventDefault(); handleLinkedIn(e.dataTransfer.files[0]); }}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => !contacts.length && linkedinRef.current?.click()}
                style={{ border: `2px dashed ${contacts.length ? "#166534" : "#334155"}`, borderRadius: 12, padding: contacts.length ? "16px" : "40px 24px", textAlign: "center", cursor: contacts.length ? "default" : "pointer", background: contacts.length ? "#052e16" : "#0f172a" }}
              >
                {contacts.length ? (
                  <div style={{ textAlign: "left" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                      <span style={{ fontSize: 24 }}>✅</span>
                      <div>
                        <div style={{ color: "#86efac", fontWeight: 700 }}>{contacts.length} contacts importés</div>
                        <div style={{ color: "#64748b", fontSize: 12 }}>{[...new Set(contacts.map((c) => c.company))].length} entreprises uniques</div>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); setContacts([]); setLinkedinRaw(""); localStorage.removeItem("tj_contacts"); localStorage.removeItem("tj_linkedin_raw"); }}
                        style={{ marginLeft: "auto", background: "transparent", border: "1px solid #334155", color: "#64748b", padding: "3px 10px", borderRadius: 6, fontSize: 11, cursor: "pointer" }}>
                        × Réinitialiser
                      </button>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 120, overflow: "hidden" }}>
                      {[...new Set(contacts.map((c) => c.company))].slice(0, 20).map((co) => (
                        <span key={co} style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, background: "#0f172a", border: "1px solid #1e293b", borderRadius: 6, padding: "2px 8px", color: "#64748b" }}>{co}</span>
                      ))}
                      {[...new Set(contacts.map((c) => c.company))].length > 20 && (
                        <span style={{ fontSize: 11, color: "#475569" }}>+{[...new Set(contacts.map((c) => c.company))].length - 20} autres…</span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
                    <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Dépose ton Connections.csv ici</div>
                    <div style={{ color: "#475569", fontSize: 13 }}>ou clique pour sélectionner</div>
                  </div>
                )}
              </div>
              <input ref={linkedinRef} type="file" accept=".csv" style={{ display: "none" }} onChange={(e) => handleLinkedIn(e.target.files[0])} />
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 24 }}>
              <button onClick={() => setStep(1)} className="sw-btn" style={{ background: "transparent", border: "1px solid #334155", color: "#94a3b8", padding: "12px 24px", borderRadius: 10, fontFamily: "'Sora',sans-serif", fontWeight: 600 }}>← Retour</button>
              <button onClick={() => setStep(3)} className="sw-btn"
                style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)", border: "none", color: "white", padding: "12px 32px", borderRadius: 10, fontFamily: "'Sora',sans-serif", fontWeight: 700, fontSize: 15 }}>
                {contacts.length ? "Continuer →" : "Passer →"}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3: INTERVIEW ── */}
        {step === 3 && (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em", marginBottom: 8 }}>🧠 Historique de carrière</h2>
            <p style={{ color: "#64748b", fontSize: 14, marginBottom: 16 }}>
              Un entretien conversationnel avec l'IA pour créer un profil détaillé de ton parcours. Utilisé pour personnaliser les CVs et lettres.
            </p>

            {profileSaved && (
              <div style={{ background: "#052e16", border: "1px solid #166534", borderRadius: 10, padding: "10px 16px", marginBottom: 16, fontSize: 13, color: "#86efac" }}>
                ✅ Profil de carrière enregistré
              </div>
            )}

            {/* Chat interface */}
            <div style={{ ...card, padding: 0, overflow: "hidden" }}>
              {/* Messages */}
              <div style={{ height: 380, overflowY: "auto", padding: "20px" }}>
                {messages.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "60px 20px", color: "#334155" }}>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>🤖</div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: "#475569", marginBottom: 8 }}>Interview de carrière IA</div>
                    <div style={{ fontSize: 13, color: "#334155", marginBottom: 20 }}>
                      {!cv ? "Upload ton CV à l'étape 1 d'abord." : !geminiKey ? "Configure ta clé Gemini dans le job board." : "L'IA va te poser des questions sur tes expériences pour créer un profil détaillé."}
                    </div>
                    {cv && geminiKey && (
                      <button onClick={startInterview} className="sw-btn"
                        style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)", border: "none", color: "white", padding: "12px 28px", borderRadius: 10, fontFamily: "'Sora',sans-serif", fontWeight: 700, fontSize: 15 }}>
                        {chatLoading ? <span className="spin">⚙️</span> : "Démarrer l'entretien"}
                      </button>
                    )}
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {messages.map((msg, i) => (
                      <div key={i} className="chat-msg" style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}>
                        <div style={{
                          maxWidth: "80%", padding: "12px 16px", borderRadius: msg.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                          background: msg.role === "user" ? "linear-gradient(135deg,#6366f1,#8b5cf6)" : "#0f172a",
                          border: msg.role === "user" ? "none" : "1px solid #334155",
                          fontSize: 14, lineHeight: 1.65, color: "#e2e8f0",
                        }}>
                          {msg.content}
                        </div>
                      </div>
                    ))}
                    {chatLoading && (
                      <div style={{ display: "flex" }}>
                        <div style={{ padding: "12px 16px", borderRadius: "14px 14px 14px 4px", background: "#0f172a", border: "1px solid #334155", fontSize: 14, color: "#475569" }}>
                          <span className="spin" style={{ display: "inline-block" }}>⚙️</span>
                        </div>
                      </div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>

              {/* Input */}
              {messages.length > 0 && (
                <div style={{ borderTop: "1px solid #1e293b", padding: "16px", display: "flex", gap: 10 }}>
                  <textarea value={userInput} onChange={(e) => setUserInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                    placeholder="Réponds à la question (Entrée pour envoyer)…"
                    rows={2} style={{ flex: 1, background: "#0f172a", border: "1px solid #334155", borderRadius: 10, color: "#e2e8f0", fontSize: 14, padding: "10px 14px", resize: "none", fontFamily: "'DM Mono',monospace" }} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <button onClick={sendMessage} disabled={chatLoading || !userInput.trim()} className="sw-btn"
                      style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)", border: "none", color: "white", padding: "8px 16px", borderRadius: 8, fontFamily: "'Sora',sans-serif", fontWeight: 700, fontSize: 13, opacity: chatLoading || !userInput.trim() ? 0.5 : 1 }}>
                      ↑
                    </button>
                    {messages.length >= 4 && !profileSaved && (
                      <button onClick={forceGenProfile} disabled={chatLoading} className="sw-btn"
                        style={{ background: "#1e293b", border: "1px solid #334155", color: "#94a3b8", padding: "6px 10px", borderRadius: 8, fontSize: 10, fontFamily: "'DM Mono',monospace", fontWeight: 600 }}>
                        {chatLoading ? "…" : "Générer profil"}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 24 }}>
              <button onClick={() => setStep(2)} className="sw-btn" style={{ background: "transparent", border: "1px solid #334155", color: "#94a3b8", padding: "12px 24px", borderRadius: 10, fontFamily: "'Sora',sans-serif", fontWeight: 600 }}>← Retour</button>
              <button onClick={onDone} className="sw-btn"
                style={{ background: "linear-gradient(135deg,#22c55e,#16a34a)", border: "none", color: "white", padding: "12px 32px", borderRadius: 10, fontFamily: "'Sora',sans-serif", fontWeight: 700, fontSize: 15 }}>
                ✅ Terminer le setup
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
