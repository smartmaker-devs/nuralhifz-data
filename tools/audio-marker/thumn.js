/* Thumn Marker — Kouchi (Warsh Muhammadi)
 *
 * Interface par etapes : une frontiere de ثمن a la fois, deux questions.
 *   1. Trouver  — ou finit le ثمن ? (on ecoute autour de l'estimation)
 *   2. Verifier — la coupure est-elle bonne ? (rejoue 3s avant / 3s apres)
 *   3. Termine  — recapitulatif, revision, publication.
 *
 * Unite marquee : le SEGMENT de ثمن (la portion d'un ثمن contenue dans une
 * sourate). 435 frontieres sur tout le Coran. La fin du dernier segment est la
 * duree de l'audio, remplie automatiquement.
 *
 * Sortie → data/timings_thumn/kouchi/{NNN}.json (schema v3). Le format de
 * sauvegarde locale (marks/starts) est inchange : un marquage deja commence
 * dans l'ancienne interface se reprend tel quel.
 */

const RECITER = { id: 'el_ayoun_el_kouchi', name: 'El-Ayoun El-Kouchi', server: 'https://github.com/smartmaker-devs/nuralhifz-data/releases/download/audio-kouchi-v1/' }
const SCHEMA_VERSION = 3
const DATA_BASE = 'https://cdn.jsdelivr.net/gh/smartmaker-devs/nuralhifz-data@v1.0.0/data/'
const STATUS_URL = 'https://cdn.jsdelivr.net/gh/smartmaker-devs/nuralhifz-data@main/data/audio_status.json'
// Fichiers publies, lus sans le cache de 12 h de jsDelivr (raw sert l'en-tete CORS)
const PUBLISHED_BASE = 'https://raw.githubusercontent.com/smartmaker-devs/nuralhifz-data/main/data/timings_thumn/kouchi/'
const OUT_DIR = 'data/timings_thumn/kouchi'

const FIND_LEAD = 6      // l'ecoute demarre 6s avant la position estimee
const JUMP = 5           // boutons قبل / بعد
const NUDGE = 0.2        // boutons أبكر / أبعد
// Verification : on joue la FIN du ثمن (t-4 → t), on s'arrete net, 1 s de
// silence, puis le DEBUT du suivant (t → t+4) — exactement ce que l'app fera.
// L'ancienne verification rejouait t-3 → t+3 d'un seul tenant : on entendait
// forcement le verset suivant apres la coupure, ce qui poussait a reculer la
// marque jusqu'a ne plus l'entendre. Resultat mesure : les 8 frontieres du
// hizb 1 d'Al-Baqara etaient toutes ~3 s trop tot, en pleine voix.
const CHECK_WIN = 4
const CHECK_GAP = 1000

const GH = {
  owner: 'smartmaker-devs', repo: 'nuralhifz-data', branch: 'main',
  patKey: 'marker:gh:pat',
  getPat() { return localStorage.getItem(this.patKey) || '' },
  setPat(v) { v ? localStorage.setItem(this.patKey, v) : localStorage.removeItem(this.patKey) },
  _hdr() {
    return { 'Authorization': `Bearer ${this.getPat()}`, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
  },
  _url(path) { return `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}` },
  async getFileSha(path) {
    const r = await fetch(`${this._url(path)}?ref=${this.branch}`, { headers: this._hdr(), cache: 'no-store' })
    if (r.status === 404) return null
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(`${r.status}: ${e.message || 'GET failed'}`) }
    return (await r.json()).sha
  },
  async putFile(path, content, message) {
    const sha = await this.getFileSha(path)
    const body = { message, content: btoa(unescape(encodeURIComponent(content))), branch: this.branch }
    if (sha) body.sha = sha
    const r = await fetch(this._url(path), { method: 'PUT', headers: { ...this._hdr(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(`${r.status}: ${e.message || 'PUT failed'}`) }
    return r.json()
  },
}

// ── State ────────────────────────────────────────────────────────────────────
const state = {
  surahs: [], eighths: [], doneSurahs: new Set(),
  hizbNo: null, surahNo: null,
  versesByAya: new Map(),
  segments: [],
  marks: [], starts: [],
  cursor: 0,            // frontiere en cours (0 .. innerCount-1)
  reviewing: false,     // on revoit une frontiere depuis l'ecran « termine »
  duration: 0,
  audioUrl: '',
  stopAt: null,
  pendingPush: false,
}
const innerCount = () => Math.max(0, state.segments.length - 1)

const $ = (id) => document.getElementById(id)
const audio = $('audio')
const pad3 = (n) => String(n).padStart(3, '0')
const fmt = (s) => {
  if (!isFinite(s)) return '--:--.-'
  const m = Math.floor(s / 60), r = s - m * 60
  return `${String(m).padStart(2, '0')}:${r.toFixed(1).padStart(4, '0')}`
}
const fmtMs = (s) => {
  if (!isFinite(s)) return '--:--.---'
  const m = Math.floor(s / 60), r = s - m * 60
  return `${String(m).padStart(2, '0')}:${r.toFixed(3).padStart(6, '0')}`
}
const lsKey = (n) => `marker:kouchi:thumn:${pad3(n)}`
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
function setStatus(msg, isError) { const e = $('status'); e.textContent = msg || ''; e.classList.toggle('err', !!isError) }

// ── Decoupage : segments de ثمن d'une sourate ────────────────────────────────
function computeSegments(eighths, surahNo) {
  const segs = []
  for (const t of eighths) {
    const mine = t.verses_covered.filter(v => v.sura === surahNo).map(v => v.aya).sort((a, b) => a - b)
    if (!mine.length) continue
    const suras = t.verses_covered.map(v => v.sura)
    segs.push({
      eighth_id: t.eighth_id,
      name_ar: t.name_ar || `الثمن ${t.eighth_id}`,
      hizb: t.hizb,
      first_verse: mine[0],
      last_verse: mine[mine.length - 1],
      continues_before: Math.min(...suras) < surahNo,
      continues_after: Math.max(...suras) > surahNo,
      shared_boundary: false,
    })
  }
  segs.sort((a, b) => a.eighth_id - b.eighth_id)
  // 12 versets portent une frontiere de ثمن en plein milieu (paires ۞). On ne
  // coupe pas une recitation au milieu d'un verset : le ثمن anterieur court
  // jusqu'a la FIN du verset, le suivant demarre au verset d'apres.
  for (let i = 1; i < segs.length; i++) {
    if (segs[i].first_verse <= segs[i - 1].last_verse) {
      segs[i].first_verse = segs[i - 1].last_verse + 1
      segs[i].shared_boundary = true
      segs[i - 1].shared_boundary = true
    }
  }
  return segs.filter(s => s.first_verse <= s.last_verse)
}

// ── Estimation de la position d'une frontiere ────────────────────────────────
// Valide sur 118 marques verset reelles : mediane 0.47s, 99% sous 3s pour la
// frontiere qui suit une marque. Deux pieges du decompte de mots :
//   - le numero de verset s'ecrit U+FD3F <chiffres> U+FD3E, dans CET ordre
//     (Unicode nomme FD3E « LEFT » : une regex ecrite d'apres les noms echoue) ;
//   - les marques warsh sont A L'INTERIEUR des mots : les retirer sans espace.
const VERSE_NUM = /﴿[^﴾]*﴾/g
const WARSH_MARKS = /[ۖ-ۭ۝࣢]|ـ/g
const wordCount = (t) => (t || '').replace(VERSE_NUM, ' ').replace(WARSH_MARKS, '').trim().split(/\s+/).filter(Boolean).length
// Basmala recitee avant le verset 1 mais absente de son texte — sauf :
//   الفاتحة : elle EST fusionnee dans le verset 1 (deja comptee)
//   التوبة  : aucune basmala recitee
const BASMALA_WORDS = 4

function segmentWords(sg) {
  let w = 0
  for (let v = sg.first_verse; v <= sg.last_verse; v++) w += wordCount(state.versesByAya.get(v))
  if (sg.first_verse === 1 && state.surahNo !== 1 && state.surahNo !== 9) w += BASMALA_WORDS
  return w
}

// Ancree sur la derniere frontiere REELLEMENT marquee, puis on repartit le
// temps restant sur les mots restants, frontiere apres frontiere.
function estimate(i) {
  if (!state.duration || i < 0 || i >= state.segments.length) return null
  let anchor = -1
  for (let k = i - 1; k >= 0; k--) { if (state.marks[k] != null) { anchor = k; break } }
  let t = anchor >= 0 ? state.marks[anchor] : 0
  for (let k = anchor + 1; k <= i; k++) {
    let remaining = 0
    for (let m = k; m < state.segments.length; m++) remaining += state.segments[m].words ?? 0
    if (remaining <= 0) return null
    t += ((state.segments[k].words ?? 0) / remaining) * (state.duration - t)
  }
  return Math.min(t, state.duration)
}

// ── Texte du Coran : un seul telechargement par session (3,7 Mo) ─────────────
let _quranAll = null
async function getQuranAll() {
  if (_quranAll) return _quranAll
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 60000)
  try {
    const r = await fetch(`${DATA_BASE}quran_muhammadi.json`, { signal: ctl.signal })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    _quranAll = await r.json()
    return _quranAll
  } finally { clearTimeout(timer) }
}

// ── Hizb : la file des sourates qui lui manquent ─────────────────────────────
// L'audio est stocke par sourate et un fichier n'est publiable que complet :
// ouvrir un hizb ouvre donc la file des sourates ENTIERES qui lui manquent.
function surahsOfHizb(h) {
  const set = new Set()
  for (const t of state.eighths) if (t.hizb === h) for (const v of t.verses_covered) set.add(v.sura)
  return [...set].sort((a, b) => a - b)
}
function isSurahDone(n) {
  if (state.doneSurahs.has(n)) return true
  try { const raw = localStorage.getItem(lsKey(n)); if (raw) return JSON.parse(raw).complete === true } catch {}
  return false
}
function playableInHizb(h) {
  let n = 0
  for (const t of state.eighths) {
    if (t.hizb !== h) continue
    if ([...new Set(t.verses_covered.map(v => v.sura))].every(s => state.doneSurahs.has(s))) n++
  }
  return n
}
const hizbQueue = (h) => surahsOfHizb(h).filter(n => !isSurahDone(n))
const innerOfSurah = (n) => state.eighths.filter(t => t.start.sura === n && t.start.aya > 1).length

function renderHizbOptions() {
  const sel = $('hizbSelect')
  sel.innerHTML = ''
  for (let h = 1; h <= 60; h++) {
    const opt = document.createElement('option')
    opt.value = String(h)
    opt.textContent = hizbQueue(h).length === 0 ? `الحزب ${h} ✓ مكتمل` : `الحزب ${h} — ${playableInHizb(h)} من 8 أثمان جاهزة`
    sel.appendChild(opt)
  }
}
function renderSurahOptions(h) {
  const sel = $('surahSelect')
  sel.innerHTML = ''
  for (const n of surahsOfHizb(h)) {
    const meta = state.surahs.find(s => s.number === n)
    const opt = document.createElement('option')
    opt.value = String(n)
    const inner = innerOfSurah(n)
    opt.textContent = isSurahDone(n) ? `✓ ${n}. ${meta?.name_ar ?? ''} (منشورة)`
      : `${n}. ${meta?.name_ar ?? ''} — ${inner === 0 ? 'لا حدود' : inner + ' حد'}`
    sel.appendChild(opt)
  }
  const first = hizbQueue(h)[0]
  if (first != null) sel.value = String(first)
  updatePickInfo()
}
function updatePickInfo() {
  const h = parseInt($('hizbSelect').value, 10), n = parseInt($('surahSelect').value, 10)
  const q = hizbQueue(h)
  const inner = innerOfSurah(n)
  let txt = q.length === 0 ? `الحزب ${h} مكتمل.` : `يتبقّى في هذا الحزب ${q.length} سورة : ${q.join('، ')}.`
  if (isSurahDone(n)) txt += ' السورة المختارة منشورة بالفعل.'
  else txt += inner === 0 ? ' السورة المختارة لا تحتوي أي حد : تُنشر مباشرة.' : ` السورة المختارة : ${inner} حد للتعليم.`
  $('pickInfo').textContent = txt
}
function onHizbChange() { state.hizbNo = parseInt($('hizbSelect').value, 10); renderSurahOptions(state.hizbNo) }
const nextInQueue = () => state.hizbNo == null ? null : (hizbQueue(state.hizbNo).find(n => n !== state.surahNo) ?? null)

// ── Publication par hizb (sourates longues) ──────────────────────────────────
// Al-Baqara couvre 5 hizbs et 2h08 d'audio : attendre ses 38 frontieres pour
// publier quoi que ce soit n'avait pas de sens pour quelqu'un qui raisonne en
// hizb. Un fichier peut donc partir PARTIEL (complete:false) : un segment est
// disponible des que son debut ET sa fin sont connus, les autres restent null.
const isTimed = (i) => i >= 0 && i < state.segments.length
  && (i === 0 || state.marks[i - 1] != null) && state.marks[i] != null
const countTimed = () => state.segments.reduce((n, _, i) => n + (isTimed(i) ? 1 : 0), 0)
const pubKey = (n) => `${lsKey(n)}:pub`
function publishedCount() { try { return parseInt(localStorage.getItem(pubKey(state.surahNo)) || '0', 10) || 0 } catch { return 0 } }

// Un hizb est ecoutable si chacun de ses ثمن est chronometre dans TOUTES les
// sourates qu'il traverse : ici via les segments de la sourate en cours,
// ailleurs via les sourates deja publiees.
function hizbReady(h) {
  const timedE = new Set(state.segments.filter((_, i) => isTimed(i)).map(s => s.eighth_id))
  let any = false
  for (const t of state.eighths) {
    if (t.hizb !== h) continue
    any = true
    for (const s of new Set(t.verses_covered.map(v => v.sura))) {
      if (s === state.surahNo) { if (!timedE.has(t.eighth_id)) return false }
      else if (!state.doneSurahs.has(s)) return false
    }
  }
  return any
}

function updatePubBar() {
  const bar = $('pubBar')
  const n = innerCount()
  const show = state.surahNo != null && n > 0 && (state.screen === 'find' || state.screen === 'check')
  const timed = show ? countTimed() : 0
  if (!show || timed === 0) { bar.hidden = true; return }
  const total = state.segments.length, pub = publishedCount()
  const ready = [...new Set(state.segments.map(s => s.hizb))].filter(h => hizbReady(h))
  bar.hidden = false
  bar.classList.toggle('ready', timed > pub && ready.length > 0)
  $('btnPubPartial').hidden = timed <= pub
  if (timed <= pub) $('pubInfo').textContent = `✓ منشور : ${pub} من ${total} ثمن`
  else if (ready.length) $('pubInfo').textContent = `✓ اكتمل الحزب ${ready.join(' و')} — انشره ليُسمع في التطبيق`
  else $('pubInfo').textContent = `أُنجز ${timed} من ${total} ثمن — غير منشور بعد`
}

// ── Ecrans ───────────────────────────────────────────────────────────────────
function showScreen(name) {
  if (name !== 'check') cancelSequence()   // sinon la 2e moitie de l'ecoute repartirait apres coup
  $('picker').hidden = name !== 'pick'
  $('sFind').hidden = name !== 'find'
  $('sCheck').hidden = name !== 'check'
  $('sDone').hidden = name !== 'done'
  state.screen = name
  updateHeader()
}
function updateHeader() {
  const meta = state.surahs.find(s => s.number === state.surahNo)
  $('btnWhere').textContent = state.surahNo == null
    ? 'اختر الحزب والسورة ▾'
    : `الحزب ${state.hizbNo ?? '—'} · ${meta?.name_ar ?? state.surahNo} ▾`
  const n = innerCount()
  const done = state.marks.slice(0, n).filter(x => x != null).length
  $('count').textContent = state.surahNo == null || n === 0 ? '' : `الحد ${Math.min(state.cursor + 1, n)} من ${n}`
  $('prog').style.width = n === 0 ? (state.surahNo == null ? '0%' : '100%') : `${Math.round(done / n * 100)}%`
  updatePubBar()
}

// Fin du verset qui clot le ثمن / debut du verset qui ouvre le suivant.
const tailWords = (t, k) => { const w = (t || '').trim().split(/\s+/); return (w.length > k ? '… ' : '') + w.slice(-k).join(' ') }
const headWords = (t, k) => { const w = (t || '').trim().split(/\s+/); return w.slice(0, k).join(' ') + (w.length > k ? ' …' : '') }

// Arret precis : timeupdate ne tombe que toutes les ~250 ms, assez pour laisser
// passer le debut du mot suivant. requestAnimationFrame ne suffit pas non plus
// (suspendu si la page n'est pas affichee : 185 ms de depassement mesures). On
// sonde donc toutes les 10 ms pendant une lecture bornee.
let seqTimer = null, stopPoll = null
function handleStop() {
  if (state.stopAt == null || audio.currentTime < state.stopAt) return false
  audio.pause()
  state.stopAt = null
  const next = state.afterStop
  state.afterStop = null
  if (next) next()
  return true
}
function watchStop() {
  clearInterval(stopPoll)
  const id = setInterval(() => {
    if (state.stopAt == null) { clearInterval(id); return }
    handleStop()
  }, 10)
  stopPoll = id
}
function cancelSequence() {
  clearTimeout(seqTimer); seqTimer = null
  state.afterStop = null
  setPhase(null)
}
function playFrom(t, stopAt, afterStop) {
  clearTimeout(seqTimer); seqTimer = null
  audio.currentTime = Math.max(0, t)
  state.stopAt = stopAt ?? null
  state.afterStop = afterStop ?? null
  audio.play().catch(() => {})
  if (state.stopAt != null) watchStop()
}
function setPhase(p) {
  for (const [id, k] of [['phA', 'a'], ['phGap', 'gap'], ['phB', 'b']]) $(id)?.classList.toggle('on', p === k)
}

// Etape 1 : trouver la fin du ثمن
function openFind(i) {
  state.cursor = i
  const sg = state.segments[i], nx = state.segments[i + 1]
  $('findTitle').textContent = `أين ينتهي ${sg.name_ar}؟`
  $('lastV').textContent = tailWords(state.versesByAya.get(sg.last_verse), 12)
  $('nextV').textContent = headWords(state.versesByAya.get(nx?.first_verse), 8)
  showScreen('find')
  const est = estimate(i)
  if (est == null) { $('findNote').textContent = 'جارٍ تحميل الصوت…'; return }
  const lower = i === 0 ? 0 : (state.marks[i - 1] ?? 0)
  playFrom(Math.max(lower, est - FIND_LEAD), null)
  $('findNote').textContent = `بدأ السماع ${FIND_LEAD} ث قبل الموضع المقدَّر`
  setStatus('')
}

// Etape 2 : verifier la coupure
function openCheck(i) {
  state.cursor = i
  const sg = state.segments[i], nx = state.segments[i + 1]
  $('joinTxt').innerHTML = esc(tailWords(state.versesByAya.get(sg.last_verse), 3))
    + '<b>|</b>' + esc(headWords(state.versesByAya.get(nx?.first_verse), 3))
  showScreen('check')
  replayCut()
}
function replayCut() {
  const i = state.cursor, t = state.marks[i]
  if (t == null) return
  $('clockCut').textContent = fmtMs(t)
  const lower = i === 0 ? 0 : (state.marks[i - 1] ?? 0)
  const upper = state.marks[i + 1] ?? state.duration
  setPhase('a')
  playFrom(Math.max(lower, t - CHECK_WIN), t, () => {
    setPhase('gap')
    seqTimer = setTimeout(() => {
      setPhase('b')
      playFrom(t, Math.min(upper, t + CHECK_WIN), () => setPhase(null))
    }, CHECK_GAP)
  })
}

// Etape 3 : recapitulatif. Accessible aussi EN COURS de sourate (bouton 📝) :
// sur une sourate longue, on doit pouvoir reecouter un hizb deja fait sans
// attendre la fin.
function openDone() {
  audio.pause()
  const n = innerCount()
  const complete = firstUnmarked(0) === -1
  const published = state.doneSurahs.has(state.surahNo)
  $('doneMsg').hidden = n > 0
  if (n === 0) {
    $('doneTitle').textContent = published ? 'السورة منشورة بالفعل ✓' : 'لا حدود في هذه السورة'
    $('doneMsg').textContent = published
      ? 'ثمن واحد يغطّي السورة كاملة، وهي منشورة. اختر سورة أخرى من الأعلى.'
      : 'ثمن واحد يغطّي السورة كاملة : لا شيء تعلّمه. انشرها مباشرة.'
  } else {
    $('doneTitle').textContent = complete ? 'اكتملت السورة ✓' : 'ما أُنجز حتى الآن'
  }
  $('doneSub').hidden = n === 0
  $('doneList').hidden = n === 0
  $('doneList').innerHTML = state.segments.slice(0, n).map((sg, k) => state.marks[k] == null ? '' :
    `<div data-k="${k}"><span class="ok">✓ ${esc(sg.name_ar)} ﴿${sg.last_verse}﴾ · ح${sg.hizb}</span><span>${fmtMs(state.marks[k])}</span></div>`).join('')
  $('btnPublish').textContent = !complete ? 'متابعة التعليم' : (published ? 'إعادة النشر' : 'نشر')
  const next = nextInQueue()
  $('nextHint').textContent = !complete ? '' : (next != null ? `السورة التالية في الحزب : ${next}` : (state.hizbNo != null ? `لا سور متبقية في الحزب ${state.hizbNo} بعد هذه.` : ''))
  state.cursor = n
  showScreen('done')
}

// Premiere frontiere non marquee, ou l'ecran « termine »
function firstUnmarked(from = 0) {
  const n = innerCount()
  for (let k = from; k < n; k++) if (state.marks[k] == null) return k
  for (let k = 0; k < Math.min(from, n); k++) if (state.marks[k] == null) return k
  return -1
}
function resume() {
  const k = firstUnmarked(0)
  if (k === -1) openDone(); else openFind(k)
}

// Ce qui est PUBLIE fait foi sur les segments publies. Sans cela, une correction
// faite en dehors de l'outil (ex. 002.json recale de ~3 s apres controle
// acoustique) serait ignoree par le navigateur, qui garde ses anciennes marques
// — et la publication suivante depuis l'outil re-casserait le fichier.
// Les marques locales au-dela de ce qui est publie (travail en cours) sont
// conservees. Retourne le nombre de frontieres remplacees.
async function mergePublished(n) {
  try {
    const r = await fetch(`${PUBLISHED_BASE}${pad3(n)}.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!r.ok) return 0
    const pub = await r.json()
    if (!Array.isArray(pub.segments) || pub.segments.length !== state.segments.length) return 0
    let changed = 0, timed = 0
    const last = state.segments.length - 1
    pub.segments.forEach((s, i) => {
      if (typeof s.end !== 'number') return
      if (typeof s.start === 'number') timed++
      if (i === last) return
      if (state.marks[i] == null || Math.abs(state.marks[i] - s.end) > 0.01) { state.marks[i] = s.end; changed++ }
    })
    // une marque locale plus loin mais desormais anterieure a une marque publiee est fausse
    for (let k = 1; k < last; k++) if (state.marks[k] != null && state.marks[k - 1] != null && state.marks[k] <= state.marks[k - 1]) state.marks[k] = null
    try { localStorage.setItem(pubKey(n), String(timed)) } catch {}
    return changed
  } catch { return 0 }
}

// ── Chargement d'une sourate ─────────────────────────────────────────────────
async function loadSurah(n) {
  audio.pause()
  state.surahNo = n
  state.reviewing = false
  try {
    setStatus(_quranAll ? `جارٍ تحميل السورة ${n}…` : 'جارٍ تنزيل نص القرآن (3.7 Mo) — مرة واحدة فقط…')
    const all = await getQuranAll()
    state.versesByAya = new Map(all.filter(v => v.sura === n).map(v => [v.aya, v.text]))
  } catch (e) {
    setStatus(e?.name === 'AbortError' ? 'انتهت مهلة تنزيل نص القرآن — تحقق من الاتصال وأعد المحاولة' : `فشل تنزيل نص القرآن : ${e?.message ?? e}`, true)
    return
  }
  state.segments = computeSegments(state.eighths, n)
  for (const sg of state.segments) sg.words = segmentWords(sg)
  state.marks = []; state.starts = []; state.duration = 0
  // Reprise d'un marquage deja commence. Les frontieres sont relues depuis
  // segments[].end : c'est la que l'ancienne interface les ecrivait (elle ne
  // relisait qu'un champ `marks` qu'elle n'enregistrait jamais).
  try {
    const raw = localStorage.getItem(lsKey(n))
    const obj = raw ? JSON.parse(raw) : null
    if (obj && Array.isArray(obj.segments) && obj.segments.length === state.segments.length) {
      state.marks = obj.segments.map(s => (typeof s.end === 'number' ? s.end : null))
    }
  } catch {}
  const synced = await mergePublished(n)

  state.audioUrl = `${RECITER.server}${pad3(n)}.mp3`
  audio.src = state.audioUrl
  state.pendingNote = synced > 0 ? `↻ حُدِّث ${synced} حدّ من النسخة المنشورة (مصحَّحة) — راجِعها بالسماع` : ''
  setStatus('جارٍ تحميل الصوت…')
  // la suite se fait a loadedmetadata, quand la duree est connue
}

audio.addEventListener('loadedmetadata', () => {
  state.duration = audio.duration
  const last = state.segments.length - 1
  if (last >= 0) state.marks[last] = state.duration  // fin de sourate = fin de l'audio
  persist()
  setStatus('')
  resume()
  if (state.pendingNote) { setStatus(state.pendingNote); state.pendingNote = '' }
})
audio.addEventListener('error', () => setStatus('تعذّر تحميل الصوت — تحقق من الاتصال', true))
audio.addEventListener('timeupdate', () => {
  if (state.screen === 'find') $('clockFind').textContent = fmt(audio.currentTime)
  handleStop()   // filet si les images sont ralenties (onglet en arriere-plan)
})
function syncPlay() { $('btnPlay').textContent = (!audio.paused && !audio.ended) ? '⏸' : '▶' }
audio.addEventListener('play', syncPlay)
audio.addEventListener('pause', syncPlay)
audio.addEventListener('ended', syncPlay)

// ── Actions ──────────────────────────────────────────────────────────────────
function markHere() {
  const i = state.cursor
  const t = audio.currentTime
  const prev = i === 0 ? 0 : (state.marks[i - 1] ?? 0)
  if (t <= prev + 0.05) { setStatus(`هذا الموضع قبل نهاية الثمن السابق (${fmt(prev)}) — تقدّم قليلاً`, true); return }
  if (t >= state.duration - 0.05) { setStatus('هذا الموضع في نهاية السورة — ارجع قليلاً', true); return }
  state.marks[i] = t
  // les frontieres suivantes deja posees mais desormais AVANT celle-ci sont fausses
  for (let k = i + 1; k < innerCount(); k++) if (state.marks[k] != null && state.marks[k] <= t) state.marks[k] = null
  persist()
  if (navigator.vibrate) navigator.vibrate(15)
  openCheck(i)
}

function nudgeCut(d) {
  const i = state.cursor
  const cur = state.marks[i]
  if (cur == null) return
  const lower = (i === 0 ? 0 : (state.marks[i - 1] ?? 0)) + 0.05
  const upper = (state.marks[i + 1] ?? state.duration) - 0.05
  const v = Math.min(upper, Math.max(lower, cur + d))
  if (v === cur) { setStatus('لا يمكن التحريك أكثر في هذا الاتجاه', true); return }
  state.marks[i] = v
  persist()
  setStatus('')
  if (navigator.vibrate) navigator.vibrate(8)
  replayCut()
}

function confirmCut() {
  if (state.reviewing) { state.reviewing = false; return openDone() }
  const k = firstUnmarked(state.cursor + 1)
  if (k === -1) openDone(); else openFind(k)
}

function redo() { state.marks[state.cursor] = null; persist(); openFind(state.cursor) }

// ── Sauvegarde ───────────────────────────────────────────────────────────────
function persist() {
  if (state.surahNo == null) return
  try { localStorage.setItem(lsKey(state.surahNo), JSON.stringify(buildPayload())) } catch {}
  updateHeader()
}

function buildPayload() {
  const surahMeta = state.surahs.find(s => s.number === state.surahNo) || {}
  // pas de blanc entre deux ثمن : chacun commence ou finit le precedent.
  // Borne inconnue = null, JAMAIS 0 : l'app rejette tout le fichier comme
  // corrompu si un segment a des bornes numeriques avec end <= start. Seul le
  // debut du 1er segment vaut 0 (c'est le debut reel de l'audio).
  const startOf = (i) => (i === 0 ? 0 : (state.marks[i - 1] ?? null))
  const segments = state.segments.map((sg, i) => ({
    eighth_id: sg.eighth_id, name_ar: sg.name_ar, hizb: sg.hizb,
    first_verse: sg.first_verse, last_verse: sg.last_verse,
    start: startOf(i), end: state.marks[i] ?? null,
    ...(sg.continues_before ? { continues_before: true } : {}),
    ...(sg.continues_after ? { continues_after: true } : {}),
    ...(sg.shared_boundary ? { shared_boundary: true } : {}),
  }))
  return {
    schema_version: SCHEMA_VERSION, granularity: 'thumn',
    surah: state.surahNo, surah_name_ar: surahMeta.name_ar || null,
    segment_count: state.segments.length, inner_boundaries: innerCount(),
    reciter: RECITER.id, reciter_name: RECITER.name,
    audio_url: state.audioUrl, audio_duration: state.duration || null,
    marked_at: new Date().toISOString(),
    segments,
    complete: state.segments.length > 0 && segments.every(s => typeof s.start === 'number' && typeof s.end === 'number'),
  }
}

// allowPartial : fichier publie en cours de sourate. Seuls les segments dont
// debut ET fin sont connus sont verifies ; les autres restent a null.
function validatePayload(p, allowPartial = false) {
  if (p.schema_version !== 3) return 'schema_version doit être 3'
  if (!Number.isInteger(p.surah) || p.surah < 1 || p.surah > 114) return `surah invalide (${p.surah})`
  if (!Array.isArray(p.segments) || p.segments.length !== p.segment_count) return 'segments.length ≠ segment_count'
  if (p.complete !== true && !allowPartial) return 'لم تكتمل كل الحدود بعد'
  if (p.segments[0]?.start !== 0) return 'start du premier thumn doit être 0'
  if (!p.audio_duration) return 'مدة الصوت غير معروفة — أعد تحميل السورة'
  const timed = (s) => typeof s.start === 'number' && typeof s.end === 'number'
  if (!p.segments.some(timed)) return 'لا يوجد أي ثمن مكتمل للنشر'
  for (const s of p.segments) {
    if (!timed(s)) { if (p.complete === true) return `ثمن ${s.eighth_id} : حد ناقص`; continue }
    if (s.start >= s.end) return `ثمن ${s.eighth_id} : البداية بعد النهاية`
    if (s.first_verse > s.last_verse) return `ثمن ${s.eighth_id} : plage de versets vide`
  }
  for (let i = 0; i < p.segments.length - 1; i++) {
    const a = p.segments[i], b = p.segments[i + 1]
    if (b.first_verse !== a.last_verse + 1) return `versets non contigus entre thumn ${a.eighth_id} et ${b.eighth_id}`
    if (!timed(a) || !timed(b)) continue
    const gap = b.start - a.end
    if (gap < -0.0001) return `تداخل بين ثمن ${a.eighth_id} و${b.eighth_id}`
    if (gap > 2.0) return `فراغ كبير (${gap.toFixed(2)} ث) بين ثمن ${a.eighth_id} و${b.eighth_id}`
  }
  const last = p.segments[p.segments.length - 1]
  if (timed(last) && Math.abs(last.end - p.audio_duration) > 0.5) return 'نهاية آخر ثمن لا تطابق مدة الصوت'
  return null
}

// ── Publication ──────────────────────────────────────────────────────────────
const jsonText = () => JSON.stringify(buildPayload(), null, 2)
const fileName = () => `${pad3(state.surahNo)}.json`

async function publish(partial = false) {
  const payload = buildPayload()
  if (payload.complete) partial = false
  const err = validatePayload(payload, partial)
  if (err) { setStatus(`✗ ${err}`, true); return }
  if (!GH.getPat()) { state.pendingPush = partial ? 'partial' : 'full'; openPatDialog(); return }
  const fn = fileName(), path = `${OUT_DIR}/${fn}`
  const timed = countTimed()
  setStatus(`⏳ نشر ${fn}…`)
  try {
    const msg = partial
      ? `data(timings-thumn): kouchi sourate ${payload.surah} (${payload.surah_name_ar}) — PARTIEL ${timed}/${payload.segment_count} thumn via thumn-marker`
      : `data(timings-thumn): kouchi sourate ${payload.surah} (${payload.surah_name_ar}) — ${payload.segment_count} thumn via thumn-marker`
    const res = await GH.putFile(path, jsonText() + '\n', msg)
    const sha = res.commit?.sha?.slice(0, 7) || ''
    if (navigator.vibrate) navigator.vibrate([15, 50, 15])
    try { localStorage.setItem(pubKey(state.surahNo), String(timed)) } catch {}
    if (partial) {
      setStatus(`✅ نُشر ${timed} من ${payload.segment_count} ثمن (${sha}) — تابع التعليم`)
      updateHeader()
      return
    }
    state.doneSurahs.add(payload.surah)
    renderHizbOptions()
    if (state.hizbNo != null) $('hizbSelect').value = String(state.hizbNo)
    renderSurahOptions(state.hizbNo ?? 1)
    const next = nextInQueue()
    if (next != null) {
      setStatus(`✅ نُشرت ${fn} (${sha}) — السورة التالية ${next}`)
      $('surahSelect').value = String(next)
      await loadSurah(next)
    } else {
      setStatus(`✅ نُشرت ${fn} (${sha})` + (state.hizbNo != null && hizbQueue(state.hizbNo).length === 0 ? ` — الحزب ${state.hizbNo} مكتمل ✓` : ''))
      openDone()
    }
  } catch (e) {
    if (/^401/.test(e.message)) { GH.setPat(''); state.pendingPush = partial ? 'partial' : 'full'; setStatus('✗ الـ token غير صالح أو منتهٍ — أدخله من جديد', true); openPatDialog() }
    else setStatus(`✗ GitHub : ${e.message}`, true)
  }
}
function openPatDialog() { $('patInput').value = GH.getPat(); $('patDialog').showModal(); setTimeout(() => $('patInput').focus(), 50) }

async function copyJson() {
  try { await navigator.clipboard.writeText(jsonText()); setStatus(`📋 نُسخ ${fileName()}`) }
  catch { setStatus('تعذّر النسخ — استعمل التنزيل', true) }
}
function downloadJson() {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([jsonText()], { type: 'application/json' }))
  a.download = fileName(); a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  setStatus(`⬇ ${fileName()} — ضعه في ${OUT_DIR}/`)
}

// ── Boutons ──────────────────────────────────────────────────────────────────
// L'en-tete ouvre et referme le choix hizb/sourate sans perdre l'etape en cours.
$('btnWhere').addEventListener('click', () => {
  audio.pause()
  if (state.screen === 'pick') {
    if (state.surahNo != null && state.prevScreen) showScreen(state.prevScreen)
    return
  }
  state.prevScreen = state.screen
  if (state.hizbNo != null) { $('hizbSelect').value = String(state.hizbNo); renderSurahOptions(state.hizbNo) }
  if (state.surahNo != null) $('surahSelect').value = String(state.surahNo)
  updatePickInfo()
  showScreen('pick')
})
$('hizbSelect').addEventListener('change', onHizbChange)
$('surahSelect').addEventListener('change', updatePickInfo)
$('btnLoad').addEventListener('click', () => {
  const n = parseInt($('surahSelect').value, 10)
  state.hizbNo = parseInt($('hizbSelect').value, 10)
  if (n) loadSurah(n)
})
$('btnBack5').addEventListener('click', () => { audio.currentTime = Math.max(0, audio.currentTime - JUMP); if (audio.paused) audio.play().catch(() => {}) })
$('btnFwd5').addEventListener('click', () => { audio.currentTime = Math.min(state.duration || 0, audio.currentTime + JUMP); if (audio.paused) audio.play().catch(() => {}) })
$('btnPlay').addEventListener('click', () => { state.stopAt = null; cancelSequence(); audio.paused ? audio.play().catch(() => {}) : audio.pause() })
$('btnHere').addEventListener('click', markHere)
$('btnEarlier').addEventListener('click', () => nudgeCut(-NUDGE))
$('btnLater').addEventListener('click', () => nudgeCut(NUDGE))
$('btnReplay').addEventListener('click', replayCut)
$('btnOk').addEventListener('click', confirmCut)
$('btnRedo').addEventListener('click', redo)
$('doneList').addEventListener('click', (e) => {
  const row = e.target.closest('[data-k]')
  if (!row) return
  state.reviewing = true
  openCheck(parseInt(row.dataset.k, 10))
})
// addEventListener passerait l'evenement comme 1er argument (= partial « vrai »)
$('btnPublish').addEventListener('click', () => (firstUnmarked(0) === -1 ? publish(false) : resume()))
$('btnReview').addEventListener('click', openDone)
$('btnPubPartial').addEventListener('click', () => publish(true))
// Sortie sans jeton, disponible a tout moment : copier le fichier (ou le
// telecharger si le presse-papiers est refuse) pour le faire publier ailleurs.
$('btnCopyPartial').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(jsonText()); setStatus(`📋 نُسخ ${fileName()} (${countTimed()} ثمن) — أرسله للنشر`) }
  catch { downloadJson() }
})
$('btnCopy').addEventListener('click', copyJson)
$('btnDownload').addEventListener('click', downloadJson)
$('patSave').addEventListener('click', () => {
  const v = $('patInput').value.trim()
  if (!v) return
  GH.setPat(v); $('patDialog').close()
  if (state.pendingPush) { const partial = state.pendingPush === 'partial'; state.pendingPush = false; publish(partial) }
})
$('patCancel').addEventListener('click', () => { $('patDialog').close(); state.pendingPush = false })

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea') || $('patDialog').open) return
  if (e.key === ' ') { e.preventDefault(); $('btnPlay').click() }
  else if (e.key === 'Enter') {
    e.preventDefault()
    if (state.screen === 'find') markHere()
    else if (state.screen === 'check') confirmCut()
  }
  else if (e.key === 'ArrowRight' && state.screen === 'find') $('btnBack5').click()
  else if (e.key === 'ArrowLeft' && state.screen === 'find') $('btnFwd5').click()
})

// ── Demarrage ────────────────────────────────────────────────────────────────
async function boot() {
  showScreen('pick')
  try {
    const [rs, re] = await Promise.all([fetch(`${DATA_BASE}surahs.json`), fetch(`${DATA_BASE}eighths.json`)])
    if (!rs.ok || !re.ok) throw new Error()
    state.surahs = await rs.json()
    const ej = await re.json()
    state.eighths = Array.isArray(ej) ? ej : (ej.eighths || [])
  } catch {
    setStatus('تعذّر تحميل بيانات المصحف — تحقق من الاتصال وأعد تحميل الصفحة', true)
    return
  }
  try {
    const rst = await fetch(`${STATUS_URL}?t=${Date.now()}`, { cache: 'no-store' })
    if (rst.ok) state.doneSurahs = new Set((await rst.json())?.reciters?.kouchi?.done ?? [])
  } catch {}
  renderHizbOptions()
  getQuranAll().catch(() => {})   // en tache de fond, pret avant le premier clic

  const n = parseInt(new URLSearchParams(location.search).get('surah') || '', 10)
  if (n >= 1 && n <= 114) {
    const h = state.eighths.find(t => t.verses_covered.some(v => v.sura === n))?.hizb ?? 1
    $('hizbSelect').value = String(h); onHizbChange()
    $('surahSelect').value = String(n); updatePickInfo()
    loadSurah(n)
  } else {
    const firstOpen = Array.from({ length: 60 }, (_, i) => i + 1).find(h => hizbQueue(h).length > 0) ?? 1
    $('hizbSelect').value = String(firstOpen); onHizbChange()
  }
}
boot()
