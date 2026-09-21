/* Genere data/audio_status.json depuis la PRESENCE des fichiers
 * data/timings_thumn/{reciter}/{NNN}.json.
 *
 * A relancer apres chaque ajout de sourate — sinon le manifeste redevient
 * faux et la page de couverture de l'app sous-rapporte.
 *
 *   node tools/gen-audio-status.mjs            (dry-run, affiche le diff)
 *   node tools/gen-audio-status.mjs --write
 *
 * Regle centrale : un ثمن n'est jouable que si TOUTES les sourates qu'il
 * traverse sont marquees. 36 sourates marquees ne donnent que 11 ثمن
 * jouables — d'ou l'exposition de `eighths_playable` en plus de `done`.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'data', 'audio_status.json')
// 3e recitant : Yassine Al-Jazairi (ياسين الجزائري) remplace Hicham El-Harraz
// (decision 2026-09-21). Ses fichiers iront dans data/timings_thumn/jazairi/.
const RECITERS = ['kouchi', 'benkirane', 'jazairi']
const WRITE = process.argv.includes('--write')

const er = JSON.parse(readFileSync(join(ROOT, 'data', 'eighths.json'), 'utf8'))
const EIGHTHS = Array.isArray(er) ? er : er.eighths

// sourates traversees par chaque ثمن
const surahsOf = new Map()
for (const t of EIGHTHS) {
  surahsOf.set(t.eighth_id, [...new Set(t.verses_covered.map(v => v.sura))].sort((a, b) => a - b))
}

// Un fichier peut etre PARTIEL (complete:false) : sourate longue publiee
// hizb par hizb. Un segment est disponible des que start ET end sont des
// nombres. On retient donc, par sourate, les eighth_id chronometres.
function scan(reciter) {
  const dir = join(ROOT, 'data', 'timings_thumn', reciter)
  if (!existsSync(dir)) return { done: [], partial: [], timedBySurah: new Map(), problems: [] }
  const done = [], partial = [], problems = []
  const timedBySurah = new Map()
  for (const f of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
    const n = parseInt(f, 10)
    try {
      const p = JSON.parse(readFileSync(join(dir, f), 'utf8'))
      if (p.surah !== n) { problems.push(`${f}: champ surah=${p.surah} ne correspond pas au nom de fichier`); continue }
      const timed = (p.segments || []).filter(s => typeof s.start === 'number' && typeof s.end === 'number').map(s => s.eighth_id)
      timedBySurah.set(n, new Set(timed))
      if (p.complete === true) done.push(n)
      else if (timed.length) partial.push(n)
      else problems.push(`${f}: aucun segment chronometre, ignore`)
    } catch (e) {
      problems.push(`${f}: illisible (${e.message})`)
    }
  }
  return { done: done.sort((a, b) => a - b), partial: partial.sort((a, b) => a - b), timedBySurah, problems }
}

const reciters = {}
let allProblems = []
for (const r of RECITERS) {
  const { done, partial, timedBySurah, problems } = scan(r)
  allProblems = allProblems.concat(problems.map(p => `${r}/${p}`))
  // Jouable = chronometre dans CHACUNE des sourates qu'il traverse
  const playable = [...surahsOf]
    .filter(([id, surs]) => surs.every(s => timedBySurah.get(s)?.has(id)))
    .map(([id]) => id).sort((a, b) => a - b)
  reciters[r] = {
    done,                 // sourates COMPLETES (forme conservee pour l'app)
    in_progress: partial, // sourates publiees partiellement
    surah_count: done.length,
    eighths_playable: playable.length,
    eighths_playable_ids: playable,
  }
}

const manifest = {
  schema_version: 2,
  granularity: 'thumn',
  updated_at: new Date().toISOString().slice(0, 10),
  note: "Etat de couverture audio par ثمن. Genere automatiquement par tools/gen-audio-status.mjs depuis les fichiers data/timings_thumn/{reciter}/{NNN}.json — ne pas editer a la main. 'done' = sourates completes. 'in_progress' = sourates publiees PARTIELLEMENT (complete:false) : seuls leurs segments ayant start ET end numeriques sont disponibles. Un ثمن est JOUABLE s'il est chronometre dans toutes les sourates qu'il traverse : eighths_playable_ids fait foi. Toute sourate non listee = todo.",
  totals: { surahs: 114, eighths: 480 },
  reciters,
}

if (allProblems.length) {
  console.log('PROBLEMES detectes :')
  for (const p of allProblems) console.log('  ' + p)
  console.log()
}

for (const r of RECITERS) {
  const x = reciters[r]
  console.log(`${r.padEnd(10)} ${String(x.surah_count).padStart(3)}/114 sourates   ${String(x.eighths_playable).padStart(3)}/480 ثمن jouables`)
}

if (existsSync(OUT)) {
  const old = JSON.parse(readFileSync(OUT, 'utf8'))
  for (const r of RECITERS) {
    const before = old.reciters?.[r]?.done?.length ?? 0
    const after = reciters[r].done.length
    if (before !== after) console.log(`  ${r}: ${before} -> ${after} sourates declarees`)
  }
}

if (WRITE) {
  writeFileSync(OUT, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  console.log('\ndata/audio_status.json ecrit.')
} else {
  console.log('\n(dry-run — relancer avec --write)')
}
