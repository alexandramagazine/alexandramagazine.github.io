// Worker di pubblicazione per Alexandra Magazine.
//
// POST /post    { password, titolo, autore, testo, immagini: [{ nome, base64 }] }
//   → crea _blog/AAAA-MM-GG-titolo.md (+ immagini in assets/blog/...)
// POST /numero  { password, post: ["_blog/....md", ...] }
//   → copia i post scelti in _articoli/numeroN-articoloK.md e aggiunge il numero a _data/numeri.yml
//
// Segreti (wrangler secret put ...): GITHUB_TOKEN, PASSWORD_SCRITTURA, PASSWORD_REDAZIONE
// Variabili (wrangler.toml): REPO, BRANCH, ORIGINE

const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio",
  "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const MAX_IMMAGINI = 15;
const MAX_BYTES_IMMAGINE = 3 * 1024 * 1024;

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": env.ORIGINE,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    const risposta = (status, dati) =>
      new Response(JSON.stringify(dati), {
        status,
        headers: { ...cors, "Content-Type": "application/json" },
      });

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "POST") return risposta(405, { errore: "Metodo non permesso" });

    let dati;
    try {
      dati = await request.json();
    } catch {
      return risposta(400, { errore: "Richiesta non valida" });
    }

    const percorso = new URL(request.url).pathname;
    try {
      if (percorso === "/post") {
        if (dati.password !== env.PASSWORD_SCRITTURA) return risposta(401, { errore: "Password sbagliata" });
        return risposta(200, await pubblicaPost(env, dati));
      }
      if (percorso === "/numero") {
        if (dati.password !== env.PASSWORD_REDAZIONE) return risposta(401, { errore: "Password della redazione sbagliata" });
        return risposta(200, await pubblicaNumero(env, dati));
      }
      return risposta(404, { errore: "Non trovato" });
    } catch (e) {
      if (e instanceof ErroreUtente) return risposta(400, { errore: e.message });
      console.error(e);
      return risposta(500, { errore: "Errore durante la pubblicazione, riprova tra poco" });
    }
  },
};

class ErroreUtente extends Error {}

// ---------- Post del blog ----------

async function pubblicaPost(env, { titolo, autore, testo, immagini = [] }) {
  titolo = (titolo || "").trim();
  autore = (autore || "").trim() || "anonimo";
  testo = (testo || "").trim();
  if (!titolo) throw new ErroreUtente("Manca il titolo");
  if (!testo) throw new ErroreUtente("Il testo è vuoto");
  if (titolo.length > 200 || autore.length > 100) throw new ErroreUtente("Titolo o firma troppo lunghi");
  if (immagini.length > MAX_IMMAGINI) throw new ErroreUtente(`Massimo ${MAX_IMMAGINI} immagini`);

  const adesso = new Date().toISOString();
  const oggi = adesso.slice(0, 10);
  const base = `${oggi}-${slug(titolo)}`;
  let nome = base;
  for (let i = 2; await esisteFile(env, `_blog/${nome}.md`); i++) nome = `${base}-${i}`;

  const file = [];
  for (const img of immagini) {
    const nomeImg = String(img.nome || "");
    if (!/^immagine-\d+\.(jpg|png|gif|webp)$/.test(nomeImg)) throw new ErroreUtente("Nome immagine non valido");
    if (typeof img.base64 !== "string" || !/^[A-Za-z0-9+/]+=*$/.test(img.base64)) throw new ErroreUtente("Immagine non valida");
    if (img.base64.length * 0.75 > MAX_BYTES_IMMAGINE) throw new ErroreUtente("Immagine troppo grande");
    const percorso = `/assets/blog/${nome}/${nomeImg}`;
    testo = testo.split(`](${nomeImg})`).join(`](${percorso})`);
    file.push({ path: percorso.slice(1), base64: img.base64 });
  }

  const contenuto = frontMatter({ title: titolo, autore, date: adesso }) + corpoSenzaLiquid(testo);
  file.push({ path: `_blog/${nome}.md`, testo: contenuto });

  await commit(env, file, `Blog: ${titolo} (di ${autore})`);
  return { url: `/blog/${nome}.html` };
}

// ---------- Numero del magazine ----------

async function pubblicaNumero(env, { post = [] }) {
  if (!Array.isArray(post) || post.length === 0) throw new ErroreUtente("Nessun post selezionato");
  if (post.some((p) => !/^_blog\/[\w-]+\.md$/.test(p))) throw new ErroreUtente("Post non valido");

  const numeriYml = await leggiFile(env, "_data/numeri.yml");
  const numeri = [...numeriYml.matchAll(/numero:\s*(\d+)/g)].map((m) => Number(m[1]));
  const n = Math.max(0, ...numeri) + 1;

  const file = [];
  for (const [i, p] of post.entries()) {
    const originale = await leggiFile(env, p);
    const { meta, corpo } = separaFrontMatter(originale);
    const urlBlog = `/blog/${p.slice("_blog/".length, -3)}.html`;
    file.push({
      path: `_articoli/numero${n}-articolo${i + 1}.md`,
      testo: frontMatter({ title: meta.title, autore: meta.autore, numero: n, blog: urlBlog }) + corpo,
    });
  }

  const d = new Date();
  const voce = `- numero: ${n}\n  data: ${d.getUTCDate()} ${MESI[d.getUTCMonth()]} ${d.getUTCFullYear()}\n`;
  file.push({ path: "_data/numeri.yml", testo: voce + numeriYml });

  await commit(env, file, `Numero ${n} (${post.length} articoli)`);
  return { numero: n };
}

// ---------- Markdown / front matter ----------

function slug(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "post";
}

// I valori sono stringhe JSON, che sono anche stringhe YAML valide.
function frontMatter(campi) {
  const righe = Object.entries(campi).map(([k, v]) =>
    `${k}: ${typeof v === "number" ? v : JSON.stringify(v ?? "")}`);
  return `---\n${righe.join("\n")}\n---\n`;
}

function separaFrontMatter(s) {
  const m = s.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error("Front matter mancante");
  const meta = {};
  for (const riga of m[1].split("\n")) {
    const kv = riga.match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    try { meta[kv[1]] = JSON.parse(kv[2]); } catch { meta[kv[1]] = kv[2]; }
  }
  return { meta, corpo: m[2] };
}

// Jekyll interpreta {{ }} e {% %} anche negli articoli: li disattiviamo
// così un testo qualsiasi non può rompere la build del sito.
function corpoSenzaLiquid(testo) {
  return `{% raw %}\n${testo.replace(/\{%-?\s*endraw\s*-?%\}/g, "")}\n{% endraw %}\n`;
}

// ---------- API GitHub ----------

async function github(env, metodo, percorso, corpo) {
  const res = await fetch(`https://api.github.com/repos/${env.REPO}${percorso}`, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "alexandra-worker",
      ...(corpo ? { "Content-Type": "application/json" } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub ${metodo} ${percorso}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function esisteFile(env, path) {
  return (await github(env, "GET", `/contents/${path}?ref=${env.BRANCH}`)) !== null;
}

async function leggiFile(env, path) {
  const f = await github(env, "GET", `/contents/${path}?ref=${env.BRANCH}`);
  if (!f) throw new ErroreUtente(`File non trovato: ${path}`);
  const bytes = Uint8Array.from(atob(f.content.replace(/\n/g, "")), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function utf8InBase64(s) {
  let bin = "";
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
  return btoa(bin);
}

// Un unico commit con tutti i file (Git Data API), così un post con immagini
// o un numero con più articoli compare tutto insieme o per niente.
async function commit(env, file, messaggio) {
  const ref = await github(env, "GET", `/git/ref/heads/${env.BRANCH}`);
  const padre = await github(env, "GET", `/git/commits/${ref.object.sha}`);

  const tree = [];
  for (const f of file) {
    const blob = await github(env, "POST", "/git/blobs", {
      content: f.base64 ?? utf8InBase64(f.testo),
      encoding: "base64",
    });
    tree.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
  }

  const nuovoTree = await github(env, "POST", "/git/trees", { base_tree: padre.tree.sha, tree });
  const nuovoCommit = await github(env, "POST", "/git/commits", {
    message: messaggio,
    tree: nuovoTree.sha,
    parents: [padre.sha],
  });
  await github(env, "PATCH", `/git/refs/heads/${env.BRANCH}`, { sha: nuovoCommit.sha });
}
