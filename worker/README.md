# Worker di pubblicazione

Piccolo backend su Cloudflare Workers che riceve i post da `/scrivi.html` e i numeri da
`/redazione.html` e li salva nel repo con un commit. GitHub Pages poi ricostruisce il sito
(circa 1 minuto).

Il token GitHub e le password stanno solo qui, come segreti di Cloudflare: non finiscono mai
nel browser né nel repo.

## Messa online (una volta sola)

### 1. Token GitHub

Su GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** →
Generate new token:

- **Resource owner**: `alexandramagazine`
- **Repository access**: Only select repositories → `alexandramagazine.github.io`
- **Permissions** → Repository permissions → **Contents: Read and write** (nient'altro)
- **Expiration**: es. 1 anno (poi lo rigeneri e rifai il passo 3)

Copia il token.

### 2. Cloudflare

Crea un account gratuito su https://dash.cloudflare.com e attiva la verifica in due passaggi.

```bash
cd worker
npx wrangler login
```

### 3. Segreti

```bash
npx wrangler secret put GITHUB_TOKEN        # incolla il token del passo 1
npx wrangler secret put PASSWORD_SCRITTURA  # la password per scrivere sul blog
npx wrangler secret put PASSWORD_REDAZIONE  # la password per pubblicare i numeri
```

(La prima volta wrangler chiede di creare il worker: rispondi sì.)

### 4. Pubblicazione

```bash
npx wrangler deploy
```

Stampa l'URL del worker, tipo `https://alexandra-publish.<tuo-sottodominio>.workers.dev`.
Mettilo in `worker_url` dentro `_config.yml` e fai commit.

## Modifiche successive

- Codice cambiato → `npx wrangler deploy`
- Cambiare una password → `npx wrangler secret put PASSWORD_SCRITTURA` (effetto immediato)
- Token compromesso → revocalo su GitHub, creane uno nuovo, `npx wrangler secret put GITHUB_TOKEN`
- Log in tempo reale → `npx wrangler tail`

## Endpoint

- `POST /post` `{ password, titolo, autore, testo, immagini: [{ nome, base64 }] }`
  → `_blog/AAAA-MM-GG-titolo.md` e immagini in `assets/blog/AAAA-MM-GG-titolo/`
- `POST /numero` `{ password, post: ["_blog/....md", ...] }`
  → `_articoli/numeroN-articoloK.md` (nell'ordine dato) + nuova voce in `_data/numeri.yml`
