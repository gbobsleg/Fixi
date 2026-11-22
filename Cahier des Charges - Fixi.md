# Cahier des Charges — Fixi (Outil Interne de Signalement de Bugs)

**Nom du service :** Fixi

**Applications cibles :** Flowi, Shifti, hq-app (et toute future application web interne)

**Type de solution :** Service interne auto-hébergé \+ Widget JavaScript mutualisé

**Objectif principal :** Permettre à des utilisateurs non techniques de signaler un bug en 2 clics, tout en fournissant un contexte technique complet exploitable directement par une IA (Cursor), transférable vers GitLab après triage, avec regroupement des doublons et boucle de retour e-mail vers les utilisateurs.

## 1\. Contexte, Principes et Hors-Périmètre

### 1.1 Objectifs clés

1. **Simplicité extrême côté utilisateur :** 2 clics par défaut (ouvrir → écrire un court commentaire → envoyer), sans aucun paramètre obligatoire à remplir.  
2. **Zéro dépendance externe :** 100 % gratuit, auto-hébergé en interne, aucun CDN externe, aucune donnée ne sort du réseau d'entreprise.  
3. **Plug-and-play :** Intégrable dans n'importe quelle stack (CakePHP, Node.js, etc.) via une unique balise `<script>` sans page de paramètres côté application hôte.  
4. **Sas de triage :** Centralisation dans l'interface d'admin protégée de Fixi avant création éventuelle d'une Issue GitLab (évite de polluer les dépôts avec des faux positifs ou des doublons).  
5. **AI-Ready (Cursor) :** Génération d'un rapport Markdown chronologique unifié \+ copie directe de la capture dans le presse-papiers pour un diagnostic instantané dans Cursor.

### 1.2 Hors-périmètre explicite (NE PAS implémenter)

* **Aucun replay vidéo ou DOM** (pas de `rrweb`).  
* **Aucune capture vidéo / micro / écran système** (pas de `getDisplayMedia`).  
* **Aucune synchronisation bidirectionnelle temps réel avec GitLab** (pas de webhooks GitLab).  
* **Aucune modification backend des applications hôtes** (Flowi, Shifti, hq-app) hormis l'ajout de la balise `<script>` dans leur layout.  
* **Aucun tableau de bord analytique / graphiques** et **aucune gestion multi-utilisateurs/rôles** côté admin (un seul compte admin suffit).

## 2\. Architecture Globale

```
+------------------------------------+       +------------------------------------------+
|  Applis Hôtes (Flowi/Shifti/HQ)    |       |           Service Fixi (Interne)         |
|                                    |       |                                          |
|  <script src=".../widget.js"       | POST  |  [API Backend]                           |
|    data-app="shifti"               |------>|   - Validation clé API + CORS            |
|    data-api-key="..."              | form- |   - Stockage PNG & pièces jointes        |
|    data-user="j.dupont (sup)"      | data  |   - Stockage métadonnées (SQLite)        |
|    data-user-email="j@domaine.fr"  |       |   - Alerte e-mail admin immédiate ------>+--> [SMTP Interne]
|    data-version="a3f9c12">         |       |                                          |
|                                    |       |  [Interface Admin / Triage (/admin)]     |
|  [Shadow DOM Widget Fixi]          |       |   - Auth cookie HttpOnly                 |
|   - Languette fixe bord droit      |       |   - Filtres + badges (5xx, JS, doublons) |
|   - Capture DOM (PNG) + Pinceau    |       |   - Regroupement parent/doublons         |
|   - PJ (sélection ou Ctrl+V)       |       |   - Copie Markdown & Image pour Cursor   |
|   - Breadcrumbs (sessionStorage)   |       |   - Création/Lien Issue GitLab --------->+--> [API GitLab]
+------------------------------------+       |   - Notification groupée utilisateurs -->+--> [SMTP Interne]
                                             +------------------------------------------+
```

## 3\. Spécifications Fonctionnelles

### 3.1 Widget Client (Expérience Utilisateur)

* **Point d'entrée :**

  * Languette verticale fixe sur le bord droit de l'écran (centrée verticalement), semi-transparente au repos, opaque au survol.  
  * Libellé explicite : `Un bug ?` ou `Signaler un problème` accompagné d'une icône compréhensible (bouée ou point d'exclamation — pas d'icône d'insecte seule).  
  * Méthode JS exposée `window.Fixi.open()` pour permettre un déclenchement alternatif depuis un header si besoin.  
* **Déclenchement (Clic 1\) :**

  * Au clic sur la languette, la capture d'écran du DOM (`modern-screenshot` ou `html-to-image` bundlé en local) se déclenche **immédiatement en arrière-plan avant d'afficher la modale** (la modale ne doit jamais apparaître sur la capture).  
  * Un discret indicateur de chargement s'affiche pendant la génération du PNG.  
* **Contenu de la modale :**

  1. **Catégorie / Sévérité (pré-sélectionnée) :** Sélecteur visuel compact sur une ligne (pilules/boutons radio) avec **`Bug`** sélectionné par défaut (0 clic requis) :  
     * `Bug` *(défaut)*  
     * `Bloquant`  
     * `Suggestion`  
  2. **Commentaire :** Champ `<textarea>` avec focus automatique et placeholder explicite (*"Que s'est-il passé ? Qu'essayiez-vous de faire ?"*).  
  3. **Capture d'écran \+ Annotation optionnelle :**  
     * Case à cocher **`[x] Joindre la capture d'écran`** (cochée par défaut ; si décochée, l'image n'est pas envoyée au serveur).  
     * Aperçu miniature de la capture avec un bouton/clic **"Annoter / Agrandir"**.  
     * **Mode Annotation :** Ouvre la capture en grand dans un overlay de la modale avec un `<canvas>` superposé. Outils volontairement minimalistes : **uniquement un pinceau rouge** (trait libre pour entourer/pointer), un bouton **Annuler le dernier trait / Effacer**, et un bouton **Valider**. Une fois validée, l'image fusionnée (PNG \+ dessin) remplace la miniature.  
  4. **Pièce jointe manuelle (optionnelle) avec support `Ctrl+V` :**  
     * Discret bouton/zone *"Joindre un fichier ou coller une image (`Ctrl+V`)"* (accepte images, PDF, CSV, Excel, texte — limite 5 Mo, 1 fichier par signalement).  
     * **Support du collage (`paste`) :** Tant que la modale est ouverte, un `Ctrl+V` contenant une image dans le presse-papiers (`clipboardData.items` de type `image/*`) attache automatiquement cette image en pièce jointe (avec aperçu miniature et bouton `×` pour la retirer). Le collage de texte classique dans le `<textarea>` doit continuer de fonctionner normalement sans être intercepté.  
  5. **Actions :** Bouton principal **Envoyer** (Clic 2\) et bouton **Annuler**.  
* **Retour immédiat :**

  * Message de confirmation clair (*"Merci, votre signalement a bien été transmis."*), fermeture automatique après 2 secondes.  
  * En cas d'erreur réseau, message d'erreur explicite conservant la saisie avec possibilité de réessayer.

### 3.2 Collecte Automatique & Format "Cursor-Ready"

Le widget Fixi maintient un tampon circulaire des **40 derniers événements** dans `sessionStorage` (survit aux rechargements de pages sur les applis multi-pages type CakePHP, se vide à la fermeture de l'onglet).

#### Données collectées :

2. **Métadonnées d'environnement :**

   * Application (`data-app`), Utilisateur (`data-user`), E-mail utilisateur (`data-user-email`, optionnel), Version/Commit Git (`data-version`).  
   * URL complète (`window.location.href`), Viewport (`innerWidth` x `innerHeight`), User-Agent, Date/Heure (ISO 8601).  
3. **Chronologie unifiée (Breadcrumbs) :**

   * **`[NAV]`** : Chargements de page et changements d'URL (`popstate`, `pushState`/`replaceState`).  
   * **`[CLICK]`** : Sélecteur exploitable (`tag#id.class[name="..."]`) \+ texte visible du bouton (tronqué à 50 caractères).  
   * **`[NET]`** : Interception légère de `window.fetch` et `XMLHttpRequest` :  
     * Méthode, URL, code HTTP, durée (ms).  
     * **En cas de statut HTTP \>= 400 :**  
       * Capture des **500 premiers caractères du corps de réponse serveur** (erreur SQL, validation, exception).  
       * Capture des **500 premiers caractères du payload envoyé** (`POST`/`PUT`/`PATCH`), **strictement nettoyé** (masquage automatique des clés sensibles).  
       * Lecture passive de l'en-tête de réponse `X-Request-Id` s'il est présent (ignoré sinon, zéro adaptation côté appli hôte).  
   * **`[JS_ERROR]`** : Écoute de `window.error`, `unhandledrejection` et surcharge légère de `console.error` (message \+ fichier \+ ligne/colonne).

#### Format Markdown généré (pour Cursor & GitLab) :

```markdown
# [Fixi] Bug Report - Shifti (#42) [Bloquant]
**Symptôme utilisateur :** "Quand je clique sur valider, la roue tourne et rien ne s'enregistre."
*(Si doublons rattachés : Signalé par 3 utilisateurs)*

## Contexte
- **App :** shifti | **Version (Git) :** `a3f9c12`
- **Catégorie :** Bloquant
- **URL :** https://shifti.interne/plannings/edit/42?week=47
- **Utilisateur :** j.dupont (superviseur) — j.dupont@domaine.fr
- **Viewport :** 1920x1080 | **UA :** Edge 130 / Windows 10
- **Date :** 2026-11-20 14:32:10

## Chronologie (dernières actions avant signalement)
- `[-18.4s]` **[NAV]** Chargement `/plannings/edit/42?week=47`
- `[-12.1s]` **[CLICK]** `select[name="agent_id"]`
- `[-5.2s]` **[CLICK]** `button#btn-save-shift.btn-primary` ("Valider le planning")
- `[-4.8s]` **[NET]** `POST /api/shifts/save` -> **500 Internal Server Error** (412ms) `[X-Request-Id: req_98ab]`
  - Payload: `{"agent_id": 12, "date": "2026-11-21", "shift_type_id": null}`
  - Response: `{"error": "Integrity constraint violation: Column 'shift_type_id' cannot be null"}`
- `[-4.7s]` **[JS_ERROR]`** `TypeError: Cannot read properties of undefined` at `planning-editor.js:142:18`
- `[0.0s]` **[REPORT]** Signalement déclenché
```

&nbsp;

### 3.3 Interface d'Administration Fixi (`/admin`), Triage & Regroupement

Interface web protégée par authentification (identifiant \+ mot de passe hashé en variable d'environnement, cookie de session `HttpOnly`, `SameSite=Lax`).

* **Alerte e-mail admin à réception :**

  * Dès qu'un nouveau signalement arrive sur `POST /api/reports`, envoi asynchrone (non bloquant) d'un e-mail vers `ADMIN_ALERT_EMAIL` (si renseigné) contenant : l'application, la catégorie (`[Bloquant]`, `[Bug]`, etc.), l'utilisateur, un extrait du commentaire, les anomalies détectées (`HTTP 5xx`, `JS Error`) et le lien direct vers la fiche `/admin/reports/:id`.  
* **Tableau de bord (Liste des signalements) :**

  * Filtres combinables : **Application** (`flowi`, `shifti`, `hq-app`), **Statut** (`Nouveau`, `En cours`, `Envoyé GitLab`, `Résolu`, `Non retenu`, `Doublon`), **Catégorie** (`Bug`, `Bloquant`, `Suggestion`), et recherche plein texte.  
  * **Affichage des doublons :** Par défaut, les signalements rattachés à un parent (`parent_id IS NOT NULL`) sont masqués de la liste principale (case à cocher *"Afficher les doublons"* pour les voir). Le signalement parent affiche un badge compteur (ex. `+3 signalements`).  
  * **Badges d'anomalies automatiques :** Affichage visuel immédiat sur chaque ligne des indicateurs :  
    * `Bloquant` (rouge)  
    * `HTTP 5xx` / `HTTP 4xx` (détecté automatiquement dans la timeline à réception)  
    * `JS Error` (détecté automatiquement dans la timeline à réception)  
    * `+X doublons` (si enfants rattachés)  
    * `PJ` (si pièce jointe manuelle présente)  
    * Badge/lien direct `GitLab #iid` si lié à une issue.  
* **Fiche détaillée d'un signalement :**

  * **Visuels & Outils rapides pour Cursor :**  
    * Aperçu de la capture PNG cliquable pour ouvrir une **Lightbox plein écran** (zoom confortable pour lire les petits textes).  
    * **Bouton "Copier pour Cursor"** : copie dans le presse-papiers le rapport Markdown formaté.  
    * **Bouton "Copier l'image"** : copie directement le PNG de la capture dans le presse-papiers (via `navigator.clipboard.write` avec `ClipboardItem`) pour faire `Ctrl+V` dans Cursor sans télécharger le fichier.  
    * **Bouton "Télécharger .md"** \+ téléchargement de la capture et de la pièce jointe manuelle (si présente).  
  * **Regroupement des doublons (Relation Parent / Enfant à 1 niveau) :**  
    * Sur un signalement sans enfants, action **"Rattacher comme doublon de..."** (sélecteur/recherche par ID ou commentaire parmi les tickets parents de la même application).  
    * Le rattachement remplit `parent_id`, passe automatiquement le statut à `Doublon`, et empêche cet enfant de devenir lui-même parent (1 seul niveau de profondeur, zéro récursivité). Bouton **"Détacher"** disponible en cas d'erreur.  
    * Sur un signalement parent, section **"Signalements rattachés (X)"** listant les doublons (auteur, date, extrait, lien vers la fiche pour consulter leur capture/timeline).  
  * **Intégration GitLab (API ou lien manuel) :**  
    * **Option A — Créer une Issue GitLab :** Ouvre une confirmation permettant d'éditer le titre (pré-rempli) et les labels (pré-remplis depuis la config de l'app). Upload la capture PNG (et la PJ si présente) sur GitLab, puis crée l'issue en mentionnant le nombre total d'utilisateurs impactés si des doublons sont rattachés. Enregistre `gitlab_issue_iid` et `gitlab_issue_url`, passe le statut à `Envoyé GitLab`, et verrouille le bouton de création (anti-doublon).  
    * **Option B — Lier une Issue existante manuellement :** Champ éditable permettant de coller directement l'URL d'une Issue GitLab existante (non unique : plusieurs tickets peuvent pointer vers la même URL).  
    * Les tickets enfants affichent automatiquement le lien GitLab de leur parent.  
  * **Statut & Notes internes privées :**  
    * Sélecteur de statut.  
    * **Champ "Notes internes"** : texte libre sauvegardé uniquement en base locale pour noter des pistes de reproduction ou des échanges oraux. **Strictement privé** : n'est jamais inclus dans le Markdown Cursor, ni dans l'Issue GitLab, ni dans les e-mails utilisateurs.  
  * **Boucle de feedback e-mail (individuelle ou groupée) :**  
    * Panneau **"Notifier l'(les) utilisateur(s)"** actif si le ticket (ou au moins un de ses doublons rattachés) possède un `user_email`.  
    * Affiche clairement la liste des destinataires qui seront notifiés (auteur du parent \+ auteurs de tous les doublons rattachés, adresses **dédoublonnées**).  
    * Permet d'envoyer un e-mail via le SMTP interne lors du passage en `Résolu` ou `Non retenu`, avec un message pré-rempli éditable. Met à jour `last_notified_at` sur le parent et ses doublons pour éviter les envois multiples accidentels.  
* **Page Paramètres (unique et centralisée) :**

  * CRUD des applications : `slug`, `name`, `api_key` (générable en 1 clic), `allowed_origins` (CORS), `gitlab_project_id`, `gitlab_default_labels`.  
  * Affichage du snippet `<script>` Fixi prêt à copier-coller pour chaque application.

## 4\. Spécifications Techniques & Sécurité

### 4.1 Intégration sur les applications hôtes

Une unique balise dans le layout global de chaque appli :

```html
<script 
  src="https://fixi.interne/widget.js"
  data-app="shifti"
  data-api-key="cle_publique_shifti"
  data-user="j.dupont (superviseur)"
  data-user-email="j.dupont@domaine.fr"
  data-version="a3f9c12"
  defer>
</script>
```

### 4.2 Contraintes techniques du Widget

* **Isolation CSS absolue :** Encapsulation complète de la languette, de la modale et de l'overlay d'annotation dans un **Shadow DOM** (`attachShadow({ mode: 'open' })`).  
* **Vanilla JS autonome :** Zéro dépendance à React/Vue/Bootstrap. Librairie de capture (`modern-screenshot`) bundlée directement dans `widget.js` (un seul fichier servi par le backend Fixi).  
* **Tolérance aux pannes :** Tout le code du widget doit être encapsulé dans des `try/catch` afin qu'une erreur de Fixi ne perturbe **jamais** le fonctionnement de l'application hôte.

### 4.3 Sécurité, Nettoyage des données & RGPD

* **Protection de `/admin` :** Authentification obligatoire sur toutes les routes `/admin` et `/api/admin/*`. Mot de passe stocké hashé (bcrypt/scrypt/argon2) dans les variables d'environnement, cookie de session signé `HttpOnly` \+ `SameSite=Lax`.  
* **Validation & CORS :** Vérification stricte de `Origin` (liste `allowed_origins` de l'app) \+ couple `data-app` / `data-api-key`. Rate-limiting basique sur `POST /api/reports`.  
* **Masquage des données sensibles (côté client avant envoi) :**  
  * Ne jamais lire les valeurs des `<input type="password">`.  
  * Fonction de nettoyage récursive sur les payloads JSON/FormData capturés : remplacer par `"[REDACTED]"` toute valeur dont la clé contient (insensible à la casse) : `password`, `passwd`, `pwd`, `token`, `secret`, `auth`, `authorization`, `cookie`, `csrf`, `api_key`, `apikey`.  
  * Support de l'attribut HTML `data-fixi-mask` sur l'appli hôte pour masquer un élément lors de la capture si nécessaire.  
* **Sécurité des uploads :** Validation côté serveur du type MIME réel et de la taille (PNG capture max 5 Mo, pièce jointe manuelle max 5 Mo), renommage aléatoire (UUID) des fichiers stockés hors racine web publique (servis uniquement via routes admin authentifiées).  
* **Purge automatique :** Tâche planifiée (cron ou job interne) supprimant les fichiers (PNG \+ pièces jointes) et les rapports clôturés (`Résolu` / `Non retenu` / `Doublon` dont le parent est clôturé) vieux de plus de **90 jours** (configurable par variable d'environnement).

### 4.4 Modèle de Données (SQLite)

* **Table `apps` :**

  * `id` (PK), `slug` (UNIQUE), `name`, `api_key`, `allowed_origins` (texte/JSON), `gitlab_project_id`, `gitlab_default_labels`, `created_at`.  
* **Table `bug_reports` :**

  * `id` (PK), `app_id` (FK → `apps.id`), `parent_id` (FK nullable → `bug_reports.id`, 1 niveau max)  
  * `category` (`bug` \| `blocking` \| `suggestion`)  
  * `status` (`new` \| `in_progress` \| `gitlab` \| `resolved` \| `rejected` \| `duplicate`)  
  * `comment`, `user_info`, `user_email`, `app_version`, `url`, `user_agent`, `viewport`  
  * `screenshot_path` (nullable), `attachment_path` (nullable), `attachment_original_name` (nullable)  
  * `timeline_json`  
  * `has_http_error` (BOOLEAN, calculé à l'insertion si un événement `[NET]` a un statut \>= 400\)  
  * `has_js_error` (BOOLEAN, calculé à l'insertion si un événement `[JS_ERROR]` est présent)  
  * `gitlab_issue_iid` (nullable), `gitlab_issue_url` (nullable, non unique)  
  * `admin_notes` (nullable, strictement privé)  
  * `last_notified_at` (nullable)  
  * `created_at`, `updated_at`.

### 4.5 Contrats d'API (Backend)

* **Public (CORS restreint \+ API Key) :**

  * `GET /widget.js` — Sert le script Fixi bundlé.  
  * `POST /api/reports` — Reçoit un `multipart/form-data` (`payload` JSON \+ `screenshot` PNG optionnel \+ `attachment` fichier optionnel). Calcule `has_http_error` / `has_js_error` et déclenche l'alerte e-mail admin en arrière-plan.  
* **Auth Admin :**

  * `POST /api/admin/login` / `POST /api/admin/logout` / `GET /api/admin/me`  
* **Admin (Authentifié) :**

  * `GET /api/admin/reports` — Liste paginée avec filtres (`app_id`, `status`, `category`, `q`, `include_duplicates`), retourne le compteur `duplicates_count` pour chaque parent.  
  * `GET /api/admin/reports/:id` — Détail complet, liste des doublons rattachés (ou lien vers le parent), et Markdown Cursor-Ready.  
  * `PATCH /api/admin/reports/:id` — Mise à jour `status`, `admin_notes`, `gitlab_issue_url` (manuel), et `parent_id` (rattachement/détachement avec validation anti-chaînage).  
  * `GET /api/admin/files/:filename` — Sert de manière sécurisée les PNG et pièces jointes.  
  * `POST /api/admin/reports/:id/gitlab` — Upload PNG (+ PJ si présente) vers `POST /api/v4/projects/:id/uploads`, puis création de l'issue via `POST /api/v4/projects/:id/issues`.  
  * `POST /api/admin/reports/:id/notify` — Envoi groupé via SMTP interne au parent \+ tous ses doublons rattachés (e-mails dédoublonnés), mise à jour de `last_notified_at`.  
  * `GET/POST/PUT/DELETE /api/admin/apps` — Gestion des applications configurées.

### 4.6 Variables d'environnement serveur

* `PORT`, `APP_BASE_URL` (ex. `https://fixi.interne`, utilisé pour les liens dans les e-mails d'alerte)  
* `ADMIN_USER`, `ADMIN_PASSWORD_HASH`, `SESSION_SECRET`, `ADMIN_ALERT_EMAIL`  
* `GITLAB_URL` (ex. `https://gitlab.interne`), `GITLAB_TOKEN`  
* `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`  
* `RETENTION_DAYS=90`, `STORAGE_DIR=./storage`

## 5\. Découpage Recommandé pour l'Implémentation (Plan Cursor)

Bien que le périmètre soit livré en une seule version complète, l'implémentation doit être exécutée et validée séquentiellement en **4 lots stricts** :

1. **Lot 1 — Socle Backend, Base de données & Réception :**

   * Initialisation du projet Fixi, schéma SQLite (`apps`, `bug_reports` avec `parent_id`, `has_http_error`, `has_js_error`), auth admin (cookie `HttpOnly`), CRUD `apps`, endpoint `POST /api/reports` (CORS dynamique, validation clé API, upload sécurisé PNG \+ PJ), job de purge 90 jours.  
2. **Lot 2 — Widget Client (`widget.js`) :**

   * Bundle autonome avec `modern-screenshot`, Shadow DOM, languette bord droit, méthode `window.Fixi.open()`, collecte `sessionStorage` (NAV, CLICK, NET avec payload nettoyé \+ réponse \>= 400 \+ `X-Request-Id` passif, JS\_ERROR).  
   * Modale 2 clics : catégorie par défaut, checkbox capture cochée par défaut, overlay `<canvas>` avec pinceau rouge \+ effacer, pièce jointe optionnelle avec **support `Ctrl+V` d'image**, envoi `multipart/form-data`.  
   * Page HTML de test simulant une appli hôte (avec Bootstrap 5 \+ erreurs JS/HTTP provoquées).  
3. **Lot 3 — Interface Admin, Regroupement & Outils Cursor :**

   * Écran de login, tableau de bord filtrable avec masquage des doublons par défaut et badges d'anomalies (`HTTP 5xx`, `JS Error`, `+X doublons`, `PJ`).  
   * Fiche détaillée : lightbox plein écran, boutons **"Copier pour Cursor"** et **"Copier l'image"**, téléchargement `.md`, rattachement/détachement de doublons (`parent_id`), édition manuelle de `gitlab_issue_url`, notes internes privées, page Paramètres `apps`.  
4. **Lot 4 — Intégrations Externes (GitLab & SMTP) :**

   * Connecteur API GitLab (upload fichiers \+ création Issue avec compteur d'utilisateurs impactés \+ verrouillage anti-doublon).  
   * Connecteur SMTP interne : alerte e-mail admin à la réception d'un nouveau ticket \+ notification e-mail groupée (parent \+ doublons dédoublonnés) depuis la fiche ticket.