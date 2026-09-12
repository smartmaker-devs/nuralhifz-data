/* Dérive les timings THUMN depuis les timings VERSET déjà marqués.
 *
 * Une frontière de thumn tombe toujours sur une frontière de verset (un thumn
 * dont la frontière est en plein verset court jusqu'à la fin de ce verset).
 * Les bornes d'un segment sont donc déjà connues dès que la sourate est
 * marquée au verset — aucune écoute n'est nécessaire.
 *
 *   node tools/audio-marker/derive-thumn.mjs [--write]
 *
 * Sans --write : rapport seul (dry-run).
 * Le découpage en segments est lu depuis thumn.js pour rester l'unique source
 * de vérité — pas de réimplémentation qui pourrait diverger.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SRC_DIR = join(ROOT, 'data', 'timings', 'kouchi')
const OUT_DIR = join(ROOT, 'data', 'timings_thumn', 'kouchi')
const WRITE = process.argv.includes('--write')

// Réutilise computeSegments et validatePayload de l'outil (source unique)
const toolSrc = readFileSync(join(ROOT, 'tools', 'audio-marker', 'thumn.js'), 'utf8')
const grab = (name) => toolSrc.match(new RegExp(`function ${name}[\\s\\S]*?\\n\\}`))[0]
const computeSegments = new Function(`${grab('computeSegments')}; return computeSegments`)()
const validatePayload = new Function(`${grab('validatePayload')}; return validatePayload`)()

const eighthsRaw = JSON.parse(readFileSync(join(ROOT, 'data', 'eighths.json'), 'utf8'))
const EIGHTHS = Array.isArray(eighthsRaw) ? eighthsRaw : eighthsRaw.eighths
const surahsRaw = JSON.parse(readFileSync(join(ROOT, 'data', 'surahs.json'), 'utf8'))
const SURAHS = Array.isArray(surahsRaw) ? surahsRaw : surahsRaw.surahs

function derive(verseFile) {
  const v = JSON.parse(readFileSync(join(SRC_DIR, verseFile), 'utf8'))
  const segs = computeSegments(EIGHTHS, v.surah)
  const byVerse = new Map((v.timings || []).map(t => [t.verse, t]))

  const segments = segs.map(s => {
    const a = byVerse.get(s.first_verse)
    const b = byVerse.get(s.last_verse)
    if (!a || !b) throw new Error(`sourate ${v.surah}: timing manquant (${s.first_verse}–${s.last_verse})`)
    return {
      eighth_id:   s.eighth_id,
      name_ar:     s.name_ar,
      hizb:        s.hizb,
      first_verse: s.first_verse,
      last_verse:  s.last_verse,
      start:       a.start,
      end:         b.end,
      ...(s.continues_before ? { continues_before: true } : {}),
      ...(s.continues_after  ? { continues_after:  true } : {}),
      ...(s.shared_boundary  ? { shared_boundary:  true } : {}),
    }
  })
  // La fin du dernier segment est la fin de l'audio (le marquage verset peut
  // s'arrêter quelques ms avant ; on aligne pour satisfaire l'invariant).
  if (segments.length && v.audio_duration) segments.at(-1).end = v.audio_duration

  return {
    schema_version:   3,
    granularity:      'thumn',
    surah:            v.surah,
    surah_name_ar:    v.surah_name_ar ?? SURAHS.find(s => s.number === v.surah)?.name_ar ?? null,
    segment_count:    segments.length,
    inner_boundaries: Math.max(0, segments.length - 1),
    reciter:          v.reciter,
    reciter_name:     v.reciter_name,
    audio_url:        v.audio_url,
    audio_duration:   v.audio_duration,
    marked_at:        new Date().toISOString(),
    derived_from:     `data/timings/kouchi/${verseFile}`,
    segments,
    complete: segments.length > 0 && segments.every(s => typeof s.start === 'number' && typeof s.end === 'number'),
  }
}

const files = readdirSync(SRC_DIR).filter(f => f.endsWith('.json')).sort()
let ok = 0, bad = 0
if (WRITE && !existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })

for (const f of files) {
  try {
    const p = derive(f)
    const err = validatePayload(p)
    if (err) { console.log(`  REJET  ${f} -> ${err}`); bad++; continue }
    if (WRITE) writeFileSync(join(OUT_DIR, f), JSON.stringify(p, null, 2) + '\n', 'utf8')
    console.log(`  ${WRITE ? 'ecrit ' : 'valide'} ${f}  ${p.segment_count} thumn, ${p.inner_boundaries} frontiere(s)`)
    ok++
  } catch (e) {
    console.log(`  ERREUR ${f} -> ${e.message}`); bad++
  }
}
console.log(`--- ${ok} valides, ${bad} en echec${WRITE ? ` — ecrits dans data/timings_thumn/kouchi/` : ' (dry-run, --write pour ecrire)'}`)
