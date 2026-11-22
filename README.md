# Fixi

Service interne de signalement de bugs : un widget JS mutualisé, un backend Node auto-hébergé et une interface d'admin de triage.

Spécification : [Cahier des Charges - Fixi.md](Cahier%20des%20Charges%20-%20Fixi.md). Plan d'implémentation : [PLAN.md](PLAN.md).

> État : **Lots 1 et 2** (backend, réception des signalements, widget). L'admin et les intégrations GitLab/GitHub/SMTP arrivent dans les lots 3 et 4.

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
- `data-fixi-mask` sur un élément le remplace par un bloc gris dans la capture d'écran.
- Les champs mot de passe ne sont jamais lus. Les clés `password`, `token`, `secret`, `auth`, `cookie`, `csrf`, `api_key`… sont remplacées par `[REDACTED]` avant tout envoi.

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

Voir [.env.example](.env.example). Fixi refuse de démarrer, avec un message clair, s'il manque `APP_BASE_URL`, `ADMIN_USER`, `ADMIN_PASSWORD_HASH` ou `SESSION_SECRET`. Le SMTP est optionnel.
