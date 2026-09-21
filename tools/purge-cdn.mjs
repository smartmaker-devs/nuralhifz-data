/* Purge jsDelivr apres publication, puis verification.
 *
 * jsDelivr sert @main avec jusqu'a 12 h de cache, et un parametre ?t= ne le
 * contourne pas. Sans purge, l'app a recu l'ancien 002.json apres sa
 * correction. A lancer APRES chaque push d'un fichier de timings ou de
 * data/audio_status.json.
 *
 *   node purge-cdn.mjs                      → fichiers data/ du dernier commit
 *   node purge-cdn.mjs --since <commit>     → fichiers data/ modifies depuis <commit>
 *   node purge-cdn.mjs data/x.json ...      → chemins explicites
 *
 * Verification : le contenu servi par le CDN doit etre identique (JSON parse)
 * au fichier du depot. Code de sortie 1 sinon.
 */
import { readFileSync, existsSync } from 'fs'
import { execSync } from 'child_process'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = 'smartmaker-devs/nuralhifz-data'
const CDN = `https://cdn.jsdelivr.net/gh/${REPO}@main/`
const PURGE = `https://purge.jsdelivr.net/gh/${REPO}@main/`

function targets() {
  const args = process.argv.slice(2)
  const si = args.indexOf('--since')
  if (args.length && si < 0) return args
  const range = si >= 0 ? `${args[si + 1]} HEAD` : 'HEAD~1 HEAD'
  return execSync(`git diff --name-only ${range} -- data/`, { cwd: ROOT, encoding: 'utf8' })
    .split('\n').map(s => s.trim()).filter(p => p && existsSync(join(ROOT, p)))
}

const same = (a, b) => { try { return JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b)) } catch { return a.trim() === b.trim() } }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function main() {
  const paths = targets()
  if (!paths.length) { console.log('rien a purger (aucun fichier data/ modifie)'); return }
  let bad = 0
  for (const p of paths) {
    const local = readFileSync(join(ROOT, p), 'utf8')
    const pr = await fetch(PURGE + p)
    const pj = await pr.json().catch(() => ({}))
    const purged = pr.ok && (pj.status === 'finished' || pj.status === 'processing' || pj.id)
    let ok = false
    for (let k = 0; k < 12 && !ok; k++) {                 // jusqu'a ~60 s
      if (k) await sleep(5000)
      const r = await fetch(`${CDN}${p}`, { cache: 'no-store' })
      ok = r.ok && same(await r.text(), local)
    }
    if (!ok) bad++
    console.log(`${ok ? '✓' : '✗'} ${p}  purge ${purged ? 'ok' : `HTTP ${pr.status}`} · CDN ${ok ? 'a jour' : 'TOUJOURS PERIME'}`)
  }
  process.exit(bad ? 1 : 0)
}
main().catch(e => { console.error(e.message); process.exit(2) })
