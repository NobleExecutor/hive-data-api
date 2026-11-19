# hive-data-api

API Node.js qui **simule les capteurs de ruches connectées** pour l'application web du projet SAE 3D01 (BUT MMI).

Chaque ruche enregistrée produit **deux relevés par jour, à 08:00 et 20:00** (heure de Paris) : température, poids, humidité et fréquence sonore. Rien n'est stocké : les relevés sont **calculés à la demande**, de façon **déterministe** (la même requête renvoie toujours les mêmes valeurs), à partir de séries de référence rejouées avec une « personnalité » propre à chaque ruche et un léger bruit reproductible.

> Les vraies séries de mesures (2024) ne sont **pas publiées** dans ce dépôt. Le fichier `data/series.sample.json` contient des valeurs **inventées**, du même ordre de grandeur, pour pouvoir lancer l'API en local.

## Stack

Node.js (LTS) · Express 5 · SQLite (`better-sqlite3`, liste des ruches uniquement) · luxon · seedrandom · zod · helmet · express-rate-limit · tests avec vitest + supertest.

## Lancer en local

```bash
npm install
cp .env.example .env
```

Générer une clé et la coller dans `API_KEY` du `.env` :

```bash
openssl rand -hex 32
```

Puis :

```bash
npm run dev     # redémarre à chaque modification
npm start       # lancement simple
npm test        # tests
```

L'API écoute sur `http://127.0.0.1:3000`. Au démarrage, elle s'arrête avec un message clair si la clé manque ou est trop courte, ou si le fichier de séries est absent ou invalide.

### Variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `3000` | Port d'écoute |
| `HOST` | `127.0.0.1` | Adresse d'écoute (en production : `172.17.0.1`, joignable seulement par le VPS et ses conteneurs) |
| `TRUST_PROXY` | `loopback` | Proxys autorisés à fournir l'IP du client (`X-Forwarded-For`) ; en production : `loopback, uniquelocal` |
| `API_KEY` | — | Clé partagée avec l'application PHP, 32 caractères minimum |
| `TZ` | `Europe/Paris` | Fuseau des créneaux 08:00 / 20:00 |
| `SERIES_PATH` | `data/series.sample.json` | Pool de séries de référence |
| `DB_PATH` | `data/api.db` | Base SQLite |
| `MAX_HIVES` | `200` | Nombre maximal de ruches |
| `HISTORY_DAYS` | `30` | Jours d'historique disponibles dès la création |

## Endpoints

Préfixe : `/api/v1`. Tout exige l'en-tête `X-API-Key`, sauf `/health`.

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/health` | `{ "status": "ok" }` |
| POST | `/hives` | Enregistre une ruche → **201** |
| GET | `/hives` | Liste des ruches → `{ "hives": [...] }` |
| GET | `/hives/:serial` | Infos d'une ruche |
| DELETE | `/hives/:serial` | Supprime une ruche → **204** |
| GET | `/hives/:serial/readings?from=&to=` | Relevés d'une ruche |
| GET | `/readings?serials=…&since=` | Relevés de plusieurs ruches (synchro) |

### Exemples

```bash
export API_KEY=…   # la clé du .env
```

Enregistrer une ruche (coordonnées d'exemple) :

```bash
curl -X POST http://127.0.0.1:3000/api/v1/hives -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" -d '{"serial":"000004","gps":[48.85,2.35]}'
```

```json
{ "serial": "000004", "gps": [48.85, 2.35],
  "created_at": "2026-11-19T15:00:00+01:00", "history_start": "2026-10-20T00:00:00+02:00" }
```

Lister les ruches :

```bash
curl -H "X-API-Key: $API_KEY" http://127.0.0.1:3000/api/v1/hives
```

Relevés d'une ruche sur une période :

```bash
curl -H "X-API-Key: $API_KEY" "http://127.0.0.1:3000/api/v1/hives/000004/readings?from=2026-11-01&to=2026-11-07"
```

Synchro de plusieurs ruches depuis le dernier relevé connu :

```bash
curl -H "X-API-Key: $API_KEY" "http://127.0.0.1:3000/api/v1/readings?serials=000004,000005&since=2026-11-19T08:00:00"
```

```json
{ "000004": { "gps": [48.85, 2.35], "data": [
  { "date": "2026-11-19T20:00:00", "temperature": 21, "poids": 15.6, "humidite": 82, "frequence": 230 } ] } }
```

### Règles

- **Relevés** : dates au format `AAAA-MM-JJTHH:mm:ss`, heure de Paris, sans fuseau. Champs en français : `temperature` (°C, entier), `poids` (kg, 1 décimale), `humidite` (%, entier), `frequence` (Hz, entier).
- **Disponibilité** : un créneau n'apparaît qu'une fois son heure passée. L'historique commence à `history_start` = date de création − 30 jours, à 00:00.
- **`from` / `to`** : bornes incluses. Une date seule pour `to` (`2026-11-07`) couvre toute la journée. Sans fuseau, les dates sont lues en heure de Paris.
- **`since`** : relevés **strictement après** cette date ; sans `since`, tout depuis `history_start`. 50 ruches maximum par requête, toutes enregistrées.
- **`created_at` / `history_start`** : ISO 8601 avec le décalage horaire de Paris.

### Erreurs

Format : `{ "error": { "code": "...", "message": "..." } }`

| Statut | Code | Cas |
|---|---|---|
| 400 | `bad_request`, `invalid_json` | Requête mal formée (champ manquant, inconnu ou de mauvais type, JSON invalide) |
| 401 | `unauthorized` | Clé absente ou invalide |
| 404 | `hive_not_found`, `not_found` | Ruche ou route inconnue |
| 409 | `hive_exists`, `hive_limit` | Numéro déjà pris, plafond atteint |
| 413 | `payload_too_large` | Corps de plus de 10 Ko |
| 422 | `validation_error` | Valeur invalide (numéro ≠ 6 chiffres, GPS hors bornes, date invalide…) |
| 429 | `too_many_requests` | Trop de requêtes |

## Génération des relevés

1. **Série source** : un hash du numéro de ruche choisit une série du pool (même numéro → même série).
2. **Rejeu** : le relevé de référence est celui du même créneau dans la série source — par jour de l'année si la série couvre au moins un an (le 29/02 reprend le 28/02), sinon en boucle.
3. **Personnalité** : décalages constants par ruche (température ±1 °C, poids ±3 kg, humidité ±3 %, fréquence ±15 Hz).
4. **Bruit** : variation par relevé (±1 °C, ±0,1 kg, ±2 %, ±10 Hz), tirée d'une graine `numéro + date + créneau`. Jamais `Math.random()`.
5. **Bornage et arrondi** : poids > 0, humidité entre 0 et 100, valeurs entières sauf le poids.

## Sécurité

- Clé API comparée en temps constant (`crypto.timingSafeEqual` sur des empreintes SHA-256), jamais loggée.
- `helmet`, limite de requêtes globale et plus stricte sur `POST` / `DELETE`, plafond de ruches.
- Validation stricte des entrées (zod), champs inconnus refusés, corps limité à 10 Ko.
- Requêtes SQL préparées uniquement.
- Aucune trace interne dans les réponses ; ni GPS ni clé dans les logs.
- En production, l'API n'est pas exposée sur Internet : elle écoute sur l'interface Docker du VPS, derrière Caddy (HTTPS).
- L'IP du client n'est lue dans `X-Forwarded-For` que si la requête vient d'un proxy de confiance (`TRUST_PROXY`) : impossible de contourner la limite de requêtes en falsifiant cet en-tête.

## Déploiement

Sur le VPS : l'API tourne sur l'hôte avec PM2 (Node LTS), derrière **Caddy dans Docker**, qui gère le HTTPS.

```bash
./deploy.sh
```

Le script fait `git pull`, `npm ci --omit=dev` puis recharge l'API avec PM2 (`ecosystem.config.cjs`). Le `.env` et le fichier de séries réel (`data/series.json`, référencé par `SERIES_PATH`) sont copiés à la main sur le serveur et ne passent jamais par Git.

### Première mise en place derrière Caddy (Docker)

Dans le conteneur Caddy, `127.0.0.1` désigne le conteneur lui-même : l'API écoute donc sur l'adresse de l'hôte sur le réseau Docker (`ip -4 addr show docker0`, en général `172.17.0.1`).

1. **DNS** : un enregistrement A `api.mondomaine.fr` vers l'IP du VPS.
2. **`.env`** :
   ```env
   HOST=172.17.0.1
   PORT=3000
   TRUST_PROXY=loopback, uniquelocal
   SERIES_PATH=data/series.json
   ```
   Ne pas utiliser `HOST=0.0.0.0` : l'API serait exposée sur Internet si le pare-feu le permet.
3. **API** : `./deploy.sh`, puis une seule fois `pm2 startup` (lancer la commande `sudo` affichée) pour un redémarrage automatique au boot. Vérifier : `curl http://172.17.0.1:3000/api/v1/health`.
4. **Caddy** : dans le `docker-compose.yml`, ajouter au service Caddy :
   ```yaml
       extra_hosts:
         - "host.docker.internal:host-gateway"
   ```
   puis `docker compose up -d caddy`. Ajouter au Caddyfile :
   ```caddy
   api.mondomaine.fr {
   	reverse_proxy host.docker.internal:3000
   }
   ```
   Valider puis recharger (remplacer `caddy` par le nom du conteneur, et le chemin par celui où le Caddyfile est monté, voir `docker inspect caddy`) :
   ```bash
   docker exec caddy caddy validate --config /etc/caddy/Caddyfile
   docker exec caddy caddy reload --config /etc/caddy/Caddyfile
   ```
   Caddy obtient le certificat HTTPS tout seul.
5. **Pare-feu** : si `ufw` est actif, autoriser les conteneurs (et eux seuls) à joindre l'API :
   ```bash
   sudo ufw allow from 172.16.0.0/12 to 172.17.0.1 port 3000 proto tcp
   ```
6. **Tests** :
   ```bash
   docker exec caddy wget -qO- http://host.docker.internal:3000/api/v1/health
   curl https://api.mondomaine.fr/api/v1/health
   ```

Après un redémarrage du VPS, vérifier `pm2 status` : l'API ne peut démarrer qu'une fois Docker lancé (`restart_delay` laisse le temps à `docker0` d'apparaître).

## Structure

```
src/
  server.js        démarrage
  app.js           application Express (utilisée par les tests)
  config.js        lecture et validation du .env
  middleware/      clé API, rate limit, erreurs
  routes/          health, hives, readings
  db/              SQLite (migration, dépôt des ruches)
  engine/          séries, créneaux, génération des relevés
  validation/      schémas zod
tests/             vitest + supertest
data/              series.sample.json (fictif) ; series.json et api.db ignorés par Git
```
