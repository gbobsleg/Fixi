# Fixi

Service interne de signalement de bugs : un widget JS mutualisé, un backend Node auto-hébergé et une interface d'admin de triage.

Spécification : [Cahier des Charges - Fixi.md](Cahier%20des%20Charges%20-%20Fixi.md). Plan d'implémentation : [PLAN.md](PLAN.md).

> État : **Lots 1 à 4** (backend, widget, admin de triage, intégrations GitLab/GitHub et SMTP).

## Intégrer le widget dans une application

Une seule balise dans le layout global de l'application hôte (aucun autre changement) :

```html
<script
  src="https://fixi.interne/widget.js"
  data-app="shifti"
  data-api-key="CLE_DE_L_APPLICATION"
  data-user="j.dupont (superviseur)"
  data-user-email="j.dupont@domaine.fr"
  data-version="a3f9c12"
  defer></script>
```

- `data-app` et `data-api-key` sont obligatoires. Les autres attributs sont facultatifs.
- L'origine de l'application (ex. `https://shifti.interne`) doit figurer dans les `allowed_origins` de l'application côté Fixi.
- `window.Fixi.open()` ouvre la fenêtre depuis un bouton de l'application.
- `data-fixi-mask` sur un élément le remplace par un bloc gris dans la capture d'écran. Un clic dans cette zone n'enregistre pas son texte dans la chronologie, seulement son sélecteur.
- Les champs mot de passe ne sont jamais lus. Les clés `password`, `token`, `secret`, `auth`, `cookie`, `csrf`, `api_key`… sont remplacées par `[REDACTED]` avant tout envoi. `pin` l'est aussi, mais seulement comme mot entier de la clé : `pin`, `supervisor_pin`, `newPin`, `pin-code` sont caviardés ; `spinner` ou `shipping` ne le sont pas.
- `data-redact-keys` (facultatif) ajoute des clés à caviarder, séparées par des virgules. Exemple : `data-redact-keys="query,agent_matricule,nom,prenom"`.
  - Elles s'appliquent aux paramètres d'URL (requêtes réseau, navigation, URL de la page), aux corps de requête et de réponse, et au texte libre (`nom: Dupont`).
  - La comparaison porte sur la clé **entière**, sans tenir compte de la casse : `nom` caviarde `nom` et `NOM`, pas `nombre` ni `nomOffre`.
  - L'attribut est relu à chaque événement enregistré : il peut être modifié après le chargement.
  - Le caviardage a lieu dans le navigateur, avant tout stockage. Les valeurs placées dans le **chemin** d'une URL (`/agents/12345`) ne sont pas couvertes.

## Démarrage local

```bash
npm install
cp .env.example .env          # puis renseigner ADMIN_PASSWORD_HASH et SESSION_SECRET
npm run hash-password         # génère le hash du mot de passe admin
npm run seed                  # crée les applications shifti et flowi et affiche leurs clés
npm run dev                   # http://localhost:3000
```

Dans `.env`, le hash bcrypt doit être entre **guillemets simples** (il contient des `$`) :

```
ADMIN_PASSWORD_HASH='$2b$12$...'
```

## Scripts

| Commande | Rôle |
|---|---|
| `npm run dev` | Serveur et bundle du widget en mode watch |
| `npm run build` / `npm start` | Compilation (serveur + `dist/public/widget.js`), puis démarrage |
| `npm run test-host` | Page de test qui simule une appli hôte, sur http://localhost:5173 (après `npm run seed` et `npm run dev`) |
| `npm test` | Tests unitaires et d'API (Vitest) |
| `npm run test:e2e` | Test du widget dans un vrai navigateur (Edge installé sur la machine, rien à télécharger) |
| `npm run typecheck` | Vérification TypeScript |
| `npm run seed` | Crée les applications de dev |
| `npm run hash-password` | Génère `ADMIN_PASSWORD_HASH` |
| `npm run purge` | Lance la purge manuellement |

## Docker

```bash
docker compose up --build
```

Un volume pour `data/` (SQLite) et un pour `storage/` (captures et pièces jointes). Fixi doit tourner derrière un reverse proxy HTTPS : `TRUST_PROXY=true` est déjà activé dans l'image.
Dans un `docker-compose.yml`, chaque `$` d'un hash écrit en ligne doit être doublé (`$$`). Avec `env_file: .env` et des guillemets simples, aucun échappement n'est nécessaire.

## Variables d'environnement

Voir [.env.example](.env.example). Fixi refuse de démarrer, avec un message clair, s'il manque `APP_BASE_URL`, `ADMIN_USER`, `ADMIN_PASSWORD_HASH` ou `SESSION_SECRET`. Le SMTP et les trackers sont optionnels.

## Intégrer le widget dans Shifti (WAMP) et Flowi (Docker)

1. Page **Paramètres** de l'admin : créer l'application, renseigner ses origines autorisées, copier le snippet.
2. Coller le snippet dans le layout global (une seule fois). Les valeurs `data-user`, `data-user-email` et `data-version` viennent de l'application hôte (ex. CakePHP : `<?= h($user) ?>`).
3. **Shifti en local sous WAMP** : ajouter `http://localhost` aux origines autorisées. **Flowi sous Docker** : ajouter l'origine telle que le navigateur la voit (ex. `http://localhost:8080`). Sans cela, l'envoi est refusé (403).

## Trackers d'issues (GitLab et GitHub)

Chaque application choisit son tracker dans **Paramètres** (GitLab, GitHub ou aucun), avec son projet et ses labels par défaut. Les tokens sont globaux, en variables d'environnement.

| Tracker | Variables | Projet | Token à créer |
|---|---|---|---|
| GitLab | `GITLAB_URL`, `GITLAB_TOKEN` | id numérique (`42`) ou chemin (`groupe/projet`) | Personal ou Project access token, portée **`api`** |
| GitHub | `GITHUB_TOKEN` (`GITHUB_API_URL` pour GitHub Enterprise) | `owner/repo` | Fine-grained token, permission **Issues : lecture et écriture** sur le dépôt |

- GitLab : la capture et la pièce jointe sont envoyées avec l'issue. GitHub ne sait pas héberger de fichiers : l'issue contient un lien vers la fiche Fixi.
- Option **Anonymiser** par application : l'issue ne contient alors ni utilisateur, ni e-mail, ni payload, ni réponse serveur, ni capture.
- Les `@mentions` du commentaire sont neutralisées (un `@all` ne notifie personne).
- Une issue est créée une seule fois par signalement (le bouton disparaît ensuite). Si le tracker échoue, rien n'est modifié dans Fixi et le message d'erreur est affiché.

## E-mails (SMTP)

Sans `SMTP_HOST`, Fixi démarre quand même : les e-mails sont écrits dans les logs au lieu d'être envoyés.

- **Alerte admin** : à chaque nouveau signalement, si `ADMIN_ALERT_EMAIL` est défini.
- **Notification des utilisateurs** : depuis la fiche d'un signalement « Résolu » ou « Non retenu ». Un e-mail individuel par destinataire (adresses dédoublonnées, parent et doublons). `{{date}}` dans le message est remplacé par la date du signalement de chaque destinataire. En cas d'échec partiel, les adresses concernées sont affichées ; la date de dernière notification n'est mise à jour que si au moins un e-mail est parti.

Test local avec [Mailpit](https://mailpit.axllent.org/) :

```bash
docker run -p 8025:8025 -p 1025:1025 axllent/mailpit
# .env : SMTP_HOST=localhost, SMTP_PORT=1025, ADMIN_ALERT_EMAIL=admin@exemple.fr
# les e-mails apparaissent sur http://localhost:8025
```

## Déploiement derrière un reverse proxy

Fixi écoute en HTTP sur le port 3000 : placer un proxy HTTPS devant (nginx, Traefik, Caddy). `APP_BASE_URL` doit être l'URL publique (liens des e-mails, contrôle d'origine de l'admin). `TRUST_PROXY=true` (déjà activé dans l'image) est nécessaire pour que la limitation de débit voie la vraie IP des clients. Exemple nginx :

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  client_max_body_size 12m;   # capture + pièce jointe de 5 Mo chacune
}
```
