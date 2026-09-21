/* Controle acoustique des frontieres de ثمن publiees.
 *
 * Chaque frontiere interne doit tomber dans un SILENCE entre deux versets.
 * Une frontiere en pleine voix coupe un mot : l'app l'entendrait.
 *
 *   cd tools && npm install          (une fois : mpg123-decoder)
 *   node check-thumn-pauses.mjs              → tous les fichiers publies
 *   node check-thumn-pauses.mjs 2 100        → sourates choisies
 *   node check-thumn-pauses.mjs --file x.json → un fichier local (avant publication)
 *
 * Code de sortie 1 si une frontiere est hors pause : bloquant avant publication.
 *
 * Pourquoi en Node : le navigateur ne peut pas analyser le MP3 (GitHub
 * Releases ne renvoie pas d'en-tete CORS, l'audio est « opaque »).
 *
 * Methode : on ne decode pas le MP3 entier (123 Mo pour Al-Baqara). Les MP3
 * Kouchi sont a debit constant : l'instant t est a l'octet
 * debut_audio + t × debit/8. On lit ±5 s d'octets autour de chaque frontiere
 * (requete HTTP Range), on se cale sur la premiere trame valide, on decode,
 * puis on mesure le niveau par tranches de 50 ms.
 * Pause = niveau < -33 dB pendant au moins 0,3 s.
 */
import { readFileSync, readdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { MPEGDecoder } from 'mpg123-decoder'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = join(ROOT, 'data', 'timings_thumn', 'kouchi')

const WIN = 0.05          // tranche de mesure (s)
const SILENCE_DB = -33    // seuil de silence
const MIN_PAUSE = 0.3     // duree minimale d'une pause (s)
const SPAN = 5            // on analyse ±5 s autour de chaque frontiere
const TOL = 0.05          // tolerance au bord d'une pause (s)

// ── MP3 : en-tete ID3, debit, trame Info/Xing ─────────────────────────────────
const BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
const RATES = [44100, 48000, 32000]

function parseHeader(b, i) {
  if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null
  const version = (b[i + 1] >> 3) & 3, layer = (b[i + 1] >> 1) & 3
  if (version !== 3 || layer !== 1) return null            // MPEG-1 Layer III uniquement
  const br = BITRATES[(b[i + 2] >> 4) & 15], sr = RATES[(b[i + 2] >> 2) & 3]
  if (!br || !sr) return null
  const pad = (b[i + 2] >> 1) & 1
  return { bitrate: br, sampleRate: sr, length: Math.floor(144000 * br / sr) + pad }
}

async function fetchRange(url, from, to) {
  const r = await fetch(url, { headers: { Range: `bytes=${from}-${to}` }, redirect: 'follow' })
  if (r.status !== 206 && r.status !== 200) throw new Error(`HTTP ${r.status} sur ${url}`)
  return new Uint8Array(await r.arrayBuffer())
}

const layoutCache = new Map()
async function mp3Layout(url) {
  if (layoutCache.has(url)) return layoutCache.get(url)
  const head = await fetchRange(url, 0, 65535)
  let start = 0
  if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) {        // "ID3"
    const size = (head[6] << 21) | (head[7] << 14) | (head[8] << 7) | head[9]
    start = 10 + size + ((head[5] & 0x10) ? 10 : 0)
  }
  let h = parseHeader(head, start)
  if (!h) { for (let i = start; i < head.length - 4; i++) if ((h = parseHeader(head, i))) { start = i; break } }
  if (!h) throw new Error(`aucune trame MPEG trouvee dans ${url}`)
  // Une trame Info/Xing en tete ne porte pas d'audio : le temps 0 est apres elle.
  const probe = Buffer.from(head.subarray(start, start + h.length)).toString('latin1')
  const hasInfo = probe.includes('Xing') || probe.includes('Info')
  const cbrCheck = parseHeader(head, start + h.length)
  const layout = {
    audioStart: start + (hasInfo ? h.length : 0),
    bytesPerSec: h.bitrate * 1000 / 8,
    sampleRate: h.sampleRate, bitrate: h.bitrate, id3: start, hasInfo,
    cbr: !!cbrCheck && cbrCheck.bitrate === h.bitrate,
  }
  layoutCache.set(url, layout)
  return layout
}

// ── Profil de niveau autour d'un instant ─────────────────────────────────────
async function levelProfile(url, t) {
  const L = await mp3Layout(url)
  const t0 = Math.max(0, t - SPAN)
  const from = L.audioStart + Math.floor(t0 * L.bytesPerSec)
  const to = L.audioStart + Math.ceil((t + SPAN) * L.bytesPerSec)
  const buf = await fetchRange(url, from, to)
  // se caler sur une trame valide (deux en-tetes consecutifs coherents)
  let sync = -1
  for (let i = 0; i < buf.length - 8; i++) {
    const h = parseHeader(buf, i)
    if (h && h.bitrate === L.bitrate && parseHeader(buf, i + h.length)) { sync = i; break }
  }
  if (sync < 0) throw new Error(`pas de trame decodable autour de ${t}s`)
  const tStart = (from + sync - L.audioStart) / L.bytesPerSec
  const dec = new MPEGDecoder()
  await dec.ready
  const { channelData, sampleRate } = dec.decode(buf.subarray(sync))
  dec.free()
  const n = channelData[0].length, per = Math.round(WIN * sampleRate)
  const wins = []
  for (let k = 0; k + per <= n; k += per) {
    let s = 0
    for (let j = k; j < k + per; j++) {
      let v = 0
      for (const ch of channelData) v += ch[j]
      v /= channelData.length
      s += v * v
    }
    const rms = Math.sqrt(s / per)
    wins.push({ t: tStart + k / sampleRate, db: 20 * Math.log10(rms + 1e-12) })
  }
  // la toute premiere trame apres un saut peut etre incomplete (reservoir) : on l'ecarte
  return wins.slice(2)
}

function pausesOf(wins) {
  const out = []
  let run = null
  for (const w of wins) {
    if (w.db < SILENCE_DB) { run ??= { start: w.t, end: w.t + WIN }; run.end = w.t + WIN }
    else if (run) { out.push(run); run = null }
  }
  if (run) out.push(run)
  return out.filter(p => p.end - p.start >= MIN_PAUSE - 1e-9)
}

// ── Controle d'un fichier ────────────────────────────────────────────────────
async function checkFile(p, label) {
  const segs = p.segments || []
  const rows = []
  for (let i = 0; i < segs.length - 1; i++) {
    const a = segs[i], b = segs[i + 1]
    if (typeof a.end !== 'number') continue
    const t = a.end
    const row = { label, eighth: a.eighth_id, next: b.eighth_id, verse: a.last_verse, t }
    if (typeof b.start === 'number' && Math.abs(b.start - t) > 1e-6) row.warn = `start du ثمن ${b.eighth_id} (${b.start}) ≠ fin du ${a.eighth_id}`
    const wins = await levelProfile(p.audio_url, t)
    const here = wins.reduce((best, w) => (Math.abs(w.t + WIN / 2 - t) < Math.abs(best.t + WIN / 2 - t) ? w : best))
    const pauses = pausesOf(wins)
    const inside = pauses.find(q => t >= q.start - TOL && t <= q.end + TOL)
    const mid = (q) => (q.start + q.end) / 2
    const nearest = pauses.slice().sort((x, y) => Math.abs(mid(x) - t) - Math.abs(mid(y) - t))[0]
    const nextP = pauses.find(q => q.start > t + TOL)
    Object.assign(row, { db: here.db, ok: !!inside, pause: inside, nearest, nextP })
    rows.push(row)
  }
  return rows
}

const fmtT = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`

async function main() {
  const args = process.argv.slice(2)
  const targets = []
  const fi = args.indexOf('--file')
  if (fi >= 0) {
    targets.push({ label: args[fi + 1], p: JSON.parse(readFileSync(args[fi + 1], 'utf8')) })
  } else {
    const wanted = args.map(Number).filter(Boolean)
    for (const f of readdirSync(DIR).filter(f => f.endsWith('.json')).sort()) {
      const n = parseInt(f, 10)
      if (wanted.length && !wanted.includes(n)) continue
      targets.push({ label: f, p: JSON.parse(readFileSync(join(DIR, f), 'utf8')) })
    }
  }
  let bad = 0, total = 0
  for (const { label, p } of targets) {
    const rows = await checkFile(p, label)
    if (!rows.length) continue
    const L = await mp3Layout(p.audio_url)
    console.log(`\n${label} — sourate ${p.surah} · MP3 ${L.bitrate} kbps ${L.cbr ? 'CBR' : '⚠ debit variable ?'}, ID3 ${L.id3} octets${L.hasInfo ? ', trame Info' : ''}`)
    for (const r of rows) {
      total++
      if (!r.ok) bad++
      const verdict = r.ok ? `✓ dans une pause (${fmtT(r.pause.start)} → ${fmtT(r.pause.end)})` : '✗ EN PLEINE VOIX'
      let hint = ''
      if (!r.ok && r.nearest) {
        const m = (r.nearest.start + r.nearest.end) / 2
        hint = `   pause la plus proche : ${fmtT(r.nearest.start)} → ${fmtT(r.nearest.end)}, milieu ${m.toFixed(2)} s (${m - r.t >= 0 ? '+' : ''}${(m - r.t).toFixed(2)} s)`
        if (r.nextP && r.nextP !== r.nearest) hint += `\n      pause suivante       : ${fmtT(r.nextP.start)} → ${fmtT(r.nextP.end)} (+${(r.nextP.start - r.t).toFixed(2)} s)`
      }
      console.log(`  ثمن ${String(r.eighth).padStart(3)} → ${String(r.next).padEnd(3)} ﴿${r.verse}﴾  ${r.t.toFixed(3).padStart(9)} s  ${r.db.toFixed(0).padStart(4)} dB  ${verdict}`)
      if (hint) console.log(hint)
      if (r.warn) console.log(`      ⚠ ${r.warn}`)
    }
  }
  console.log(`\n${total - bad}/${total} frontieres dans une pause${bad ? ` — ${bad} A CORRIGER` : ''}`)
  process.exit(bad ? 1 : 0)
}
export { mp3Layout, levelProfile, pausesOf, checkFile }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e.message); process.exit(2) })
}
