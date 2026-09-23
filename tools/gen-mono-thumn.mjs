/* Genere les fichiers de timings des sourates qui tiennent DANS UN SEUL ثمن.
 *
 * Ces sourates n'ont aucune frontiere interne : le seul segment va de 0 a la
 * fin du MP3. Rien a marquer a l'oreille, seule la duree du fichier compte.
 *
 *   node gen-mono-thumn.mjs <recitant> <durations.json> [--write]
 *
 * <durations.json> : { "112": { "duration": 12.251 }, ... } — duree en
 * secondes obtenue par decodage reel du MP3 (pas une estimation debit/taille).
 *
 * Sans --write : liste ce qui serait ecrit, n'ecrit rien.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const RECITERS = {
  kouchi: {
    id: 'el_ayoun_el_kouchi', name: 'El-Ayoun El-Kouchi',
    base: 'https://github.com/smartmaker-devs/nuralhifz-data/releases/download/audio-kouchi-v1/',
  },
  jazairi: {
    id: 'al_qari_yassin', name: 'Yassine Al-Jazairi',
    base: 'https://github.com/smartmaker-devs/nuralhifz-data/releases/download/audio-jazairi-v1/',
  },
}

const [key, durFile, ...flags] = process.argv.slice(2)
const R = RECITERS[key]
if (!R || !durFile) {
  console.error(`usage: node gen-mono-thumn.mjs <${Object.keys(RECITERS).join('|')}> <durations.json> [--write]`)
  process.exit(2)
}
const write = flags.includes('--write')

const eighths = JSON.parse(readFileSync(join(ROOT, 'data', 'eighths.json'), 'utf8'))
const surahs = JSON.parse(readFileSync(join(ROOT, 'data', 'surahs.json'), 'utf8'))
const durations = JSON.parse(readFileSync(durFile, 'utf8'))

const nameOf = (n) => {
  const s = (Array.isArray(surahs) ? surahs : surahs.surahs).find(x => (x.number ?? x.id ?? x.index) === n)
  return s?.name_ar ?? s?.name ?? ''
}

// sourate -> ثمن qui la contiennent
const byS = new Map()
for (const e of eighths) {
  for (const v of e.verses_covered) {
    if (!byS.has(v.sura)) byS.set(v.sura, new Map())
    const m = byS.get(v.sura)
    if (!m.has(e.eighth_id)) m.set(e.eighth_id, [])
    m.get(e.eighth_id).push(v.aya)
  }
}

const outDir = join(ROOT, 'data', 'timings_thumn', key)
const done = [], skipped = []
for (let n = 1; n <= 114; n++) {
  const m = byS.get(n)
  if (m.size !== 1) continue                                   // s'etale sur plusieurs ثمن
  const [eighthId, ayat] = [...m][0]
  const e = eighths.find(x => x.eighth_id === eighthId)
  const d = durations[String(n)] ?? durations[String(n).padStart(3, '0')]
  if (!d?.duration) { skipped.push(`${n} (duree absente)`); continue }
  const first = e.verses_covered[0], last = e.verses_covered.at(-1)
  const payload = {
    schema_version: 3,
    granularity: 'thumn',
    surah: n,
    surah_name_ar: nameOf(n),
    segment_count: 1,
    inner_boundaries: 0,
    reciter: R.id,
    reciter_name: R.name,
    audio_url: R.base + String(n).padStart(3, '0') + '.mp3',
    audio_duration: d.duration,
    marked_at: new Date().toISOString(),
    derived_from: 'mono-thumn (aucune frontiere interne)',
    segments: [{
      eighth_id: eighthId,
      name_ar: e.name_ar,
      hizb: e.hizb,
      first_verse: Math.min(...ayat),
      last_verse: Math.max(...ayat),
      start: 0,
      end: d.duration,
      continues_before: first.sura !== n,                      // le ثمن commence dans une sourate precedente
      continues_after: last.sura !== n,                        // ... et/ou se poursuit apres
    }],
    complete: true,
  }
  const file = join(outDir, `${String(n).padStart(3, '0')}.json`)
  if (write) {
    mkdirSync(outDir, { recursive: true })
    writeFileSync(file, JSON.stringify(payload, null, 2) + '\n')
  }
  done.push(`${String(n).padStart(3, '0')}  ثمن ${String(eighthId).padStart(3)}  ${d.duration.toFixed(1).padStart(7)} s  ${existsSync(file) && !write ? '(existe deja)' : ''}`)
}
console.log(done.join('\n'))
console.log(`\n${done.length} sourates mono-ثمن${write ? ' ecrites' : ' (essai a blanc, rien ecrit)'} dans data/timings_thumn/${key}/`)
if (skipped.length) console.log(`ignorees : ${skipped.join(', ')}`)
