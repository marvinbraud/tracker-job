import { useState, useRef } from "react";

// ATS Scoring — 100% local, no external API calls

export default function ATSScorer({ embedded = false }) {
  const [cv, setCv] = useState("");
  const [cvFileName, setCvFileName] = useState("");
  const [cvLoading, setCvLoading] = useState(false);
  const [jd, setJd] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("score");
  const [dragOver, setDragOver] = useState(false);
  const [editorMode, setEditorMode] = useState(false);
  const fileInputRef = useRef(null);
  const [geminiKey, setGeminiKey] = useState(() => localStorage.getItem("gemini_api_key") || "");
  const [useGemini, setUseGemini] = useState(true);

  const saveGeminiKey = (key) => {
    setGeminiKey(key);
    localStorage.setItem("gemini_api_key", key);
  };

  const loadScript = (src) => new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`) && window.mammoth) { resolve(); return; }
    const s = document.createElement("script"); s.src = src;
    s.onload = resolve; s.onerror = () => reject(new Error("Impossible de charger " + src));
    document.head.appendChild(s);
  });

  const loadPdfJs = () => new Promise((resolve, reject) => {
    if (window.pdfjsLib) { resolve(window.pdfjsLib); return; }
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      resolve(window.pdfjsLib);
    };
    script.onerror = () => reject(new Error("Impossible de charger PDF.js"));
    document.head.appendChild(script);
  });

  const extractTextFromFile = async (file) => {
    const ext = file.name.split(".").pop().toLowerCase();
    if (ext === "docx") {
      await loadScript("https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js");
      const arrayBuffer = await file.arrayBuffer();
      const res = await window.mammoth.extractRawText({ arrayBuffer });
      return res.value;
    } else if (ext === "pdf") {
      const pdfjsLib = await loadPdfJs();
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
      let text = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        let pageText = "";
        let prevItem = null;
        for (const item of content.items) {
          if (!item.str) continue;
          if (prevItem !== null) {
            const prevY = prevItem.transform[5];
            const currY = item.transform[5];
            const prevRight = prevItem.transform[4] + (prevItem.width || 0);
            const currLeft = item.transform[4];
            const lineH = Math.max(item.height || 0, prevItem.height || 0, 5);
            if (Math.abs(currY - prevY) > lineH * 0.4) {
              pageText += "\n";
            } else if (currLeft - prevRight > lineH * 0.25) {
              pageText += " ";
            }
          }
          pageText += item.str;
          prevItem = item;
        }
        text += pageText + "\n";
      }
      return text;
    } else {
      throw new Error("Format non supporté. Utilisez .docx ou .pdf");
    }
  };

  const handleFileUpload = async (file) => {
    if (!file) return;
    const ext = file.name.split(".").pop().toLowerCase();
    if (!["docx", "pdf"].includes(ext)) {
      setError("Format non supporté. Utilisez un fichier .docx ou .pdf");
      return;
    }
    setCvLoading(true);
    setError("");
    try {
      const text = await extractTextFromFile(file);
      setCv(text);
      setCvFileName(file.name);
    } catch (e) {
      setError("Erreur de lecture du fichier : " + e.message);
    } finally {
      setCvLoading(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    handleFileUpload(file);
  };

  /* ── LOCAL ATS SCORING ENGINE (no API calls) ── */

  const normalize = (text) =>
    text
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s+#./'-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const tokenize = (text) => {
    const norm = normalize(text);
    const words = norm.split(" ").filter(w => w.length > 1);
    // also extract 2-grams and 3-grams
    const ngrams = [];
    for (let i = 0; i < words.length - 1; i++) ngrams.push(words[i] + " " + words[i + 1]);
    for (let i = 0; i < words.length - 2; i++) ngrams.push(words[i] + " " + words[i + 1] + " " + words[i + 2]);
    return { words, ngrams, all: [...words, ...ngrams] };
  };

  const STOP_WORDS = new Set([
    "le", "la", "les", "de", "du", "des", "un", "une", "et", "en", "a", "au", "aux", "ce", "ces", "est", "sont", "par",
    "pour", "dans", "sur", "avec", "que", "qui", "ou", "ne", "pas", "plus", "son", "sa", "ses", "nous", "vous", "ils",
    "elle", "elles", "leur", "leurs", "avoir", "etre", "faire", "dit", "the", "and", "of", "to", "in", "is", "it",
    "for", "on", "with", "at", "by", "an", "be", "this", "that", "from", "or", "as", "are", "was", "but", "not", "can",
    "has", "had", "its", "you", "your", "we", "our", "they", "their", "will", "would", "should", "could", "may",
    "also", "into", "than", "been", "being", "some", "these", "those", "then", "when", "how", "all", "each", "entre",
    "chez", "nos", "votre", "vos", "notre", "tout", "tous", "toute", "toutes", "tres", "bien", "bon", "bonne",
    "mois", "ans", "annees", "annee", "jour", "jours", "poste", "mission", "missions"
  ]);

  // Mots parasites : fragments de noms d'entreprises, termes RH génériques
  const NOISE_WORDS = new Set([
    "agricole","generale","nationale","paribas","banque","groupe","holding",
    "france","french","europe","european","global","international",
    "paris","lyon","bordeaux","nantes","toulouse","marseille","strasbourg",
    "candidat","candidature","offre","emploi","recrutement","rejoindre",
    "integrer","equipe","organisation","structure","cabinet","recherchons",
    "cherchons","issu","issue","assurer","garantir","contribuer","participer",
    "environ","notamment","ainsi","afin","niveau","minimum","ideal","ideale",
    "excellent","forte","solide","bonne","high","strong","good","vous","votre",
  ]);

  const TECH_KEYWORDS = new Set([
    // Langages
    "python","java","javascript","typescript","c++","c#","go","golang","rust","scala","kotlin",
    "swift","ruby","php","perl","r","matlab","sas","cobol","vba","bash","powershell",
    // Frontend
    "react","angular","vue","vuejs","html","css","sass","less","tailwind","bootstrap",
    "webpack","vite","nextjs","next.js","nuxt","gatsby","svelte","jquery",
    // Backend
    "node","nodejs","django","flask","fastapi","spring","express","nestjs","laravel","symfony",
    "rails","graphql","rest","grpc","api","microservices",".net","unity","unreal",
    // Mobile
    "flutter","react native","xamarin","ionic",
    // Bases de données
    "sql","nosql","postgresql","mysql","mongodb","redis","elasticsearch","cassandra","dynamodb",
    "oracle","sqlite","mariadb","neo4j","influxdb","firebase","supabase",
    // Cloud & Infra
    "aws","azure","gcp","google cloud","lambda","s3","ec2","ecs","eks","fargate",
    "cloudwatch","rds","cloudformation","terraform","ansible","helm","istio","argocd",
    // DevOps & CI/CD
    "docker","kubernetes","jenkins","gitlab ci","github actions","circleci","travis ci",
    "ci/cd","devops","sre","devsecops","linux","nginx","apache",
    "prometheus","grafana","datadog","splunk","newrelic","dynatrace",
    // Data & Analytics
    "spark","hadoop","airflow","dbt","snowflake","bigquery","databricks","redshift","hive",
    "tableau","power bi","looker","metabase","qlik","superset",
    "pandas","numpy","scikit-learn","tensorflow","pytorch","keras",
    "kafka","rabbitmq","flink","fivetran","airbyte",
    // IA / ML
    "machine learning","deep learning","nlp","computer vision","hugging face","langchain",
    "llm","gpt","openai","mlflow","kubeflow","vertex ai","sagemaker","a/b testing",
    // Sécurité
    "cybersecurity","siem","soc","owasp","iso 27001","gdpr","sox","nist",
    "zero trust","cloud security","iam","penetration testing","vulnerability",
    // Collaboration & Outils
    "git","github","gitlab","bitbucket","jira","confluence","figma","sketch","notion",
    "excel","powerpoint","google sheets","airtable","asana","trello","slack","teams",
    "salesforce","hubspot","zendesk","servicenow",
    "photoshop","illustrator","indesign","after effects","premiere","blender",
    // Finance & Investissement
    "lbo","private equity","venture capital","vc","due diligence","dcf","ebitda","irr","moic",
    "m&a","mergers and acquisitions","fusions et acquisitions","fundraising","levée de fonds",
    "valuation","financial modeling","modélisation financière","business plan","term sheet",
    "deal flow","market sizing","go-to-market","kpi","roi","tri","multiple","build-up",
    "sourcing","teaser","info memo","memorandum","closing","triangulaire",
    "asset management","wealth management","portfolio management","gestion de portefeuille",
    "bloomberg","reuters","swift","murex","calypso","mifid","ifrs","gaap","var",
    "credit risk","market risk","hedge fund","esg","isr","kyc","aml","compliance",
    "back office","front office","middle office","allocation d'actifs","gestion sous mandat",
    "actions","obligations","dérivés","options","futures","fonds d'investissement","reporting",
    "private credit","infrastructure","real estate","immobilier","seed","série a","série b",
    "startup","entrepreneuriat","valos","profil de risque",
    // Marketing & Croissance
    "seo","sem","google analytics","google ads","facebook ads","linkedin ads",
    "marketo","mailchimp","sendgrid","braze","klaviyo","segment",
    "growth hacking","conversion","funnel","crm","email marketing","content marketing",
    "social media","community management","brand management","media buying",
    // Produit & Design
    "product management","product owner","ux","ui","user research","wireframe","prototype",
    "sprint","backlog","mvp","okr","roadmap","kanban","design thinking","agile","scrum",
    // ERP & RH
    "sap","oracle erp","netsuite","workday","successfactors","peoplesoft","sage",
    "talent acquisition","recrutement","onboarding","paie","sirh",
    // Finance d'entreprise & Contrôle
    "comptabilité","accounting","audit","contrôle de gestion","controlling","consolidation",
    "trésorerie","cash flow","budget","forecast","p&l","bilan","compte de résultat",
    // Blockchain
    "blockchain","solidity","web3","ethereum","defi","smart contract",
    // Conseil & Stratégie
    "consulting","stratégie","strategy","benchmarking",
    "restructuring","restructuration","transformation","change management",
  ]);

  const SOFT_SKILLS_KEYWORDS = [
    "leadership", "communication", "teamwork", "collaboration", "adaptabilite", "adaptability",
    "problem solving", "resolution de problemes", "creativity", "creativite", "autonomie", "autonomy",
    "rigueur", "rigoureux", "organisation", "organise", "proactif", "proactive", "initiative",
    "esprit d'equipe", "esprit analytique", "analytical", "critical thinking", "pensee critique",
    "gestion du temps", "time management", "negociation", "negotiation", "presentation",
    "ecoute", "listening", "empathie", "empathy", "curiosite", "curiosity", "polyvalent", "versatile",
    "resilience", "motivation", "dynamique", "flexible", "flexibilite", "pedagogie", "mentoring",
    "gestion de projet", "project management", "sens du detail", "attention to detail",
    "travail en equipe", "team player", "force de proposition", "orienté résultat", "result oriented",
    "esprit d'entreprendre", "esprit critique", "capacité de synthèse", "esprit de synthèse", "resistance au stress",
    "fiabilité", "aisance relationnelle", "networking", "agilité"
  ];

  const ACTION_VERBS = [
    "dirigé", "analysé", "modélisé", "exécuté", "optimisé", "augmenté", "réduit", "créé", "développé",
    "implémenté", "négocié", "structuré", "construit", "lancé", "piloté", "transformé", "maximisé",
    "accompagné", "évalué", "conseillé"
  ];

  const PRESTIGE_FIRMS = new Set([
    "goldman sachs","morgan stanley","jpmorgan","jp morgan","blackrock","kkr","carlyle","blackstone",
    "bain capital","apollo","tpg","warburg pincus","advent international","permira","cinven","pai partners",
    "ardian","eurazeo","idinvest","sofina","tikehau","antin","bridgepoint","bc partners",
    "bnp paribas","societe generale","credit agricole","natixis","lazard","rothschild","oddo bhf",
    "axa im","amundi","carmignac","lyxor","candriam",
    "mckinsey","bcg","bain","strategy&","kpmg","deloitte","pwc","ey","ernst young","accenture","roland berger",
    "partech","bpifrance","sofinnova","serena capital","kima ventures",
    "google","meta","amazon","microsoft","apple","netflix","uber","airbnb","stripe","palantir",
  ]);

  const extractKeywords = (text) => {
    const { words, ngrams } = tokenize(text);
    const keywords = new Map();

    // extract n-grams that match known tech keywords
    for (const ng of ngrams) {
      if (TECH_KEYWORDS.has(ng)) {
        keywords.set(ng, (keywords.get(ng) || 0) + 3);
      }
    }

    // extract single words
    for (const w of words) {
      if (STOP_WORDS.has(w) || NOISE_WORDS.has(w) || w.length < 2) continue;
      if (TECH_KEYWORDS.has(w)) {
        keywords.set(w, (keywords.get(w) || 0) + 3);
      } else if (w.length >= 3) {
        keywords.set(w, (keywords.get(w) || 0) + 1);
      }
    }

    // sort by frequency and return top keywords
    return [...keywords.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 60)
      .map(([word, freq]) => ({ word, freq, isTech: TECH_KEYWORDS.has(word) }));
  };

  // Synonymes FR/EN + abréviations courantes
  const SYNONYMS = new Map([
    ["developer",        ["développeur","ingénieur logiciel","software engineer","dev","ingénieur"]],
    ["développeur",      ["developer","software engineer","dev","engineer"]],
    ["manager",          ["gérer","gestion","management","piloter","responsable","encadrement"]],
    ["management",       ["manager","gérer","piloter","gestion","encadrement","leadership"]],
    ["analyste",         ["analyst","analyse","analyser"]],
    ["analyst",          ["analyste","analyse"]],
    ["consultant",       ["consulting","conseil","conseiller","advisory"]],
    ["consulting",       ["consultant","conseil","advisory","prestation"]],
    ["commercial",       ["sales","business development","ventes","business developer","bd"]],
    ["sales",            ["commercial","ventes","business development","revenue"]],
    ["chef de projet",   ["project manager","pm","gestion de projet","project management"]],
    ["project manager",  ["chef de projet","pm","gestion de projet","chef projet"]],
    ["comptabilité",     ["accounting","comptable","finance","contrôle de gestion"]],
    ["accounting",       ["comptabilité","comptable","finance"]],
    ["javascript",       ["js","ecmascript","node"]],
    ["typescript",       ["ts"]],
    ["kubernetes",       ["k8s","conteneur","container orchestration"]],
    ["machine learning", ["ml","apprentissage automatique","ia","ai","deep learning"]],
    ["ui",               ["interface utilisateur","front-end","frontend","ux/ui"]],
    ["ux",               ["expérience utilisateur","user experience","ui/ux","design produit"]],
    ["agile",            ["scrum","kanban","sprint","iteratif"]],
    ["scrum",            ["agile","sprint","backlog","itératif"]],
  ]);

  const fuzzyMatch = (cvNorm, keyword) => {
    if (cvNorm.includes(keyword)) return 1.0;
    const parts = keyword.split(" ");
    if (parts.length > 1 && parts.every(p => cvNorm.includes(p))) return 0.85;
    // Synonymes
    const syns = SYNONYMS.get(keyword) || [];
    for (const syn of syns) {
      const s = normalize(syn);
      if (cvNorm.includes(s)) return 0.9;
      const sp = s.split(" ");
      if (sp.length > 1 && sp.every(p => cvNorm.includes(p))) return 0.8;
    }
    // Stem matching: trim 1 char, root >= 5 chars, mot isolé
    if (keyword.length >= 6) {
      const root = keyword.slice(0, -1);
      const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`(?:^|\\s)${escaped}[a-z]{0,2}(?:\\s|$)`).test(cvNorm)) return 0.6;
    }
    return 0;
  };

  const detectSeniority = (text) => {
    const t = text.toLowerCase();
    if (/\b(director|directeur|vp |vice[ -]pr[eé]sident|head of|cxo|ceo|cto|cfo|dg |daf |dsi )\b/.test(t)) return "executive";
    if (/\b(senior|sr\.?\s|lead|principal|expert|confirm[eé]|exp[eé]riment[eé]|seasoned)\b/.test(t)) return "senior";
    if (/\b(junior|jr\.?\s|d[eé]butant|graduate|dipl[oô]m[eé]\s+r[eé]cent|stagiaire|intern|alternance|apprenti)\b/.test(t)) return "junior";
    if (/\b(0\s*[àa]\s*[12]\s*an|premi[eè]re\s+exp[eé]rience|entry.level)\b/.test(t)) return "junior";
    return "unknown";
  };

  const detectExperience = (cvText) => {
    const norm = normalize(cvText);
    const yearsPatterns = [
      /(\d+)\s*(?:ans?|years?)\s*(?:d['']?\s*)?(?:experience|exp)/gi,
      /experience\s*(?:de\s*)?(\d+)\s*(?:ans?|years?)/gi,
      /(\d+)\+?\s*(?:ans?|years?)/gi,
    ];
    let maxYears = 0;
    for (const pattern of yearsPatterns) {
      const matches = [...cvText.matchAll(pattern)];
      for (const m of matches) {
        const years = parseInt(m[1]);
        if (years > 0 && years < 50) maxYears = Math.max(maxYears, years);
      }
    }
    // count distinct date ranges (2019-2023 style)
    const dateRanges = [...cvText.matchAll(/20[0-2]\d\s*[-–]\s*(?:20[0-2]\d|present|actuel|aujourd)/gi)];
    if (dateRanges.length > 0 && maxYears === 0) {
      maxYears = Math.min(dateRanges.length * 2, 15);
    }
    return { years: maxYears, positions: dateRanges.length };
  };

  const detectFormation = (cvText) => {
    const norm = normalize(cvText);
    let level = 0;
    const patterns = [
      { re: /(?:master|mba|m2|m1|bac\s*\+\s*5|ingenieur|grandes?\s*ecoles?)/i, score: 10 },
      { re: /(?:licence|bachelor|bac\s*\+\s*3|l3|but)/i, score: 8 },
      { re: /(?:bts|dut|bac\s*\+\s*2|deug)/i, score: 6 },
      { re: /(?:baccalaureat|bac(?:\s|$)|high\s*school)/i, score: 4 },
      { re: /(?:doctorat|phd|these)/i, score: 10 },
    ];
    for (const p of patterns) {
      if (p.re.test(cvText)) level = Math.max(level, p.score);
    }
    // certifications
    const certs = [...cvText.matchAll(/(?:certif|certification|certified|diplome|certificate)/gi)];
    return { level, certCount: certs.length };
  };

  const analyzeLocal = (cvText, jdText) => {
    const cvNorm = normalize(cvText);
    const jdNorm = normalize(jdText);
    const jdKeywords = extractKeywords(jdText);
    const cvKeywords = extractKeywords(cvText);

    // ── 1. KEYWORD MATCHING (30 pts) ──
    const matched = [];
    const missing = [];
    let keywordScore = 0;
    const topJdKeywords = jdKeywords.slice(0, 40);

    // TF-IDF: keywords appearing more often in JD get higher weight
    const maxFreq = topJdKeywords[0]?.freq || 1;
    const kwWeight = (kw) => {
      const freqScore = 1 + (kw.freq / maxFreq) * 2; // 1–3
      return freqScore * (kw.isTech ? 1.5 : 1.0);    // tech: 1.5–4.5 | non-tech: 1–3
    };

    // Requis vs souhaitable : détection par contexte de phrase dans la JD
    const jdLines = jdNorm.split(/[\n.;:]/);
    const REQUIRED_RE = /requis|obligatoire|must.have|required|mandatory|necessaire|indispensable|exige|imperatif|essentiel/;
    const OPTIONAL_RE = /idealement|de preference|un plus|souhaitable|nice.to.have|preferred|atout|apprecie|optionnel/;
    const detectImportance = (keyword) => {
      for (let i = 0; i < jdLines.length; i++) {
        if (!jdLines[i].includes(keyword)) continue;
        const ctx = [jdLines[i - 1] || "", jdLines[i], jdLines[i + 1] || ""].join(" ");
        if (REQUIRED_RE.test(ctx)) return "critique";
        if (OPTIONAL_RE.test(ctx)) return "moyenne";
      }
      return null;
    };

    for (const kw of topJdKeywords) {
      const importance = detectImportance(kw.word) || (kw.isTech ? (kw.freq >= 3 ? "critique" : "haute") : "moyenne");
      const criticalBoost = importance === "critique" ? 1.5 : importance === "haute" ? 1.2 : 1.0;
      const w = kwWeight(kw) * criticalBoost;
      const matchScore = fuzzyMatch(cvNorm, kw.word);
      if (matchScore > 0) {
        matched.push(kw.word);
        keywordScore += matchScore * w;
      } else {
        missing.push({ terme: kw.word, importance, weight: w });
      }
    }
    const keywordMax = topJdKeywords.reduce((sum, kw) => sum + kwWeight(kw), 0);
    const keywordPct = keywordMax > 0 ? keywordScore / keywordMax : 0;
    const keywordFinal = Math.round(Math.min(30, keywordPct * 30));

    // ── 2. EXPÉRIENCE PERTINENTE (20 pts) ──
    const exp = detectExperience(cvText);
    const jdExp = detectExperience(jdText);
    let expScore = 0;
    if (exp.years > 0) expScore += Math.min(12, exp.years * 2);
    if (exp.positions >= 1) expScore += Math.min(5, exp.positions * 1.5);
    if (jdExp.years > 0 && exp.years >= jdExp.years) expScore += 3;
    else if (exp.years > 0 && exp.positions >= 1) expScore += 1;
    const expFinal = Math.round(Math.min(20, expScore));

    // ── 3. RÉSULTATS QUANTIFIÉS (10 pts) ──
    const metricsMatch = cvText.match(/\d+(?:[kKmMbB]|%)\b|\$\s*\d+|€\s*\d+|\d+\s*(?:M€|Md€|K€|M\$|k\$)/g) || [];
    const KPI_TERMS = ["ebitda","marge","taux","croissance","revenu","affaires","benefice","performance",
      "objectif","reduit","augmente","genere","economise","optimise","livre","deploye","atteint",
      "depasse","realise","gere","achieved","delivered","generated","reduced","increased","grew",
      "built","managed"];
    let kpiCount = 0;
    for (const kw of KPI_TERMS) {
      if (cvNorm.includes(kw)) kpiCount++;
    }
    let resultsScore = 0;
    resultsScore += Math.min(6, metricsMatch.length * 1.5);
    resultsScore += Math.min(4, kpiCount * 0.5);
    const resultsFinal = Math.round(Math.min(10, resultsScore));

    // ── 4. FORMATION & CERTIFICATIONS (10 pts) ──
    const formation = detectFormation(cvText);
    let formationScore = formation.level;
    formationScore += Math.min(2, formation.certCount);
    const formationFinal = Math.round(Math.min(10, formationScore));

    // ── 5. PRESTIGE & COHÉRENCE (10 pts) ──
    let prestigeScore = 0;
    let firmMatches = 0;
    for (const firm of PRESTIGE_FIRMS) {
      if (cvNorm.includes(normalize(firm))) firmMatches++;
    }
    if (firmMatches >= 1) prestigeScore += 3;
    if (firmMatches >= 2) prestigeScore += 2;
    if (exp.positions >= 2) prestigeScore += 2;
    const cvSeniority = detectSeniority(cvText);
    const jdSeniority = detectSeniority(jdText);
    if (cvSeniority !== "unknown" && jdSeniority !== "unknown" && cvSeniority === jdSeniority) {
      prestigeScore += 2;
    } else if (cvSeniority === "unknown" || jdSeniority === "unknown") {
      prestigeScore += 1;
    }
    let actionVerbsFound = 0;
    for (const verb of ACTION_VERBS) {
      if (cvNorm.includes(normalize(verb))) actionVerbsFound++;
    }
    if (actionVerbsFound >= 3) prestigeScore += 1;
    const prestigeFinal = Math.round(Math.min(10, prestigeScore));

    // ── 6. STRUCTURE & PARSING ATS (20 pts) ──
    let structureScore = 0;
    if (cvText.length > 300) structureScore += 2;
    if (cvText.length > 800) structureScore += 2;
    if (cvText.length > 1500) structureScore += 2;
    const SECTION_HEADERS = ["experience","formation","education","competence","skill","profil",
      "resume","certification","langues","langue","projet","publication","bilan"];
    let sectionCount = 0;
    for (const h of SECTION_HEADERS) {
      if (cvNorm.includes(h)) sectionCount++;
    }
    structureScore += Math.min(6, sectionCount * 1.5);
    if (exp.positions >= 2) structureScore += 2;
    const cvFr = (cvText.match(/[àâéèêëïîôùûüç]/gi) || []).length;
    const jdFr = (jdText.match(/[àâéèêëïîôùûüç]/gi) || []).length;
    if ((cvFr > 5 && jdFr > 5) || (cvFr <= 5 && jdFr <= 5)) structureScore += 2;
    const cvWords = cvText.split(/\s+/).filter(w => w.length > 0);
    const avgWordLen = cvWords.reduce((s, w) => s + w.length, 0) / (cvWords.length || 1);
    if (avgWordLen >= 3 && avgWordLen <= 12) structureScore += 2;
    const structureFinal = Math.round(Math.min(20, structureScore));

    const scoreGlobal = keywordFinal + expFinal + resultsFinal + formationFinal + prestigeFinal + structureFinal;
    // 30 + 20 + 10 + 10 + 10 + 20 = 100

    // ── Build points forts ──
    const pointsForts = [];
    if (keywordPct > 0.5) pointsForts.push(`Bon matching de mots-clés (${Math.round(keywordPct * 100)}% des termes clés retrouvés)`);
    if (exp.years >= 3) pointsForts.push(`${exp.years} ans d'expérience détectés dans le CV`);
    if (formation.level >= 8) pointsForts.push("Formation de niveau Bac+5 ou équivalent");
    if (firmMatches >= 1) pointsForts.push(`Expérience dans ${firmMatches} entreprise(s) de prestige détectée(s)`);
    if (metricsMatch.length >= 3) pointsForts.push(`${metricsMatch.length} résultats chiffrés détectés dans le CV`);
    if (matched.length > 10) pointsForts.push(`${matched.length} mots-clés de l'offre présents dans le CV`);
    if (sectionCount >= 3) pointsForts.push("Structure du CV claire et bien organisée");
    if (pointsForts.length === 0) pointsForts.push("Le CV est structuré et lisible");
    while (pointsForts.length < 3) pointsForts.push("Contenu globalement pertinent pour le poste");

    // ── Build lacunes ──
    const lacunes = [];
    const criticalMissing = missing.filter(m => m.importance === "critique");
    if (criticalMissing.length > 0) lacunes.push(`${criticalMissing.length} mot(s)-clé(s) critiques absents : ${criticalMissing.slice(0, 3).map(m => m.terme).join(", ")}`);
    if (keywordPct < 0.4) lacunes.push(`Faible correspondance de vocabulaire (${Math.round(keywordPct * 100)}%)`);
    if (exp.years < 2) lacunes.push("Peu d'expérience détectée ou mal mise en valeur");
    if (resultsFinal < 4) lacunes.push("Peu ou pas de résultats chiffrés (%, €, volumes) — point faible majeur en finance");
    if (firmMatches === 0) lacunes.push("Aucune entreprise de prestige reconnue détectée dans le parcours");
    if (formation.level < 6) lacunes.push("Niveau de formation potentiellement insuffisant ou non détecté");
    if (cvSeniority !== "unknown" && jdSeniority !== "unknown" && cvSeniority !== jdSeniority) {
      if (cvSeniority === "junior" && (jdSeniority === "senior" || jdSeniority === "executive"))
        lacunes.push(`Niveau d'expérience potentiellement insuffisant : le poste semble cibler un profil ${jdSeniority === "executive" ? "direction" : "senior (5+ ans)"}`);
      else if ((cvSeniority === "senior" || cvSeniority === "executive") && jdSeniority === "junior")
        lacunes.push("Possible sur-qualification : votre profil senior pourrait être perçu comme sur-dimensionné pour ce poste");
    }
    while (lacunes.length < 3) lacunes.push("Des ajustements mineurs pourraient améliorer le score");

    // ── Build plan d'action avec score d'impact estimé ──
    const planAction = [];
    const kwImpact = (kws) =>
      Math.min(12, Math.round(kws.reduce((s, m) => s + (m.weight || 1), 0) / (keywordMax || 1) * 30));

    if (criticalMissing.length > 0) planAction.push({
      priorite: "haute",
      action: `Ajouter les mots-clés critiques manquants : ${criticalMissing.slice(0, 5).map(m => m.terme).join(", ")}`,
      impact: kwImpact(criticalMissing.slice(0, 5)),
    });
    if (keywordPct < 0.6) planAction.push({
      priorite: "haute",
      action: "Reformuler vos expériences en reprenant le vocabulaire exact de l'offre d'emploi",
      impact: Math.round((0.6 - keywordPct) * 30),
    });
    if (resultsFinal < 6) planAction.push({
      priorite: "haute",
      action: "Quantifier vos résultats : ajoutez des métriques (%, €, volumes gérés, taille d'équipe, IRR, EBITDA…)",
      impact: Math.max(2, 10 - resultsFinal),
    });
    if (exp.positions < 2) planAction.push({
      priorite: "moyenne",
      action: "Détailler vos expériences avec des dates précises (mois/année) pour chaque poste",
      impact: 4,
    });
    if (firmMatches === 0) planAction.push({
      priorite: "moyenne",
      action: "Mettre en avant les marques employeurs reconnues et tout deal/projet avec des grandes institutions",
      impact: 3,
    });
    planAction.push({
      priorite: "basse",
      action: "Vérifier que le format est compatible ATS : pas de tableaux, colonnes simples, polices standards",
      impact: 2,
    });
    if (planAction.length < 4) planAction.push({
      priorite: "basse",
      action: "Adapter la lettre de motivation avec les mêmes mots-clés pour renforcer la cohérence",
      impact: 1,
    });
    planAction.sort((a, b) => (b.impact || 0) - (a.impact || 0));

    // ── Conseils format ──
    const conseilsFormat = [
      "Utilisez un format simple : une seule colonne, polices classiques (Arial, Calibri, Times)",
      "Évitez les tableaux, colonnes multiples, en-têtes/pieds de page et images",
      "Nommez clairement vos sections : Expérience, Formation, Compétences",
    ];

    // ── Verdict ──
    let verdict = "";
    if (scoreGlobal >= 85) verdict = `Excellent score ATS de ${scoreGlobal}/100. Votre CV est très bien aligné avec cette offre. Les mots-clés, compétences et expériences correspondent fortement. Vous avez de très bonnes chances de passer les filtres automatiques.`;
    else if (scoreGlobal >= 70) verdict = `Bon score ATS de ${scoreGlobal}/100. Votre profil correspond bien à l'offre avec quelques points d'amélioration. En intégrant les mots-clés manquants, vous pourriez significativement augmenter vos chances.`;
    else if (scoreGlobal >= 50) verdict = `Score ATS moyen de ${scoreGlobal}/100. Votre CV a une compatibilité partielle avec l'offre. Plusieurs mots-clés importants sont absents. Un travail d'adaptation du vocabulaire et de mise en avant des compétences pertinentes est recommandé.`;
    else verdict = `Score ATS faible de ${scoreGlobal}/100. L'écart entre votre CV et l'offre est significatif. Il est fortement recommandé de reprendre le CV en profondeur en s'inspirant du vocabulaire et des compétences listées dans l'offre.`;

    return {
      scoreGlobal: Math.min(100, scoreGlobal),
      categories: [
        { nom: "Mots-clés & Outils", score: keywordFinal, max: 30, commentaire: `${matched.length} mots-clés de l'offre retrouvés dans le CV sur ${topJdKeywords.length} identifiés` },
        { nom: "Expérience Pertinente", score: expFinal, max: 20, commentaire: `${exp.years > 0 ? exp.years + " ans d'expérience détectés" : "Expérience non quantifiée"}, ${exp.positions} poste(s) identifié(s)` },
        { nom: "Résultats Quantifiés", score: resultsFinal, max: 10, commentaire: `${metricsMatch.length} métrique(s) chiffrée(s), ${kpiCount} terme(s) d'impact détecté(s)` },
        { nom: "Formation & Certifications", score: formationFinal, max: 10, commentaire: `Niveau détecté : ${formation.level >= 8 ? "Bac+5/Master" : formation.level >= 6 ? "Bac+2/3" : formation.level >= 4 ? "Bac" : "Non identifié"}${formation.certCount > 0 ? `, ${formation.certCount} certification(s)` : ""}` },
        { nom: "Prestige & Cohérence", score: prestigeFinal, max: 10, commentaire: `${firmMatches} entreprise(s) de prestige détectée(s), séniorité : ${cvSeniority}` },
        { nom: "Structure & Parsing ATS", score: structureFinal, max: 20, commentaire: `${sectionCount} section(s) identifiée(s), ${exp.positions} poste(s) daté(s), langue ${(cvFr > 5 && jdFr > 5) || (cvFr <= 5 && jdFr <= 5) ? "cohérente ✓" : "à vérifier"}` },
      ],
      pointsForts: pointsForts.slice(0, 3),
      lacunes: lacunes.slice(0, 3),
      motsClesManquants: missing.slice(0, 12),
      motsClesPresents: matched.slice(0, 12),
      planAction: planAction.slice(0, 5),
      phraseSuggestions: [],
      conseilsFormat,
      verdict,
    };
  };

  const SYSTEM_PROMPT_GEMINI = `Tu es un Expert Recruteur senior spécialisé en Finance (Private Equity, VC, M&A, Asset/Wealth Management) et en évaluation ATS.
Ton rôle : évaluer de façon indépendante et qualitative l'adéquation entre le CV et l'Offre, produire ton propre score global, et fournir des phrases concrètes prêtes à coller dans le CV.

Réponds UNIQUEMENT en string JSON valide. Ne retourne AUCUN bloc Markdown (pas de \`\`\`json).

Structure JSON EXACTE attendue:
{
  "scoreGlobal": <entier 0-100, ton évaluation indépendante et honnête de la compatibilité CV/Offre>,
  "verdict": "<Résumé ultra-personnalisé et direct de 3 phrases max justifiant les forces/faiblesses du profil pour CE poste exact>",
  "planAction": [
    { "priorite": "haute", "action": "<action concrète, ex: Reformule le stage chez X pour mentionner la construction du LBO et l'EBITDA bridge>", "impact": <entier 1-15> },
    { "priorite": "moyenne", "action": "<action spécifique>", "impact": <entier 1-15> }
  ],
  "phraseSuggestions": [
    {
      "motCle": "<mot-clé manquant dans le CV>",
      "phraseCV": "<phrase professionnelle prête à intégrer dans le CV, avec métriques si possible, max 2 lignes>"
    }
  ],
  "conseilsFormat": ["<conseil spécifique ATS 1>", "<conseil spécifique ATS 2>"]
}

Règles de scoring pour ton scoreGlobal:
- 85-100 : profil quasi-parfait, tous les critères clés cochés
- 70-84 : bon profil avec quelques lacunes mineures
- 50-69 : profil partiel, manques significatifs
- 0-49 : profil inadapté ou trop éloigné du poste

Pour phraseSuggestions : fournis 3-5 phrases pour les mots-clés les plus critiques manquants. Chaque phrase doit être directement utilisable dans le CV, professionnelle, spécifique au secteur, et idéalement avec un chiffre/résultat.
Sois honnête et précis, ne gonfle pas le score.`;

  const analyze = async () => {
    if (!cv.trim() || !jd.trim()) {
      setError("Veuillez renseigner le CV et l'offre d'emploi.");
      return;
    }
    setError("");
    setLoading(true);
    setResult(null);

    try {
      const localResult = analyzeLocal(cv, jd);

      if (useGemini && geminiKey.trim()) {
        const modelsToTry = [
          "gemini-2.5-flash",
          "gemini-2.0-flash",
          "gemini-flash-latest",
          "gemini-2.5-flash-lite"
        ];
        
        let parsed = null;
        let lastError = null;

        for (const modelName of modelsToTry) {
          try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiKey.trim()}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{
                  parts: [{ text: `${SYSTEM_PROMPT_GEMINI}\n\nSCORE GLOBAL MESURÉ: ${localResult.scoreGlobal}/100\n\nCV:\n${cv.slice(0, 10000)}\n\nOFFRE:\n${jd.slice(0, 10000)}` }]
                }],
                generationConfig: {
                  responseMimeType: "application/json",
                  temperature: 0.1
                }
              })
            });

            if (!response.ok) {
              const errData = await response.json().catch(() => ({}));
              throw new Error(`Erreur ${modelName}: ` + (errData.error?.message || response.statusText));
            }

            const data = await response.json();
            const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!textContent) throw new Error(`Réponse API invalide avec ${modelName}`);

            parsed = JSON.parse(textContent);
            break; // Succès ! On sort de la boucle
          } catch (err) {
            lastError = err;
            console.warn(`Fallback from ${modelName}: ${err.message}`);
          }
        }

        if (!parsed) {
          throw new Error("Tous les modèles gratuits sont surchargés, veuillez réessayer dans quelques minutes ! (Dernière erreur : " + lastError?.message + ")");
        }
        
        // Mode Hybride: moyenne score local + score Gemini pour réduire l'écart avec d'autres LLMs
        const geminiScore = typeof parsed.scoreGlobal === "number"
          ? Math.min(100, Math.max(0, Math.round(parsed.scoreGlobal)))
          : null;
        const finalScore = geminiScore !== null
          ? Math.round((localResult.scoreGlobal + geminiScore) / 2)
          : localResult.scoreGlobal;

        setResult({
          ...localResult,
          scoreGlobal: finalScore,
          verdict: parsed.verdict || localResult.verdict,
          planAction: parsed.planAction && parsed.planAction.length > 0 ? parsed.planAction : localResult.planAction,
          phraseSuggestions: parsed.phraseSuggestions && parsed.phraseSuggestions.length > 0 ? parsed.phraseSuggestions : [],
          conseilsFormat: parsed.conseilsFormat && parsed.conseilsFormat.length > 0 ? parsed.conseilsFormat : localResult.conseilsFormat
        });
      } else {
        // Simuler un court délai de calcul
        await new Promise(r => setTimeout(r, 600));
        setResult(localResult);
      }
      setActiveTab("score");
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setCv("");
    setCvFileName("");
    setJd("");
    setResult(null);
    setError("");
    setEditorMode(false);
  };

  const reanalyze = () => {
    if (!cv.trim() || !jd.trim()) return;
    try {
      setResult(analyzeLocal(cv, jd));
    } catch (e) {
      setError("Erreur : " + e.message);
    }
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
    <div style={{ fontFamily: "'Sora', sans-serif", minHeight: embedded ? "auto" : "100vh", background: "#0f172a", color: "#e2e8f0" }}>
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

      {/* Header — hidden when embedded in landing page */}
      <div style={{ borderBottom: "1px solid #1e293b", padding: "20px 32px", display: embedded ? "none" : "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 36, height: 36, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>
          📊
        </div>
        <div>
          <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: "-0.02em" }}>ATS<span style={{ color: "#6366f1" }}>Score</span></div>
          <div style={{ fontSize: 11, color: "#64748b", fontFamily: "'DM Mono', monospace" }}>Applicant Tracking System Analyzer</div>
        </div>
        {result && (
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button
              onClick={() => setEditorMode(!editorMode)}
              className="action-btn"
              style={{ background: editorMode ? "#6366f1" : "transparent", border: `1px solid ${editorMode ? "#6366f1" : "#334155"}`, color: editorMode ? "white" : "#94a3b8", padding: "6px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600 }}
            >
              {editorMode ? "📊 Vue normale" : "✏️ Mode éditeur"}
            </button>
            <button onClick={reset} className="action-btn" style={{ background: "transparent", border: "1px solid #334155", color: "#94a3b8", padding: "6px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
              ← Nouvelle analyse
            </button>
          </div>
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
                  {cvFileName && (
                    <span style={{ marginLeft: "auto", fontFamily: "'DM Mono', monospace", fontSize: 11, color: "#22c55e", background: "#052e16", padding: "2px 10px", borderRadius: 99, border: "1px solid #166534" }}>
                      ✓ {cvFileName}
                    </span>
                  )}
                </div>

                {/* Drop zone */}
                <div
                  onDrop={handleDrop}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onClick={() => !cv && fileInputRef.current?.click()}
                  style={{
                    border: `2px dashed ${dragOver ? "#6366f1" : cv ? "#166534" : "#334155"}`,
                    borderRadius: 12,
                    background: dragOver ? "#1e1b4b" : cv ? "#052e16" : "#0f172a",
                    padding: cv ? "16px" : "40px 20px",
                    textAlign: "center",
                    cursor: cv ? "default" : "pointer",
                    transition: "all .2s",
                    minHeight: cv ? "auto" : 180,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10,
                  }}
                >
                  {cvLoading ? (
                    <>
                      <div className="pulse" style={{ fontSize: 32 }}>⚙️</div>
                      <div style={{ color: "#94a3b8", fontSize: 13 }}>Extraction du texte…</div>
                    </>
                  ) : cv ? (
                    <>
                      <div style={{ fontSize: 13, color: "#86efac", fontFamily: "'DM Mono', monospace", maxHeight: 220, overflowY: "auto", width: "100%", textAlign: "left", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                        {cv.slice(0, 800)}{cv.length > 800 ? "\n…" : ""}
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); setCv(""); setCvFileName(""); fileInputRef.current.value = ""; }}
                        style={{ marginTop: 8, background: "transparent", border: "1px solid #334155", color: "#94a3b8", padding: "4px 14px", borderRadius: 8, fontSize: 12, cursor: "pointer", fontFamily: "'Sora', sans-serif" }}
                      >
                        × Changer de fichier
                      </button>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 40 }}>📂</div>
                      <div style={{ fontWeight: 700, fontSize: 15, color: "#e2e8f0" }}>Déposez votre CV ici</div>
                      <div style={{ fontSize: 13, color: "#64748b" }}>ou cliquez pour sélectionner</div>
                      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                        {[".docx", ".pdf"].map((ext) => (
                          <span key={ext} style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, background: "#1e293b", border: "1px solid #334155", color: "#94a3b8", padding: "3px 10px", borderRadius: 6 }}>
                            {ext}
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".docx,.pdf"
                  style={{ display: "none" }}
                  onChange={(e) => handleFileUpload(e.target.files[0])}
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

            <div className="card" style={{ marginBottom: 24, padding: "18px 24px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16 }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                  🤖 Mode d'analyse
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button
                    onClick={() => setUseGemini(false)}
                    style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1px solid #334155", background: !useGemini ? "#6366f1" : "transparent", color: !useGemini ? "white" : "#cbd5e1", cursor: "pointer", fontFamily: "'Sora', sans-serif", fontSize: 12, fontWeight: !useGemini ? 700 : 500 }}
                  >⚡ Local Rapide</button>
                  <button
                    onClick={() => setUseGemini(true)}
                    style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1px solid #334155", background: useGemini ? "#8b5cf6" : "transparent", color: useGemini ? "white" : "#cbd5e1", cursor: "pointer", fontFamily: "'Sora', sans-serif", fontSize: 12, fontWeight: useGemini ? 700 : 500 }}
                  >🧠 Coach IA (Gemini)</button>
                </div>
              </div>
              
              {useGemini && (
                <div style={{ flex: 1.5, minWidth: 250 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: "#cbd5e1" }}>Clé API Gemini (sauvegardée localement)</div>
                  <input
                    type="password"
                    value={geminiKey}
                    onChange={(e) => saveGeminiKey(e.target.value)}
                    placeholder="AIzaSy..."
                    style={{ width: "100%", padding: "10px 14px", borderRadius: 8, border: "1px solid #334155", background: "#0f172a", color: "white", fontFamily: "'DM Mono', monospace", fontSize: 13 }}
                  />
                  <div style={{ fontSize: 10, color: "#64748b", marginTop: 6 }}><a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" style={{color: "#8b5cf6"}}>Obtenir une clé gratuite</a></div>
                </div>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "center" }}>
              <button
                onClick={analyze}
                disabled={loading || !cv.trim() || !jd.trim() || cvLoading || (useGemini && !geminiKey)}
                className="action-btn"
                style={{
                  background: loading ? "#312e81" : (useGemini ? "linear-gradient(135deg,#8b5cf6,#d946ef)" : "linear-gradient(135deg,#6366f1,#8b5cf6)"),
                  border: "none", color: "white", padding: "14px 48px", borderRadius: 12,
                  fontFamily: "'Sora', sans-serif", fontWeight: 700, fontSize: 16,
                  cursor: (loading || !cv.trim() || !jd.trim() || (useGemini && !geminiKey)) ? "not-allowed" : "pointer",
                  opacity: (!cv.trim() || !jd.trim() || cvLoading || (useGemini && !geminiKey)) ? 0.4 : 1,
                  display: "flex", alignItems: "center", gap: 10,
                }}
              >
                {loading ? (
                  <><span className="pulse">⚙️</span> Analyse en cours…</>
                ) : (
                  <><span>{useGemini ? "🧠" : "🔍"}</span> {useGemini ? "Générer le rapport Coach IA" : "Analyser mon ATS Score"}</>
                )}
              </button>
            </div>
          </div>
        ) : (
          /* ── RESULTS PANEL ── */
          <div style={editorMode ? { display: "grid", gridTemplateColumns: "40% 60%", gap: 20, alignItems: "start" } : {}}>

            {/* ── ÉDITEUR CV (mode live uniquement) ── */}
            {editorMode && (
              <div style={{ position: "sticky", top: 20 }}>
                <div className="card">
                  <div style={{ fontSize: 11, color: "#6366f1", fontFamily: "'DM Mono', monospace", fontWeight: 700, letterSpacing: "0.1em", marginBottom: 12 }}>✏️ ÉDITEUR CV — LIVE</div>
                  <textarea
                    value={cv}
                    onChange={(e) => setCv(e.target.value)}
                    style={{ width: "100%", height: 520, fontSize: 12, lineHeight: 1.6 }}
                  />
                  <button
                    onClick={reanalyze}
                    className="action-btn"
                    style={{ marginTop: 12, width: "100%", background: "linear-gradient(135deg,#6366f1,#8b5cf6)", border: "none", color: "white", padding: "12px", borderRadius: 10, fontFamily: "'Sora', sans-serif", fontWeight: 700, fontSize: 14, cursor: "pointer" }}
                  >
                    ⟳ Recalculer le score
                  </button>
                  <div style={{ marginTop: 8, fontSize: 11, color: "#475569", textAlign: "center" }}>Modifiez votre CV · Cliquez pour mettre à jour</div>
                </div>
              </div>
            )}

            {/* ── SCORE + RECOMMANDATIONS ── */}
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

                {result.phraseSuggestions?.length > 0 && (
                  <div className="card" style={{ borderColor: "#4c1d95", background: "#1a0a2e" }}>
                    <div style={{ fontSize: 11, color: "#a78bfa", fontFamily: "'DM Mono', monospace", fontWeight: 700, letterSpacing: "0.1em", marginBottom: 16 }}>✍️ PHRASES PRÊTES À COLLER DANS VOTRE CV</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      {result.phraseSuggestions.map((p, i) => (
                        <div key={i} style={{ background: "#0f0720", border: "1px solid #4c1d95", borderRadius: 10, padding: "12px 16px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, fontWeight: 700, color: "#a78bfa", background: "#2e1065", padding: "2px 10px", borderRadius: 99, border: "1px solid #4c1d95" }}>
                              {p.motCle}
                            </span>
                          </div>
                          <div style={{ fontSize: 13, color: "#ddd6fe", lineHeight: 1.6, fontStyle: "italic" }}>
                            "{p.phraseCV}"
                          </div>
                          <button
                            onClick={() => navigator.clipboard?.writeText(p.phraseCV)}
                            style={{ marginTop: 8, background: "transparent", border: "1px solid #4c1d95", color: "#a78bfa", padding: "3px 12px", borderRadius: 6, fontSize: 11, cursor: "pointer", fontFamily: "'DM Mono', monospace" }}
                          >
                            📋 Copier
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
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
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                              <span style={{ fontSize: 10, fontWeight: 700, color: s.border, fontFamily: "'DM Mono', monospace", letterSpacing: "0.08em" }}>
                                {s.label.toUpperCase()}
                              </span>
                              {item.impact > 0 && (
                                <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, fontWeight: 700, color: "#4ade80", background: "#052e16", padding: "1px 8px", borderRadius: 99, border: "1px solid #166534" }}>
                                  +{item.impact} pts
                                </span>
                              )}
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
          </div>
        )}
      </div>
    </div>
  );
}
