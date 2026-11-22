# Plan d'implémentation — Fixi

## Contexte

Fixi est un service interne de signalement de bugs. Il comprend :
- un widget JS, ajouté par une balise `<script>` dans Flowi et Shifti ;
- un backend Node auto-hébergé ;
- une admin de triage, qui envoie les tickets vers GitLab ou GitHub et notifie les utilisateurs par e-mail.

La spécification de référence est [Cahier des Charges - Fixi.md](e:/Fixi/Cahier des Charges - Fixi.md). Ce plan intègre les arbitrages pris en conversation. **En cas de conflit, le plan l'emporte sur le cahier.**

- **Situation de départ :** le dossier `e:\Fixi` ne contient que le cahier des charges. Il n'y a pas encore de dépôt git.
- **Qui code :** Sonnet 5.5, dans VS Code.
- **Découpage :** 4 lots, validés l'un après l'autre.

---

## 0. Règles d'exécution (à lire par l'agent qui code)

1. **Avant de démarrer un lot :** lister les fichiers à créer ou modifier, puis attendre le « go » de l'utilisateur. C'est sa règle CLAUDE.md : pas de modification multi-fichiers sans confirmation.
2. **En fin de lot :**
   - exécuter la section « Validation » du lot et montrer la sortie des tests ;
   - commiter avec un message en français, par exemple `Lot 1 : socle backend, base SQLite et réception des signalements` ;
   - s'arrêter.
3. **Conseil :** ouvrir une session neuve par lot. Lui donner `PLAN.md` et le cahier des charges comme seules références.
4. **Langue :** le code, les identifiants et les commentaires sont en anglais. L'interface (widget, admin, e-mails) est en français.
5. **Zéro CDN :** toute dépendance front (`modern-screenshot`, Alpine, Bootstrap pour la page de test) vient de `node_modules` et est servie par Fixi.
6. **Hors périmètre :** rrweb, `getDisplayMedia`, webhooks GitLab, multi-utilisateurs admin, graphiques, hq-app.

**Première action après validation du plan :** copier ce plan dans `e:\Fixi\PLAN.md`, puis lancer `git init`.

---

## 1. Arbitrages figés (écarts par rapport au cahier)

| Sujet | Décision |
|---|---|
| Stack | Node 22 LTS, TypeScript, Fastify, `better-sqlite3`, esbuild pour le widget. Projet ESM (`"type": "module"`) |
| Admin | Pages rendues côté serveur avec `@fastify/view` + Eta, et Alpine.js copié en local. Pas de SPA |
| Trackers | `issue_provider` par application : `gitlab`, `github` ou aucun. Champs génériques `issue_url` et `issue_number` |
| GitHub | `github.com`, avec `GITHUB_API_URL` configurable (`https://api.github.com` par défaut). Pas d'upload d'image : l'issue contient le Markdown et un lien vers la fiche Fixi |
| Anonymisation | Option `issue_anonymize` par application. Si elle est cochée, l'issue omet l'utilisateur, l'e-mail, les payloads, les corps de réponse et la capture. On garde le symptôme, le contexte non personnel, la chronologie réduite (types, URL sans query string, statuts) et le lien Fixi |
| Tokens | `GITLAB_TOKEN` et `GITHUB_TOKEN` globaux, en variables d'environnement |
| Statut | `gitlab` devient `sent` (libellé « Envoyé tracker »). Lier une URL à la main met aussi le statut à `sent` |
| Instances | Une instance Fixi par environnement (préprod OVH, prod) |
| SMTP | Optionnel. Sans `SMTP_HOST`, Fixi démarre quand même, n'envoie rien et écrit l'e-mail dans les logs |
| Navigateurs | Chrome, Edge et Firefox récents. `ClipboardItem` image est disponible depuis Firefox 127 |
| Commentaire | Facultatif si la capture est jointe, obligatoire sinon |
| Capture | Zone visible uniquement, `pixelRatio` = 1, timeout de 8 s. Si la capture échoue, la modale s'ouvre sans capture |
| Détachement | Un doublon détaché repasse au statut `new` |
| Parent clôturé | Les statuts des enfants ne changent pas |
| Purge | Concerne les parents `resolved`/`rejected` plus vieux que `RETENTION_DAYS` (selon `updated_at`), supprimés **avec leurs enfants** et leurs fichiers. Les tickets `sent` ne sont jamais purgés |
| Sessions | Stockées dans une table SQLite `sessions`. Cookie signé `fixi_sid`, `HttpOnly`, `SameSite=Lax`, `Secure` en production |
| Proxy | `trustProxy` configurable, activé en Docker |
| Rate-limit | `POST /api/reports` : 10 requêtes/min par IP. `POST /api/admin/login` : 5 requêtes/min par IP |
| Badges 4xx/5xx | On ajoute une colonne `max_http_status` en plus de `has_http_error`, pour distinguer les badges 4xx et 5xx |

---

## 2. Arborescence cible

```
package.json  tsconfig.json  vitest.config.ts  .env.example  .gitignore  .dockerignore
Dockerfile  docker-compose.yml  README.md  PLAN.md
scripts/
  build-widget.mjs        # esbuild : src/widget -> dist/public/widget.js (IIFE, minifié)
  copy-vendor.mjs         # copie alpine.min.js et bootstrap dans dist/public/vendor
  hash-password.ts        # CLI : génère le hash bcrypt (affiche les formes brute et échappée $$)
  seed.ts                 # crée les apps shifti et flowi pour le dev
src/shared/types.ts       # TimelineEvent, ReportPayload, Category, Status (partagés widget/serveur)
src/server/
  index.ts                # démarrage (listen + job de purge)
  app.ts                  # buildApp(config) -> instance Fastify (réutilisée par les tests)
  config.ts               # lecture et validation zod des variables d'env, fail-fast
  db/index.ts  db/migrate.ts  db/migrations/001_init.sql
  repositories/apps.ts  reports.ts  sessions.ts
  plugins/auth.ts  public-cors.ts  security-headers.ts  admin-origin-check.ts
  routes/public/widget.ts  reports.ts
  routes/admin/auth.ts  reports.ts  apps.ts  files.ts  pages.ts
  services/
    storage.ts            # écriture des fichiers (nom UUID), suppression, chemins
    upload-validation.ts  # MIME réel (file-type) + taille + liste blanche
    timeline-analysis.ts  # has_http_error, max_http_status, has_js_error
    markdown.ts           # buildReportMarkdown(report, {anonymize, fixiLink})
    user-agent.ts         # "Edge 130 / Windows 10", repli sur le UA brut
    purge.ts  mailer.ts  notifications.ts
    trackers/index.ts  gitlab.ts  github.ts
  views/layout.eta  login.eta  reports-list.eta  report-detail.eta  settings.eta  app-form.eta  partials/*.eta
src/widget/
  index.ts  config.ts  sanitize.ts  selector.ts  capture.ts  submit.ts
  breadcrumbs/store.ts  nav.ts  click.ts  network.ts  errors.ts
  ui/styles.ts  tab.ts  modal.ts  annotator.ts  attachment.ts
public/admin/admin.css  admin.js
test-host/server.ts  index.html  page2.html
tests/*.test.ts
```

**Dépendances :**
- **Exécution :** `fastify`, `@fastify/cookie`, `@fastify/multipart`, `@fastify/static`, `@fastify/view`, `@fastify/rate-limit`, `@fastify/formbody`, `eta`, `better-sqlite3`, `bcryptjs` (pur JS, pas de compilation native), `file-type`, `nodemailer`, `zod`.
- **Front :** `modern-screenshot` (bundlé dans le widget), `alpinejs` (copié), `bootstrap` (page de test uniquement).
- **Dev :** `typescript`, `tsx`, `esbuild`, `vitest`, les `@types/*` nécessaires.

**Scripts npm :**
- `dev` : `tsx watch` du serveur + esbuild en mode watch ;
- `build` ;
- `start` ;
- `test` ;
- `test-host` ;
- `seed` ;
- `hash-password` ;
- `purge`.

---

## 3. Modèle de données (`001_init.sql`)

```sql
apps(id PK, slug UNIQUE NOT NULL, name NOT NULL, api_key NOT NULL,
     allowed_origins TEXT NOT NULL DEFAULT '[]',          -- JSON array
     issue_provider TEXT NULL CHECK(issue_provider IN ('gitlab','github')),
     issue_project TEXT NULL,      -- id de projet GitLab ("42") ou "owner/repo" GitHub
     issue_default_labels TEXT NULL,                       -- "bug,fixi"
     issue_anonymize INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL)

bug_reports(id PK, app_id FK->apps ON DELETE RESTRICT,
     parent_id FK->bug_reports NULL,
     category CHECK IN ('bug','blocking','suggestion'),
     status CHECK IN ('new','in_progress','sent','resolved','rejected','duplicate') DEFAULT 'new',
     comment, user_info, user_email, app_version, url, user_agent, viewport,
     client_created_at,
     screenshot_path NULL, attachment_path NULL, attachment_original_name NULL, attachment_mime NULL,
     timeline_json NOT NULL DEFAULT '[]',
     has_http_error INTEGER, max_http_status INTEGER NULL, has_js_error INTEGER,
     issue_provider NULL, issue_number NULL, issue_url NULL,   -- issue_url non unique
     admin_notes NULL, last_notified_at NULL,
     created_at, updated_at)
  index: (app_id, status), (parent_id), (created_at)

sessions(id TEXT PK, expires_at TEXT NOT NULL)
schema_migrations(version PK, applied_at)
```

- **Mécanisme de migration :** `migrate.ts` exécute dans l'ordre les fichiers `.sql` qui ne figurent pas encore dans `schema_migrations`.
- **Réglages SQLite :** `PRAGMA journal_mode=WAL` (les lectures ne bloquent pas l'écriture) et `foreign_keys=ON` (les clés étrangères sont vérifiées).
- **Dates :** toutes au format ISO UTC.

**Type `TimelineEvent`** (dans `src/shared/types.ts`), avec `t` en millisecondes depuis l'epoch :
- `{t, type:'nav', url, kind:'load'|'push'|'replace'|'pop'|'hash'}`
- `{t, type:'click', selector, text?}`
- `{t, type:'net', method, url, status, durationMs, requestId?, requestBody?, responseBody?}` : `status` vaut 0 pour une erreur réseau
- `{t, type:'js_error', source:'error'|'unhandledrejection'|'console', message, file?, line?, col?, stack?}`

---

## 4. Variables d'environnement (`.env.example`)

| Groupe | Variables |
|---|---|
| Base | `NODE_ENV`, `PORT=3000`, `APP_BASE_URL`, `TRUST_PROXY=false`, `DATABASE_PATH=./data/fixi.db`, `STORAGE_DIR=./storage`, `RETENTION_DAYS=90`, `DISPLAY_TIMEZONE=Europe/Paris` |
| Admin | `ADMIN_USER`, `ADMIN_PASSWORD_HASH`, `SESSION_SECRET` (au moins 32 caractères), `ADMIN_ALERT_EMAIL` (optionnel) |
| GitLab | `GITLAB_URL`, `GITLAB_TOKEN` (optionnels) |
| GitHub | `GITHUB_API_URL=https://api.github.com`, `GITHUB_TOKEN` (optionnel) |
| SMTP | `SMTP_HOST` (optionnel : désactive l'envoi s'il est vide), `SMTP_PORT=587`, `SMTP_SECURE=false`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` |

- **Chargement :** en local, via `node --env-file-if-exists=.env`.
- **Validation :** `config.ts` valide tout avec zod. Il s'arrête avec un message clair s'il manque `ADMIN_USER`, `ADMIN_PASSWORD_HASH`, `SESSION_SECRET` ou `APP_BASE_URL`.
- **Piège du `$` :** le README explique l'échappement en `$$` dans `docker-compose.yml`. Raison : le hash bcrypt contient des `$`, que Docker Compose prend pour des variables.

---

## Lot 1 — Socle backend, base de données et réception

**Étapes**
1. Initialiser le projet :
   - `package.json`, `tsconfig.json` (strict, NodeNext), `.gitignore` (`node_modules`, `dist`, `data`, `storage`, `.env`), `.env.example` ;
   - `config.ts`, la base et les migrations, `buildApp()`.
2. Écrire `scripts/hash-password.ts`. Il lit le mot de passe sur stdin et affiche le hash bcrypt, coût 12.
3. Écrire `plugins/auth.ts` et `routes/admin/auth.ts` :
   - **`POST /api/admin/login`** : comparaison bcrypt, puis création d'une session (id aléatoire de 32 octets, durée de 12 h glissante). Pose le cookie `fixi_sid` signé.
   - **`POST /api/admin/logout`** et **`GET /api/admin/me`**.
   - **Protection :** un hook `preHandler` protège `/admin/*`, sauf `/admin/login`, ainsi que `/api/admin/*`, sauf login. Sans session valide : 401 en JSON, ou redirection vers `/admin/login` pour une page HTML.
   - **Rate-limit :** 5 requêtes/min sur le login.
   - **Nettoyage :** les sessions expirées sont supprimées au démarrage, puis toutes les heures.
4. Écrire `plugins/admin-origin-check.ts`. Pour POST, PUT, PATCH et DELETE sur les routes admin, refuser (403) si `Origin` est présent et différent de l'origine de `APP_BASE_URL`. Cela complète `SameSite=Lax` contre les attaques CSRF (requêtes forgées depuis un autre site).
5. Écrire le CRUD `GET/POST/PUT/DELETE /api/admin/apps`, en JSON :
   - validation zod : slug `^[a-z0-9-]+$`, `allowed_origins` = tableau d'origines valides ;
   - `api_key` générée par `crypto.randomBytes(24).toString('base64url')`, avec une action `POST /api/admin/apps/:id/regenerate-key` ;
   - DELETE refusé (409) si l'application a des signalements.
6. Écrire `plugins/public-cors.ts`, qui couvre `/api/reports` :
   - lire `Origin` ;
   - pour l'en-tête `OPTIONS` (requête de pré-vérification CORS), répondre avec `Access-Control-Allow-Origin` égal à l'origine **uniquement si** elle figure dans les `allowed_origins` d'au moins une application ;
   - la vérification fine (origine ↔ application) se fait dans la route.
7. Écrire **`POST /api/reports`**, en multipart avec `@fastify/multipart` (limites : 3 fichiers, 5 Mo par fichier) :
   - parser `payload` (JSON) et le valider avec zod (`ReportPayload` : app, apiKey, user, userEmail?, version?, category, comment, url, viewport, userAgent, clientCreatedAt, timeline ≤ 40 événements, chaque champ tronqué) ;
   - charger l'application par son slug ;
   - comparer `apiKey` en temps constant (`crypto.timingSafeEqual`, pour ne pas laisser deviner la clé par la durée de réponse) ;
   - vérifier que `Origin` figure dans les `allowed_origins` de **cette** application, sinon 403 ;
   - fichiers : `screenshot` doit avoir le MIME réel `image/png`. `attachment` doit appartenir à la liste blanche (png, jpeg, gif, webp, pdf, xlsx, xls, csv, txt). Pour csv et txt, qui n'ont pas de signature binaire : extension correcte, UTF-8 valide, aucun octet NUL. Taille de 5 Mo maximum, sinon 413 ;
   - règle « commentaire obligatoire s'il n'y a pas de capture », sinon 400 ;
   - `timeline-analysis` calcule `has_http_error`, `max_http_status` et `has_js_error` ;
   - stockage `STORAGE_DIR/<uuid>.<ext>`, puis insertion en base ;
   - réponse `201 {id}` avec les en-têtes CORS ;
   - **Alerte admin :** la route l'enregistre dans un hook post-réponse, branché par le lot 4. Pour l'instant, un `notifyNewReport()` vide (no-op) dans `notifications.ts`.
   - rate-limit : 10 requêtes/min par IP.
8. Écrire `GET /api/admin/files/:name` :
   - le nom doit respecter `^[0-9a-f-]{36}\.[a-z0-9]{1,5}$`, sinon 404 ;
   - en-tête `X-Content-Type-Options: nosniff` ;
   - images affichées en `inline`, autres fichiers en `attachment` avec le nom d'origine (`?download=1` force le téléchargement).
9. Écrire `services/purge.ts` :
   - `runPurge(db, now, retentionDays)` supprime les parents clôturés, leurs enfants et leurs fichiers ;
   - **ordre obligatoire**, parce que `foreign_keys=ON` est actif et que `parent_id` n'a pas de `ON DELETE CASCADE` :
     1. sélectionner les parents à purger et collecter les chemins de fichiers du parent et de ses enfants ;
     2. dans **une transaction** : `DELETE` des enfants, puis `DELETE` des parents ;
     3. après le commit seulement, supprimer les fichiers sur disque. Un fichier déjà absent (`ENOENT`) est écrit dans les logs sans faire échouer la purge ;
   - planifié au démarrage, puis toutes les 24 h (`setInterval` + `unref`) ;
   - aussi disponible en commande : `npm run purge`.
10. Écrire `GET /healthz`, qui renvoie `{ok:true}`.
11. Écrire `Dockerfile` et `docker-compose.yml` :
    - build en deux étapes sur `node:22-bookworm-slim` ;
    - **étape `builder`** : `apt-get install python3 make g++`, en filet de sécurité si le binaire précompilé de `better-sqlite3` ne correspond pas à la plateforme. Puis `npm ci`, compilation TypeScript + widget, `npm prune --omit=dev` ;
    - **image finale** : copie de `dist/` et de `node_modules/` depuis le builder. **Pas de `npm ci` dans l'image finale** : elle n'a pas d'outils de compilation ;
    - utilisateur non-root ;
    - volumes `/app/data` et `/app/storage` ;
    - `HEALTHCHECK` sur `/healthz`.
12. Écrire `scripts/seed.ts`. Il crée `shifti` et `flowi` avec les origines `http://localhost:5173` (page de test) et `http://localhost` (WAMP), et affiche les clés.

**Tests (Vitest + `app.inject`, base SQLite dans un dossier temporaire)**
- **Login :** succès, échec, cookie `HttpOnly`, accès à `/api/admin/me` avec et sans session, 429 au-delà du rate-limit.
- **Applications :** CRUD, validation, suppression refusée si des signalements existent.
- **`POST /api/reports` :** succès, mauvaise clé (401), origine non autorisée (403), faux PNG (un `.exe` renommé en `.png`, refusé avec 400), fichier de plus de 5 Mo (413), commentaire vide sans capture (400), flags calculés correctement.
- **Fichiers :** nom invalide ou tentative de remonter l'arborescence (404), accès sans session (401).
- **Purge :** un parent `resolved` vieux de 91 jours, avec 2 enfants et `foreign_keys=ON`, est supprimé avec ses enfants et leurs fichiers, sans erreur de contrainte. Un ticket `sent` ancien est conservé. Un parent `in_progress` est conservé.

**Validation :** `npm test` au vert. Puis `npm run dev`, `npm run seed`, et un `curl` multipart avec `-H "Origin: http://localhost:5173"` qui doit renvoyer 201. Enfin, `docker compose up --build` doit démarrer et `/healthz` répondre.

---

## Lot 2 — Widget client (`widget.js`)

**Principes**
- Un seul bundle IIFE (un fichier JS qui s'exécute tout seul, sans module), cible `es2020`, `modern-screenshot` inclus.
- Servi par `GET /widget.js`, avec `Cache-Control: public, max-age=300`.
- **Tout le code est enveloppé dans `try/catch`.** Une erreur de Fixi ne doit jamais remonter vers l'application hôte. Les erreurs internes partent uniquement dans `console.debug('[fixi]', …)`.

**Étapes**
1. **`config.ts`.** Au chargement, lire `document.currentScript` : `data-app`, `data-api-key`, `data-user`, `data-user-email`, `data-version`. Déduire l'URL de l'API de l'origine de `src`. Si `data-app` ou la clé manque, ne rien faire.
2. **`breadcrumbs/store.ts`** — tampon circulaire de 40 événements :
   - stocké dans `sessionStorage` sous la clé `fixi:tl:<app>`, avec lecture et écriture protégées par `try/catch` ;
   - texte tronqué : 500 caractères pour les corps, 300 pour les URL et les messages, 50 pour le texte des clics.
3. **`nav.ts`.** Enregistrer `load` au démarrage. Envelopper `history.pushState` et `replaceState`. Écouter `popstate` et `hashchange`.
4. **`click.ts`** — écoute de `click` sur `document` en phase de capture :
   - ignorer les clics à l'intérieur de l'hôte Fixi ;
   - `selector.ts` produit `tag#id.class1.class2[name="…"]` (2 classes au maximum, en excluant les classes dynamiques ou trop longues) ;
   - texte visible : `innerText` tronqué à 50 caractères. **Ne jamais lire `value`**, surtout pour `input[type=password]`.
5. **`sanitize.ts`** — fonctions pures et testées :
   - `redact(value)` parcourt récursivement objets et tableaux. Il remplace par `"[REDACTED]"` toute valeur dont la clé contient, sans tenir compte de la casse : `password|passwd|pwd|token|secret|auth|authorization|cookie|csrf|api_key|apikey` ;
   - `sanitizeBody(body)` gère : chaîne JSON (on la parse, on l'expurge, on la resérialise) ; `URLSearchParams` et chaîne au format formulaire ; `FormData` (les fichiers deviennent `[File nom]`) ; `Blob` ou `ArrayBuffer` (deviennent `[binary]`). Résultat tronqué à 500 caractères.
6. **`network.ts`** :
   - **`fetch` :** envelopper `window.fetch`. Mesurer la durée. Ignorer les requêtes vers l'API Fixi. Si le statut est ≥ 400 : `response.clone().text()` en asynchrone, sans attendre, et seulement si le `content-type` est textuel (json, text, html, xml). Lire `X-Request-Id`. Expurger le corps envoyé pour POST, PUT et PATCH. Une erreur réseau donne `status: 0`.
   - **XHR :** envelopper `open` et `send`. Sur `loadend`, si le statut est ≥ 400 et `responseType` vaut `''`, `'text'` ou `'json'`, lire le corps. Sinon, ignorer le corps.
7. **`errors.ts`** :
   - écouter `error` (message, fichier, ligne, colonne, 5 premières lignes de la pile) et `unhandledrejection` ;
   - envelopper `console.error` avec un garde contre la récursion (un booléen `inFixi`) ;
   - les messages console passent par `redact` et sont tronqués.
8. **`ui/`** — un hôte `<div id="fixi-root">` avec `attachShadow({mode:'open'})`, le CSS étant injecté depuis `styles.ts` :
   - **Languette :** verticale, au bord droit et centrée, semi-transparente puis opaque au survol. Libellé « Signaler un problème » avec une icône SVG en point d'exclamation. `z-index` 2147483000.
   - **Clic 1 :**
     - afficher un petit indicateur de chargement, la languette étant masquée ;
     - lancer `capture.ts`, avec `scale` 1, un `filter` qui exclut `#fixi-root`, et un timeout de 8 s. Les éléments `[data-fixi-mask]` sont remplacés par un bloc gris dans le clone (option de clonage de modern-screenshot ; à défaut, `visibility:hidden` temporaire) ;
     - **zone visible uniquement.** Par défaut, `domToPng(document.documentElement)` capture **toute la hauteur du document**. Sur un long planning Shifti, le PNG dépasserait 5 Mo. Méthode :
       1. **méthode principale :** limiter le rendu au viewport avec `domToCanvas(document.documentElement, { width: innerWidth, height: innerHeight, style: { transform: 'translate(-scrollXpx, -scrollYpx)' } })`, en remplaçant `scrollX` et `scrollY` par les valeurs réelles. On ne calcule ainsi que la zone affichée ;
       2. **repli**, si la méthode principale décale les éléments `position: fixed` : capturer la page entière avec `domToCanvas`, puis rogner sur un `<canvas>` intermédiaire avec `drawImage(src, scrollX, scrollY, innerWidth, innerHeight, 0, 0, innerWidth, innerHeight)` ;
       3. dans les deux cas, `canvas.toBlob('image/png')`. Vérifier sur `test-host` avec une page plus haute que l'écran, défilée vers le milieu ;
     - ouvrir la modale ensuite.
   - **Modale :**
     - pilules Bug (choix par défaut), Bloquant, Suggestion ;
     - `textarea` avec le focus automatique et le placeholder du cahier ;
     - case « Joindre la capture d'écran » cochée et miniature cliquable « Annoter / Agrandir » ;
     - zone de pièce jointe ;
     - boutons Envoyer et Annuler. Échap ferme la modale.
   - **`annotator.ts` :** un overlay qui superpose un `<canvas>` à l'image. Pinceau rouge géré par les Pointer Events (souris, tactile et stylet), épaisseur proportionnelle à la taille de l'image. Boutons « Annuler le dernier trait », « Effacer » et « Valider ». À la validation, l'image et les traits sont fusionnés sur un canvas hors écran, puis `toBlob('image/png')` remplace la miniature.
   - **`attachment.ts`** :
     - un sélecteur de fichier (`accept` limité à la liste blanche, 5 Mo, 1 fichier) ;
     - collage : `paste` écouté sur `document` tant que la modale est ouverte. Si `clipboardData.items` contient un `image/*`, on attache l'image et on appelle `preventDefault`. Sinon, on ne fait rien, pour que le collage de texte dans le `textarea` reste normal ;
     - aperçu et bouton `×`.
9. **`submit.ts`** :
   - construire un `FormData` avec `payload` (JSON contenant la timeline lue au moment de l'envoi), `screenshot` (si la case est cochée) et `attachment` ;
   - `fetch(apiBase + '/api/reports', {method:'POST', body, credentials:'omit'})`, en utilisant le `fetch` **d'origine**, pas la version enveloppée ;
   - **Succès :** « Merci, votre signalement a bien été transmis. », puis fermeture au bout de 2 s ;
   - **Erreur :** message explicite, saisie conservée, bouton « Réessayer ».
10. **API publique :** `window.Fixi = { open }`. L'initialisation se fait sur `DOMContentLoaded`, ou tout de suite si la page est déjà prête.
11. **`test-host/`** :
    - un petit serveur Fastify sur le port 5173. Il sert `index.html` et `page2.html` (Bootstrap 5 depuis `node_modules`) et le widget par une balise qui pointe vers `http://localhost:3000/widget.js` ;
    - endpoints `/api/ok`, `/api/fail500` (corps imitant une erreur SQL), `/api/fail422`, et `/api/slow` ;
    - boutons qui déclenchent fetch 500, XHR 422, `TypeError`, promesse rejetée, `console.error`, et un POST JSON contenant `password` et `token` ;
    - un champ `type=password` et un bloc `data-fixi-mask` ;
    - un lien vers `page2.html`, pour vérifier que la timeline survit au changement de page.

**Tests :** `sanitize.test.ts` couvre les clés imbriquées, les tableaux, FormData, la chaîne de formulaire, la troncature et la casse. `selector.test.ts` tourne dans un environnement jsdom (un DOM simulé dans Node).

**Validation manuelle sous Chrome, Edge et Firefox :**
- la modale n'apparaît pas sur la capture ;
- annoter, puis valider ;
- coller une image avec `Ctrl+V` ;
- coller du texte dans le `textarea` ;
- envoyer ;
- vérifier en base que la timeline contient NAV, CLICK, NET 500 avec le corps, et JS_ERROR ;
- vérifier que `password` et `token` sont expurgés ;
- vérifier que le bloc masqué est grisé sur la capture ;
- couper le serveur Fixi : le message d'erreur s'affiche et la saisie est conservée ;
- l'application hôte continue de fonctionner normalement.

---

## Lot 3 — Interface d'administration, regroupement et outils Cursor

**Principes**
- Pages rendues avec Eta. **Toujours utiliser `<%= %>`** (sortie échappée) pour le contenu saisi par l'utilisateur. `<%~ %>` (sortie brute) est interdit sur ces données, sinon un commentaire malveillant injecte du HTML dans l'admin.
- Alpine se charge depuis `/public/vendor/alpine.min.js`.
- Les actions passent par `fetch` vers `/api/admin/*`, puis rechargent la page ou mettent à jour l'état local.
- **`security-headers.ts`**, pour les pages admin :
  - CSP `default-src 'self'; img-src 'self' data: blob:; script-src 'self' 'unsafe-eval'; style-src 'self'; frame-ancestors 'none'`. `'unsafe-eval'` est nécessaire parce que la version standard d'Alpine évalue ses expressions ;
  - `X-Frame-Options: DENY` et `Referrer-Policy: same-origin` ;
  - aucun script inline ;
  - **portée stricte :** le plugin s'applique uniquement à `/admin/*` et `/api/admin/*`. Il ne touche **jamais** `GET /widget.js` ni `POST /api/reports` ;
  - ne pas utiliser `@fastify/helmet` en global. Son en-tête par défaut `Cross-Origin-Resource-Policy: same-origin` (il interdit aux autres sites de charger la ressource) bloquerait le chargement de `widget.js` depuis Shifti et Flowi ;
  - **test à ajouter :** `GET /widget.js` ne renvoie ni `Content-Security-Policy`, ni `Cross-Origin-Resource-Policy: same-origin`.

**Étapes**
1. **`services/markdown.ts`** — `buildReportMarkdown(report, children, {anonymize, fixiLink})` :
   - reprend exactement le format de la section 3.2 du cahier, en corrigeant la coquille `**[JS_ERROR]**` ;
   - temps relatifs `[-x.xs]` calculés par rapport à `client_created_at` ;
   - ligne finale `[0.0s] [REPORT]` ;
   - « Signalé par N utilisateurs » si le ticket a des doublons. N est le nombre d'e-mails ou de `user_info` distincts ;
   - UA lisible ;
   - dates affichées dans le fuseau `DISPLAY_TIMEZONE` ;
   - payload et réponse placés dans des blocs de code, avec des délimiteurs plus longs que toute suite de backticks du contenu ;
   - **Jamais `admin_notes`.**
2. **`GET /api/admin/reports`** :
   - filtres `app_id`, `status`, `category`, `q` (`LIKE` sur le commentaire, `user_info`, l'URL et l'id), `include_duplicates`, `parents_only` (pour le sélecteur de rattachement) ;
   - pagination de 50 par page, tri par date décroissante ;
   - `duplicates_count` calculé par sous-requête.
3. **`GET /api/admin/reports/:id`** : renvoie le détail, la liste des enfants ou le parent, et `markdown`.
4. **`PATCH /api/admin/reports/:id`**, avec validation zod, champs `status`, `admin_notes`, `issue_url` et `parent_id` :
   - **Rattachement :** refusé (409) si la cible est le ticket lui-même, si elle est d'une autre application, si la cible a un parent, ou si le ticket a déjà des enfants. Le statut passe à `duplicate`.
   - **Détachement :** `parent_id: null` remet le statut à `new`.
   - **`issue_url` manuelle :** doit être une URL `https://`. Le statut passe à `sent` et `issue_provider` à `null`.
5. **Page de login `/admin/login`.** Un formulaire qui fait un `fetch` vers `/api/admin/login`, puis redirige vers `/admin`. La déconnexion est dans l'en-tête.
6. **Page liste `/admin`** :
   - filtres en GET dans la query string, donc partageables par URL ;
   - case « Afficher les doublons » ;
   - recherche ;
   - **badges :** Bloquant (rouge), HTTP 5xx, HTTP 4xx, JS Error, `+X signalements`, PJ, lien `GitLab #n` ou `GitHub #n` ;
   - extrait du commentaire, application, utilisateur, date, statut ;
   - pagination.
7. **Page détail `/admin/reports/:id`** :
   - **Capture :** miniature, et lightbox Alpine en plein écran. Clic pour basculer entre « ajusté » et taille réelle, défilement libre, Échap pour fermer.
   - **« Copier pour Cursor » :** `navigator.clipboard.writeText(markdown)`.
   - **« Copier l'image » :** `fetch` de la capture, puis `navigator.clipboard.write([new ClipboardItem({'image/png': blob})])`. En cas d'échec, afficher un message invitant à télécharger.
   - **Téléchargements :** fichier `.md` (Blob côté client, nommé `fixi-<app>-<id>.md`), capture et pièce jointe.
   - **Section doublons :**
     - sur un ticket sans enfant ni parent : « Rattacher comme doublon de… », avec une recherche Alpine qui interroge `parents_only=1&app_id=…` ;
     - sur un ticket enfant : lien vers le parent, lien d'issue du parent, bouton « Détacher » ;
     - sur un ticket parent : « Signalements rattachés (X) » avec l'auteur, la date, l'extrait et le lien.
   - **Statut :** sélecteur et enregistrement.
   - **Notes internes :** `textarea`, enregistrement explicite, mention « privé, jamais partagé ».
   - **Champ `issue_url` manuel.**
   - **Emplacements prévus pour le lot 4 :** bouton « Créer l'issue » et panneau « Notifier ». Ils sont désactivés et marqués « bientôt ».
8. **Page Paramètres `/admin/settings`** :
   - liste des applications et formulaire de création ou d'édition : slug, nom, origines (une par ligne), fournisseur (aucun, GitLab, GitHub), projet, labels, case anonymisation ;
   - bouton « Régénérer la clé » ;
   - **snippet `<script>` prêt à copier :** `src` = `APP_BASE_URL/widget.js`, avec `data-*` d'exemple et un commentaire PHP de type `<?= h($user) ?>` à adapter.

**Tests :**
- **Markdown :** instantané (snapshot) sur un rapport type, vérification que `admin_notes` est absent, vérification de l'anonymisation (ni e-mail, ni payload, ni corps de réponse).
- **PATCH :** toutes les règles anti-chaînage, détachement qui remet le statut à `new`, URL manuelle qui met le statut à `sent`.
- **Liste :** doublons masqués par défaut, compteur exact, filtres combinés.
- **Pages :** une page admin sans session redirige vers le login. Un commentaire `<script>` apparaît échappé dans le HTML rendu.

**Validation :** parcourir l'admin avec les signalements créés au lot 2. Tester « Copier pour Cursor » et « Copier l'image » dans Chrome et dans Firefox, en collant le résultat dans un éditeur. Rattacher, puis détacher un doublon.

---

## Lot 4 — Intégrations externes (trackers et SMTP)

**Étapes**
1. **`services/trackers/index.ts`** — une interface commune :
   ```ts
   interface IssueTracker {
     createIssue(input: {
       project: string;
       title: string;
       body: string;
       labels: string[];
       files: {path: string; name: string; mime: string}[];
     }): Promise<{number: number; url: string}>;
   }
   ```
   - Une fabrique choisit l'implémentation selon `app.issue_provider`.
   - Si le token correspondant est absent : erreur 400 avec un message clair.
   - Utiliser le `fetch` natif de Node 22, avec un timeout de 15 s (`AbortSignal.timeout`).
2. **`gitlab.ts`** :
   - pour chaque fichier, `POST {GITLAB_URL}/api/v4/projects/:id/uploads` en multipart, en-tête `PRIVATE-TOKEN`. Récupérer le `markdown` renvoyé et l'ajouter au corps de l'issue ;
   - puis `POST /api/v4/projects/:id/issues` avec `title`, `description` et `labels` (séparés par des virgules) ;
   - renvoie `iid` et `web_url`.
3. **`github.ts`** :
   - `POST {GITHUB_API_URL}/repos/{owner}/{repo}/issues` avec `title`, `body` et `labels[]` ;
   - en-têtes `Authorization: Bearer`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, `User-Agent: Fixi` ;
   - pas de fichier. Le corps se termine par « Capture et pièce jointe disponibles dans Fixi : `<APP_BASE_URL>/admin/reports/:id` » ;
   - renvoie `number` et `html_url`.
4. **`POST /api/admin/reports/:id/issue`** (remplace la route `/gitlab` du cahier), corps `{title, labels[]}` :
   - refusé (409) si `issue_url` est déjà renseignée : c'est le verrou anti-doublon. Refusé aussi si le ticket est un enfant ;
   - corps de l'issue = `buildReportMarkdown(report, children, {anonymize: app.issue_anonymize, fixiLink})`. Mentionner le nombre d'utilisateurs touchés s'il y a des doublons ;
   - **neutraliser les mentions** : `@` devient `@` suivi d'un espace de largeur nulle, dans le commentaire utilisateur. Sinon, un commentaire contenant `@all` notifierait tout le projet ;
   - fichiers joints (GitLab seulement) : capture et pièce jointe, **sauf si l'anonymisation est active**. La capture peut afficher des noms ;
   - après le succès, renseigner `issue_provider`, `issue_number` et `issue_url`, et passer le statut à `sent`, dans une seule transaction ;
   - si l'appel externe échoue, renvoyer 502 avec le message du tracker, sans rien modifier en base.
5. **Interface de création d'issue :** une modale de confirmation, avec le titre pré-rempli (`[Fixi][Bloquant] Shifti #42 — <extrait du commentaire>`) et les labels pré-remplis depuis l'application, tous modifiables. Le bouton disparaît une fois l'issue liée.
6. **`services/mailer.ts`** :
   - `sendMail({to, subject, text})` ;
   - si `SMTP_HOST` est vide : `logger.info({mail}, 'SMTP disabled')` et retour d'un succès ;
   - sinon, transport nodemailer créé une seule fois.
7. **Alerte admin** — `notifyNewReport` branchée dans le hook post-réponse de `POST /api/reports` :
   - envoi en arrière-plan, erreurs écrites dans les logs, sans jamais faire échouer la requête ;
   - seulement si `ADMIN_ALERT_EMAIL` est défini ;
   - objet `[Fixi][Bloquant] shifti — nouveau signalement #42` ;
   - corps : application, catégorie, utilisateur, extrait du commentaire (200 caractères), anomalies (HTTP 5xx, HTTP 4xx, JS Error), lien vers la fiche.
8. **`POST /api/admin/reports/:id/notify`**, corps `{subject, message}` :
   - refusé si le ticket est un enfant (on notifie depuis le parent), ou si le statut n'est ni `resolved` ni `rejected` ;
   - destinataires : le parent et tous ses enfants, e-mails mis en minuscules et dédoublonnés ;
   - **un e-mail par destinataire**, pour ne jamais exposer l'adresse des autres. Pas de destinataires en copie visible ;
   - mettre à jour `last_notified_at` sur le parent et ses enfants ;
   - renvoie `{sent, failed[]}`.
9. **Panneau « Notifier les utilisateurs »** sur la fiche :
   - actif si le statut est résolu ou non retenu et qu'au moins un e-mail existe ;
   - liste les destinataires dédoublonnés ;
   - message pré-rempli selon le statut. Exemple pour « Résolu » : « Bonjour, le problème que vous avez signalé le … sur Shifti a été corrigé. » ;
   - avertissement « Déjà notifié le … » si `last_notified_at` est renseigné, avec une confirmation demandée.
10. **README :** installation locale, variables d'environnement, déploiement Docker derrière un reverse proxy, intégration du snippet dans Shifti (WAMP) et Flowi (Docker), création des tokens GitLab (portée `api`) et GitHub (fine-grained, permission Issues en lecture-écriture).

**Tests (`fetch` simulé avec `vi.stubGlobal`) :**
- **GitLab :** les uploads sont appelés et le Markdown des fichiers figure dans la description. Une deuxième création renvoie 409.
- **GitHub :** aucun upload, corps contenant le lien Fixi, en-têtes corrects.
- **Anonymisation :** pas d'e-mail, pas de payload, pas de fichier envoyé.
- **Échec du tracker :** 502 et base inchangée.
- **Notification :** dédoublonnage (`A@x.fr` et `a@x.fr` = 1 envoi), un envoi par destinataire, `last_notified_at` mis à jour partout, refus sur un ticket enfant ou au mauvais statut.
- **Mailer sans `SMTP_HOST` :** pas d'exception, log présent.

**Validation :**
- **Alerte admin :** lancer Mailpit en local (`docker run -p 8025:8025 -p 1025:1025 axllent/mailpit`, un faux serveur SMTP qui affiche les e-mails reçus dans une page web), avec `SMTP_HOST=localhost` et `SMTP_PORT=1025`. Envoyer un signalement : l'alerte admin arrive dans Mailpit.
- **Notification groupée :** sur un parent avec 2 doublons et 3 e-mails dont 2 identiques, notifier. Mailpit doit recevoir 2 e-mails.
- **Issues :** sur un projet GitLab de test, puis un dépôt GitHub de test, créer une issue et vérifier la capture (GitLab), les labels, le lien Fixi et le verrou.

---

## Vérification de bout en bout (après le lot 4)

1. `npm run build && npm test` : tout passe au vert.
2. `docker compose up --build`, puis `npm run seed` dans le conteneur. `npm run test-host` sert la page de test.
3. Dans Firefox, sur la page de test : provoquer un fetch 500 et une erreur JS, signaler avec annotation et `Ctrl+V`.
4. L'alerte arrive dans Mailpit. Dans l'admin : badges présents, « Copier pour Cursor », « Copier l'image », rattacher un deuxième signalement en doublon.
5. Créer l'issue (GitLab ou GitHub de test). Passer en Résolu, puis notifier.
6. Dans Shifti en local (WAMP), ajouter le snippet avec l'origine `http://localhost` autorisée. Signaler, puis vérifier que l'application fonctionne normalement.
7. Purge : avancer `updated_at` en SQL sur un ticket résolu, lancer `npm run purge`, vérifier que la ligne et les fichiers sont supprimés.
