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
const RECITERS = ['kouchi', 'benkirane', 'elharraz']
const WRITE = process.argv.includes('--write')

const er = JSON.parse(readFileSync(join(ROOT, 'data', 'eighths.json'), 'utf8'))
const EIGHTHS = Array.isArray(er) ? er : er.eighths

// sourates traversees par chaque ثمن
const surahsOf = new Map()
for (const t of EIGHTHS) {
  surahsOf.set(t.eighth_id, [...new Set(t.verses_covered.map(v => v.sura))].sort((a, b) => a - b))
}

function scan(reciter) {
  const dir = join(ROOT, 'data', 'timings_thumn', reciter)
  if (!existsSync(dir)) return { done: [], problems: [] }
  const done = [], problems = []
  for (const f of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
    const n = parseInt(f, 10)
    try {
      const p = JSON.parse(readFileSync(join(dir, f), 'utf8'))
      if (p.surah !== n) { problems.push(`${f}: champ surah=${p.surah} ne correspond pas au nom de fichier`); continue }
      if (p.complete !== true) { problems.push(`${f}: complete=false, ignore`); continue }
      done.push(n)
    } catch (e) {
      problems.push(`${f}: illisible (${e.message})`)
    }
  }
  return { done: done.sort((a, b) => a - b), problems }
}

const reciters = {}
let allProblems = []
for (const r of RECITERS) {
  const { done, problems } = scan(r)
  allProblems = allProblems.concat(problems.map(p => `${r}/${p}`))
  const set = new Set(done)
  const playable = [...surahsOf].filter(([, surs]) => surs.every(s => set.has(s))).map(([id]) => id).sort((a, b) => a - b)
  reciters[r] = {
    done,
    in_progress: [],
    surah_count: done.length,
    eighths_playable: playable.length,
    eighths_playable_ids: playable,
  }
}

const manifest = {
  schema_version: 2,
  granularity: 'thumn',
  updated_at: new Date().toISOString().slice(0, 10),
  note: "Etat de couverture audio par ثمن. Genere automatiquement par tools/gen-audio-status.mjs depuis la presence des fichiers data/timings_thumn/{reciter}/{NNN}.json — ne pas editer a la main. 'done' = sourates marquees. Un ثمن n'est JOUABLE que si toutes les sourates qu'il traverse sont marquees, d'ou eighths_playable qui est le chiffre utile a l'utilisateur. Toute sourate non listee = todo.",
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
