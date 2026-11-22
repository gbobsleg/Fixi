# Fixi

Service interne de signalement de bugs : un widget JS mutualisé, un backend Node auto-hébergé et une interface d'admin de triage.

Spécification : [Cahier des Charges - Fixi.md](Cahier%20des%20Charges%20-%20Fixi.md). Plan d'implémentation : [PLAN.md](PLAN.md).

> État : **Lot 1** (socle backend, base SQLite, réception des signalements). Le widget, l'admin et les intégrations arrivent dans les lots 2 à 4.

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
| `npm run dev` | Serveur en mode watch |
| `npm run build` / `npm start` | Compilation dans `dist/`, puis démarrage |
| `npm test` | Tests (Vitest) |
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
