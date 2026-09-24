# Audio Marker — Kouchi (Warsh Muhammadi)

Outil web mobile-first pour marquer les timestamps verset par verset d'une récitation, aligné avec le mushaf Muhammadi de ce repo.

## Utilisation

1. Choisir la sourate dans le sélecteur
2. **تحميل** — charge l'audio Kouchi (mp3quran.net) + la liste des آيات
3. Lecture (▶) — écouter jusqu'à la fin de la 1ère آية
4. **MARK** — marque `end[1]` (qui devient automatiquement `start[2]`)
5. Continuer pour les آيات suivantes
6. **↶** Undo si erreur · **Nudges** ±100ms / ±1s pour rattraper la précision

L'autosave localStorage tourne en continu — fermer/reprendre OK.

## Export

- **📋 نسخ JSON** — copie dans le presse-papiers (à coller dans GitHub web editor)
- **📤 مشاركة** — Web Share API Android (Drive, Files, Email…)
- **⬇ تنزيل** — fichier `{NNN}.json` à placer dans `data/timings/kouchi/`

## Convention

`end[N] === start[N+1]` (pas de gap, pas d'overlap). `start[0] = 0`, `end[last]` = durée audio.

## Schema (JSON)

```json
{
  "schema_version": 1,
  "surah": 1,
  "surah_name_ar": "الفاتحة",
  "verse_count": 7,
  "reciter": "el_ayoun_el_kouchi",
  "reciter_name": "El-Ayoun El-Kouchi",
  "audio_url": "https://server11.mp3quran.net/koshi/001.mp3",
  "audio_duration": 56.78,
  "marked_at": "2026-05-12T18:00:00.000Z",
  "marks": [4.123, 8.456, 12.789, ...],
  "timings": [
    { "verse": 1, "start": 0, "end": 4.123 },
    { "verse": 2, "start": 4.123, "end": 8.456 },
    ...
  ],
  "complete": true
}
```

## Dépendances data

- `../../data/surahs.json` — métadonnées 114 sourates
- `../../data/quran_muhammadi.json` — versets Muhammadi (filtré au runtime par sourate)

## Raccourcis (bonus desktop)

`Space` play/pause · `M` / `→` mark · `Z` / `←` undo · `↑/↓` ±1s

## Publier depuis le téléphone (connexion GitHub par code)

L'outil écrit directement dans `data/timings_thumn/…` sur GitHub. Plutôt que de
coller un jeton sur chaque appareil, il utilise le *device flow* : l'écran
affiche un code court, on l'approuve sur `github.com/login/device` depuis un
navigateur déjà connecté, et le jeton arrive tout seul. Il reste sur l'appareil
(`localStorage`), jamais sur le serveur.

Réglage, une seule fois :

1. GitHub → *Settings* → *Developer settings* → *OAuth Apps* → **New OAuth App**
   (compte **ELAHMADI**, propriétaire du dépôt).
   - *Application name* : `nuralhifz thumn marker`
   - *Homepage URL* : `https://audio-marker-nine.vercel.app`
   - *Authorization callback URL* : la même (inutilisée en device flow, mais exigée)
   - après création, cocher **Enable Device Flow**.
2. Copier le **Client ID** (public, pas le secret : il n'en faut aucun).
3. Le Client ID est écrit en clair dans `api/device.js` (`DEFAULT_CLIENT_ID`) :
   c'est une donnée publique, qui apparaît de toute façon dans toute demande
   d'autorisation. Rien à régler sur Vercel. Si l'application est un jour
   recréée, la variable d'environnement `GITHUB_CLIENT_ID` reste prioritaire.

L'OAuth App est créée **sans expiration** des autorisations (case *Expire user
access tokens* décochée) : leur renouvellement exigerait un *client secret*
côté serveur. Une autorisation se révoque depuis
`github.com/settings/applications` → *Authorized OAuth Apps* → *Revoke*, geste
à faire en cas de perte de l'appareil.

Le jeton demandé porte la portée `public_repo` : écriture sur les dépôts publics
uniquement — le dépôt de données est public, rien de plus n'est nécessaire.
