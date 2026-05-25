# 🚀 Lancer le site ATS Scorer

## Première fois (installation)

Ouvre le **Terminal** (Cmd + Espace → tape "Terminal" → Entrée)

```bash
cd "/Users/braudmarvin/Desktop/ATS scorer"
npm install
```

> ⏳ Attends que ça finisse (~30 secondes). À faire **une seule fois**.

---

## Lancer le site (à chaque fois)

```bash
cd "/Users/braudmarvin/Desktop/ATS scorer"
npm run dev
```

Puis ouvre ton navigateur sur → **http://localhost:5173**

Pour **arrêter** le site : dans le Terminal, appuie sur `Ctrl + C`

---

## Changer de version

Dans le fichier `src/main.jsx`, change la ligne d'import :

| Version | Ligne à mettre |
|---|---|
| **Local** (sans API, gratuit) | `import ATSScorer from "../ats-scorer-2-local.jsx";` |
| **Gemini + Local** (recommandé) | `import ATSScorer from "../ats-scorer-2.jsx";` |
| **Claude API** (Anthropic) | `import ATSScorer from "../ats-scorer.jsx";` |

---

## Résumé des 3 versions

| Fichier | Mode | Clé API requise |
|---|---|---|
| `ats-scorer-2-local.jsx` | 100% local, rapide | ❌ Aucune |
| `ats-scorer-2.jsx` | Local + analyse IA Gemini | ✅ Clé Gemini (gratuite) |
| `ats-scorer.jsx` | Analyse Claude (Anthropic) | ✅ Clé Anthropic (payante) |

> 🔑 Obtenir une clé Gemini gratuite : https://aistudio.google.com/app/apikey

---

## En cas de problème

**"command not found: npm"** → installer Node.js sur https://nodejs.org (version LTS)

**Port déjà utilisé** → changer le port dans `vite.config.js` :
```js
export default defineConfig({
  plugins: [react()],
  server: { port: 3001 }  // changer ici
});
```
Puis aller sur http://localhost:3001

**Erreur au démarrage** → relancer :
```bash
rm -rf node_modules
npm install
npm run dev
```
