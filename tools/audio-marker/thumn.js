/* Thumn Marker — Kouchi (Warsh Muhammadi) — Android mobile-first
 *
 * Schema v3 : l'unité marquée est le SEGMENT DE THUMN, pas le verset.
 *   Un segment = la portion d'un thumn (ثمن, 1–480) contenue dans une sourate.
 *   Marquer au thumn coûte 435 marques sur tout le Coran, contre 6214 au verset.
 *
 * La fin du dernier segment d'une sourate EST la fin de l'audio : elle est
 * remplie automatiquement et sortie de la séquence de marquage. On ne marque
 * donc que les frontières internes — et les 35 sourates tenant dans un seul
 * thumn sont complètes sans aucun clic.
 *
 * Sortie → data/timings_thumn/kouchi/{NNN}.json
 * (data/timings/ — les anciens timings verset — a été supprimé le 2026-09-13
 *  une fois l'app passée au ثمن ; récupérable dans l'historique git)
 */

const RECITER = { id: 'el_ayoun_el_kouchi', name: 'El-Ayoun El-Kouchi', server: 'https://github.com/smartmaker-devs/nuralhifz-data/releases/download/audio-kouchi-v1/' }
const SCHEMA_VERSION = 3
const DATA_BASE = 'https://cdn.jsdelivr.net/gh/smartmaker-devs/nuralhifz-data@v1.0.0/data/'
const STATUS_URL = 'https://cdn.jsdelivr.net/gh/smartmaker-devs/nuralhifz-data@main/data/audio_status.json'
const OUT_DIR = 'data/timings_thumn/kouchi'

const GH = {
  owner: 'smartmaker-devs', repo: 'nuralhifz-data', branch: 'main',
  patKey: 'marker:gh:pat',
  getPat() { return localStorage.getItem(this.patKey) || '' },
  setPat(v) { v ? localStorage.setItem(this.patKey, v) : localStorage.removeItem(this.patKey) },
  _hdr() {
    return {
      'Authorization': `Bearer ${this.getPat()}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    }
  },
  async getFileSha(path) {
    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}?ref=${this.branch}`
    const r = await fetch(url, { headers: this._hdr(), cache: 'no-store' })
    if (r.status === 404) return null
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(`${r.status}: ${e.message || 'GET contents failed'}`) }
    return (await r.json()).sha
  },
  async putFile(path, content, message) {
    const sha = await this.getFileSha(path)
    const body = { message, content: btoa(unescape(encodeURIComponent(content))), branch: this.branch }
    if (sha) body.sha = sha
    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`
    const r = await fetch(url, { method: 'PUT', headers: { ...this._hdr(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(`${r.status}: ${e.message || 'PUT failed'}`) }
    return r.json()
  },
}

// ── State ────────────────────────────────────────────────────────────────────
const state = {
  surahs: [],
  eighths: [],
  versesByAya: new Map(),  // aya -> texte, pour la sourate courante
  segments: [],            // segments de thumn de la sourate courante
  surahNo: null,
  hizbNo: null,            // hizb de la session en cours
  doneSurahs: new Set(),   // sourates deja marquees, d'apres data/audio_status.json
  cursor: 0,
  marks: [],               // marks[i] = fin du segment i ; le dernier = durée audio
  starts: [],              // starts[i] = début du segment i ; starts[0] = 0
  audioUrl: '',
  duration: 0,
  stopAt: null,
  pendingPush: false,
  adjustMode: 'end',
}

// Nombre de frontières que l'utilisateur doit réellement poser.
// La fin du dernier segment = durée audio, remplie automatiquement.
const innerCount = () => Math.max(0, state.segments.length - 1)

// ── DOM ──────────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id)
const audio = $('audio')

// ── Utils ────────────────────────────────────────────────────────────────────
const pad3 = (n) => String(n).padStart(3, '0')
const fmt = (s) => {
  if (!isFinite(s)) return '--:--.---'
  const m = Math.floor(s/60), r = s - m*60
  return `${String(m).padStart(2,'0')}:${r.toFixed(3).padStart(6,'0')}`
}
const setStatus = (msg, isError) => {
  const el = $('status')
  el.textContent = msg
  el.style.color = isError ? 'var(--red)' : 'var(--muted)'
}
const lsKey = (n) => `marker:kouchi:thumn:${pad3(n)}`
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))

// ── Découpage : segments de thumn d'une sourate ──────────────────────────────
// Un thumn qui traverse plusieurs sourates produit un segment par sourate.
function computeSegments(eighths, surahNo) {
  const segs = []
  for (const t of eighths) {
    const mine = t.verses_covered
      .filter(v => v.sura === surahNo)
      .map(v => v.aya)
      .sort((a, b) => a - b)
    if (!mine.length) continue
    const suras = t.verses_covered.map(v => v.sura)
    segs.push({
      eighth_id:        t.eighth_id,
      name_ar:          t.name_ar || `الثمن ${t.eighth_id}`,
      hizb:             t.hizb,
      first_verse:      mine[0],
      last_verse:       mine[mine.length - 1],
      continues_before: Math.min(...suras) < surahNo,
      continues_after:  Math.max(...suras) > surahNo,
      shared_boundary:  false,
    })
  }
  segs.sort((a, b) => a.eighth_id - b.eighth_id)

  // 12 versets portent une frontière de thumn en plein milieu (paires ۞) et
  // figurent donc dans DEUX thumns. On ne coupe pas une récitation au milieu
  // d'un verset : le thumn antérieur court jusqu'à la FIN du verset, le suivant
  // démarre au verset d'après. Les deux segments portent shared_boundary.
  for (let i = 1; i < segs.length; i++) {
    if (segs[i].first_verse <= segs[i-1].last_verse) {
      segs[i].first_verse = segs[i-1].last_verse + 1
      segs[i].shared_boundary = true
      segs[i-1].shared_boundary = true
    }
  }
  return segs.filter(s => s.first_verse <= s.last_verse)
}

// ── Estimation de la position d'une frontière ────────────────────────────────
// Valide sur les 118 marques verset reelles : mediane 0.47s, 99% sous 3s.
//
// Deux pieges dans le decompte de mots, mesures sur la donnee :
//   1. Le numero de verset s'ecrit U+FD3F <chiffres> U+FD3E — dans CET ordre,
//      alors qu'Unicode nomme FD3E « LEFT » et FD3F « RIGHT ». Une regex ecrite
//      d'apres les noms ne matche jamais et le chiffre compte comme un mot.
//   2. Les marques warsh (U+06EC, U+06D6…) sont A L'INTERIEUR des mots. Les
//      remplacer par un espace coupe le mot en deux : 81% des versets fausses.
//      Il faut les retirer par la chaine vide.
// Controle de non-regression : الفاتحة 1:1 = 8 mots. Le total du Coran depend
// de la version de donnee lue : 77430 sur @v1.0.0 (le tag auquel DATA_BASE est
// epingle), 77431 sur @main depuis le fix du ۞ colle en 2:233. 24 versets
// different entre les deux — sans effet sur l'estimation (1 mot sur 77430).
const VERSE_NUM = /﴿[^﴾]*﴾/g
const WARSH_MARKS = /[ۖ-ۭ۝࣢]|ـ/g
const wordCount = (t) => (t || '').replace(VERSE_NUM, ' ').replace(WARSH_MARKS, '').trim().split(/\s+/).filter(Boolean).length

// La basmala est recitee avant le verset 1 mais absente de son texte — sauf :
//   الفاتحة : elle EST fusionnee dans le verset 1 (deja comptee, +4 serait un doublon)
//   التوبة  : aucune basmala recitee
const BASMALA_WORDS = 4
// Fenetre d'ecoute autour de l'estimation. Symetrique et >= a l'erreur max
// mesuree (3.22s) : si l'estimation tombe TOT, la frontiere arrive apres elle
// et une fenetre courte du cote POST la ferait manquer. Teste sur la sourate
// 100 (frontiere reelle a 32.182s, estimee a 29.723s) : 2.46s d'ecart, soit
// deja 82% d'une fenetre a 3s.
const PREVIEW_PRE = 5
const PREVIEW_POST = 5

// Mots "audio" d'un segment : texte + basmala si le segment ouvre la sourate
function segmentWords(sg) {
  let w = 0
  for (let v = sg.first_verse; v <= sg.last_verse; v++) w += wordCount(state.versesByAya.get(v))
  if (sg.first_verse === 1 && state.surahNo !== 1 && state.surahNo !== 9) w += BASMALA_WORDS
  return w
}

// Estimation ancree : on repart de la derniere frontiere CONFIRMEE et on
// repartit le temps restant sur les mots restants. L'erreur ne s'accumule
// donc pas le long de la sourate — elle se remet a zero a chaque marque.
function estimateFor(i) {
  if (!state.duration || i < 0 || i >= state.segments.length) return null
  const prev = i === 0 ? 0 : (state.marks[i-1] ?? null)
  if (prev == null) return null
  let remaining = 0
  for (let k = i; k < state.segments.length; k++) remaining += state.segments[k].words ?? 0
  if (remaining <= 0) return null
  const est = prev + ((state.segments[i].words ?? 0) / remaining) * (state.duration - prev)
  return Math.min(est, state.duration)
}

// Amene l'audio devant la frontiere estimee et joue une fenetre autour.
function seekToEstimate(i, announce) {
  const est = estimateFor(i)
  if (est == null) { if (announce) setStatus('estimation indisponible — charge l’audio', true); return false }
  const lower = i === 0 ? 0 : (state.marks[i-1] ?? 0)
  audio.currentTime = Math.max(lower, est - PREVIEW_PRE)
  state.stopAt = Math.min(state.duration, est + PREVIEW_POST)
  audio.play().catch(() => {})
  if (announce) setStatus(`🎯 ${state.segments[i]?.name_ar ?? ''} — estimee vers ${fmt(est)}`)
  return true
}

// ── Session par hizb ─────────────────────────────────────────────────────────
// On raisonne en ثمن, donc on navigue par hizb. Mais l'audio est stocke PAR
// SOURATE : « ouvrir un hizb » ne charge pas un fichier, ca ouvre une FILE des
// sourates qu'il lui manque (1 a 5, mediane 2), enchainees automatiquement.
//
// Un fichier de sourate n'est poussable que COMPLET : marquer seulement la
// part d'un hizb dans une sourate longue ne produirait rien de publiable. La
// file contient donc des sourates entieres — le hizb dit dans quel ORDRE
// travailler et pourquoi, pas ce qu'on peut marquer a moitie.

// sourates traversees par un hizb
function surahsOfHizb(h) {
  const set = new Set()
  for (const t of state.eighths) {
    if (t.hizb !== h) continue
    for (const v of t.verses_covered) set.add(v.sura)
  }
  return [...set].sort((a, b) => a - b)
}

// ثمن jouables d'un hizb : tous ceux dont TOUTES les sourates sont marquees
function playableInHizb(h) {
  let n = 0
  for (const t of state.eighths) {
    if (t.hizb !== h) continue
    const surs = [...new Set(t.verses_covered.map(v => v.sura))]
    if (surs.every(s => state.doneSurahs.has(s))) n++
  }
  return n
}

// Une sourate compte comme faite si le manifeste la declare OU si le marquage
// local est complet (le CDN a ~12h de cache, le local est plus frais).
function isSurahDone(n) {
  if (state.doneSurahs.has(n)) return true
  try {
    const raw = localStorage.getItem(lsKey(n))
    if (raw) return JSON.parse(raw).complete === true
  } catch {}
  return false
}

function hizbQueue(h) { return surahsOfHizb(h).filter(n => !isSurahDone(n)) }

function renderHizbOptions() {
  const sel = $('hizbSelect')
  sel.innerHTML = ''
  for (let h = 1; h <= 60; h++) {
    const todo = hizbQueue(h).length
    const play = playableInHizb(h)
    const opt = document.createElement('option')
    opt.value = String(h)
    // Libelle court : replie, le <select> n'affiche qu'environ 130px. Le detail
    // complet (sourates restantes) part dans la ligne de statut a la selection.
    opt.textContent = todo === 0 ? `الحزب ${h} ✓` : `الحزب ${h} — ${play}/8`
    sel.appendChild(opt)
  }
}

// Liste des sourates du hizb choisi, celles qui restent d'abord
function renderSurahOptions(h) {
  const sel = $('surahSelect')
  sel.innerHTML = ''
  for (const n of surahsOfHizb(h)) {
    const meta = state.surahs.find(s => s.number === n)
    const inner = state.eighths.filter(t => t.hizb != null && t.start.sura === n && t.start.aya > 1).length
    const opt = document.createElement('option')
    opt.value = String(n)
    opt.textContent = isSurahDone(n)
      ? `✓ ${n}. ${meta?.name_ar ?? ''}`
      : `${n}. ${meta?.name_ar ?? ''} — ${inner} حد`
    sel.appendChild(opt)
  }
  const first = hizbQueue(h)[0]
  if (first != null) sel.value = String(first)
}

function onHizbChange() {
  const h = parseInt($('hizbSelect').value, 10)
  state.hizbNo = h
  renderSurahOptions(h)
  const q = hizbQueue(h)
  setStatus(q.length === 0
    ? `الحزب ${h} مكتمل ✓`
    : `الحزب ${h} — ${playableInHizb(h)}/8 ثمن · يتبقى ${q.length} سورة : ${q.join('، ')}`)
}

// Sourate suivante de la file du hizb courant, une fois celle-ci terminee
function nextInQueue() {
  if (state.hizbNo == null) return null
  return hizbQueue(state.hizbNo).find(n => n !== state.surahNo) ?? null
}

// ── Boot ─────────────────────────────────────────────────────────────────────
async function boot() {
  try {
    const [rs, re] = await Promise.all([
      fetch(`${DATA_BASE}surahs.json`),
      fetch(`${DATA_BASE}eighths.json`),
    ])
    if (!rs.ok || !re.ok) throw new Error()
    state.surahs = await rs.json()
    const ej = await re.json()
    state.eighths = Array.isArray(ej) ? ej : (ej.eighths || [])
  } catch {
    setStatus('échec chargement surahs.json / eighths.json', true)
    return
  }

  // Etat de couverture — lu sur @main : le manifeste bouge a chaque push, il ne
  // peut pas vivre sur le tag epingle. Absent = on part de zero, sans bloquer.
  try {
    const rst = await fetch(`${STATUS_URL}?t=${Date.now()}`, { cache: 'no-store' })
    if (rst.ok) {
      const st = await rst.json()
      state.doneSurahs = new Set(st?.reciters?.kouchi?.done ?? [])
    }
  } catch {}

  renderHizbOptions()
  updateTaskUI()   // etat coherent des le depart : consigne + boutons inactifs
  // Lance le texte du Coran en tache de fond : il est le plus souvent pret
  // avant le premier « تحميل », sans retarder l'affichage du menu.
  getQuranAll().catch(() => {})
  if (navigator.share) $('btnShare').hidden = false

  const params = new URLSearchParams(location.search)
  const n = parseInt(params.get('surah') || '', 10)
  if (n >= 1 && n <= 114) {
    // Acces direct a une sourate : on cale le hizb sur celui qui la contient
    const h = state.eighths.find(t => t.verses_covered.some(v => v.sura === n))?.hizb
    if (h) { $('hizbSelect').value = String(h); onHizbChange() }
    $('surahSelect').value = String(n)
    await loadSurah(n)
  } else {
    // Ouvre sur le premier hizb incomplet
    const firstOpen = Array.from({ length: 60 }, (_, i) => i + 1).find(h => hizbQueue(h).length > 0) ?? 1
    $('hizbSelect').value = String(firstOpen)
    onHizbChange()
  }
}

// ── Texte du Coran : un seul telechargement par session ──────────────────────
// quran_muhammadi.json pese 3,7 Mo. Il etait refetch a CHAQUE chargement de
// sourate : insupportable au telephone, et la file du hizb enchaine les
// sourates, donc le cout se payait en boucle. On le garde en memoire.
// Timeout explicite : sans lui un reseau qui traine laisse l'UI figee sans
// message, ce qui est indiscernable d'un plantage.
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
  } finally {
    clearTimeout(timer)
  }
}

// ── Load surah ───────────────────────────────────────────────────────────────
async function loadSurah(n) {
  state.surahNo = n

  try {
    if (!_quranAll) setStatus('جارٍ تنزيل نص القرآن (3.7 Mo) — مرة واحدة فقط…')
    else setStatus(`جارٍ تحميل السورة ${n}…`)
    const all = await getQuranAll()
    state.versesByAya = new Map(all.filter(v => v.sura === n).map(v => [v.aya, v.text]))
  } catch (e) {
    setStatus(e?.name === 'AbortError'
      ? 'انتهت مهلة تنزيل نص القرآن (60 ث) — تحقق من الاتصال وأعد المحاولة'
      : `فشل تنزيل نص القرآن : ${e?.message ?? e}`, true)
    return
  }

  state.segments = computeSegments(state.eighths, n)
  for (const sg of state.segments) sg.words = segmentWords(sg)
  state.audioUrl = `${RECITER.server}${pad3(n)}.mp3`
  audio.src = state.audioUrl

  state.marks = []
  state.starts = []
  const saved = localStorage.getItem(lsKey(n))
  if (saved) {
    try {
      const obj = JSON.parse(saved)
      if (Array.isArray(obj.marks))  state.marks  = obj.marks.slice(0, state.segments.length)
      if (Array.isArray(obj.starts)) state.starts = obj.starts.slice(0, state.segments.length)
    } catch {}
  }
  syncStarts()
  state.cursor = Math.min(countInnerMarked(), Math.max(0, innerCount() - 1))
  state.adjustMode = 'end'

  $('metaPanel').hidden = false
  $('metaUrl').textContent = state.audioUrl
  $('metaSegCount').textContent = String(state.segments.length)
  if (state.hizbNo != null) {
    const q = hizbQueue(state.hizbNo)
    const pos = q.indexOf(n)
    $('metaHizb').textContent = `${state.hizbNo} · ${playableInHizb(state.hizbNo)}/8 ثمن`
      + (pos >= 0 && q.length > 1 ? ` · سورة ${pos + 1}/${q.length}` : '')
  }
  $('actionBar').hidden = false
  $('exportBar').hidden = false

  renderSegments()
  updateCursor()

  if (innerCount() === 0) {
    setStatus(state.doneSurahs.has(n)
      ? `السورة ${n} منشورة بالفعل ✓ — لا شيء تعلّمه هنا`
      : `السورة ${n} — ثمن واحد، لا حدود داخلية. جاهز للرفع ✓`)
  } else {
    setStatus(`السورة ${n} — ${state.segments.length} ثمن، ${innerCount()} حد للتعليم.`)
  }
}

// Nombre de frontières internes déjà posées
function countInnerMarked() {
  let c = 0
  for (let i = 0; i < innerCount(); i++) if (state.marks[i] != null) c++
  return c
}

// starts[0] = 0 ; par défaut le segment suivant démarre où le précédent finit
function syncStarts() {
  state.starts[0] = 0
  for (let i = 1; i < state.segments.length; i++) {
    if (state.starts[i] == null && state.marks[i-1] != null) state.starts[i] = state.marks[i-1]
  }
}

// La fin du dernier segment est toujours la durée de l'audio
function sealLastMark() {
  const last = state.segments.length - 1
  if (last >= 0 && state.duration) state.marks[last] = state.duration
}

// ── Render ───────────────────────────────────────────────────────────────────
// Consigne + etat des boutons. MARK et 🎯 restaient actifs meme quand il n'y
// avait rien a marquer : on cliquait et on recevait une erreur au lieu de
// comprendre qu'il fallait changer de sourate.
function updateTaskUI() {
  const hint = $('taskHint')
  const mark = $('btnMark')
  const seek = $('btnSeek')
  if (!hint) return

  const setBtns = (on, why) => {
    for (const b of [mark, seek]) {
      if (!b) continue
      b.disabled = !on
      b.style.opacity = on ? '' : '.35'
      b.title = on ? '' : why
    }
  }

  if (state.surahNo == null) {
    hint.className = 'task-hint idle'
    hint.innerHTML = 'اختر حزباً ثم سورة، واضغط <strong>تحميل</strong>.'
    setBtns(false, 'حمّل سورة أولاً')
    return
  }
  if (innerCount() === 0) {
    const published = state.doneSurahs.has(state.surahNo)
    hint.className = 'task-hint done'
    hint.innerHTML = published
      ? `هذه السورة <strong>منشورة بالفعل ✓</strong> ولا تحتوي أيّ حدّ داخلي — اختر سورة أخرى من القائمة.`
      : `ثمن واحد يغطّي السورة كاملة : <strong>لا شيء تعلّمه هنا</strong>. اضغط <strong>⬆ GitHub</strong> للنشر مباشرة.`
    setBtns(false, 'لا حدود داخلية في هذه السورة')
    return
  }
  if (countInnerMarked() >= innerCount()) {
    hint.className = 'task-hint done'
    hint.innerHTML = 'اكتملت كل الحدود ✓ — <strong>اضغط على أيّ ثمن لسماعه كاملاً</strong> '
      + 'والتأكّد من عدم التداخل، ثم <strong>⬆ GitHub</strong> للنشر.'
    setBtns(false, 'اكتملت كل الحدود')
    return
  }
  // Deja publiee mais des frontieres a marquer : le marquage local est vide
  // (publie depuis un autre appareil). Sans cet avertissement on refait un
  // travail deja fait, et un push l'ecraserait.
  if (state.doneSurahs.has(state.surahNo) && countInnerMarked() === 0) {
    hint.className = 'task-hint done'
    hint.innerHTML = `هذه السورة <strong>منشورة بالفعل ✓</strong>. يمكنك إعادة تعليمها، لكن النشر سيستبدل الموجود — `
      + `إن لم يكن ذلك مقصوداً، اختر سورة أخرى.`
    setBtns(true, '')
    return
  }

  hint.className = 'task-hint'
  hint.innerHTML = 'اضغط <strong>🎯</strong> للقفز إلى الموضع المقدَّر، استمع، ثم <strong>MARK</strong> عند نهاية الثمن. '
    + 'النصّ المعروض هو <strong>آخر آية</strong> في الثمن — هي التي يجب أن تسمع نهايتها.'
  setBtns(true, '')
}

function updateCursor() {
  const done = countInnerMarked()
  $('metaCursor').textContent = innerCount() === 0
    ? 'لا حدود ✓'
    : (done >= innerCount() ? 'اكتمل ✓' : `${done + 1} / ${innerCount()}`)
  updateTaskUI()  // point de passage unique : loadSurah, MARK et undo passent tous ici
}

function renderSegments() {
  const list = $('segList')
  list.innerHTML = ''
  state.segments.forEach((sg, i) => {
    const isLast = i === state.segments.length - 1
    const end    = state.marks[i] ?? null
    const start  = i === 0 ? 0 : (state.starts[i] ?? state.marks[i-1] ?? null)
    const done   = end != null
    const active = !isLast && i === state.cursor

    const range = sg.first_verse === sg.last_verse
      ? `﴿${sg.first_verse}﴾`
      : `﴿${sg.first_verse}–${sg.last_verse}﴾`

    const badges = []
    if (sg.continues_before) badges.push('<span class="muted">⇠ تتمة</span>')
    if (sg.continues_after)  badges.push('<span class="muted">تتمة ⇢</span>')
    if (sg.shared_boundary)  badges.push('<span class="muted" title="حد داخل آية">۞</span>')
    if (isLast)              badges.push('<span class="muted">نهاية السورة</span>')

    // On marque la FIN du segment : c'est le dernier verset qu'on écoute.
    const cue = state.versesByAya.get(sg.last_verse) || ''
    // L'estimation n'est calculable que pour la frontiere courante : elle
    // s'ancre sur la precedente CONFIRMEE, qui n'existe pas au-dela.
    const estVal = (!isLast && end == null) ? estimateFor(i) : null
    const estText = estVal != null ? fmt(estVal) : ''

    const li = document.createElement('li')
    if (done) li.classList.add('done')
    if (active) li.classList.add('active')
    li.dataset.idx = String(i)
    li.innerHTML = `
      <span class="num">${escapeHtml(sg.name_ar)}<br><small class="muted">${range}</small></span>
      <span class="text">${escapeHtml(cue)} ${badges.join(' ')}</span>
      <span class="range">
        <span class="t-start">${start != null ? fmt(start) : '—'}</span>
        <span class="t-end">${end != null ? fmt(end) : (estText ? '🎯 ' + estText : '—')}</span>
      </span>
    `
    // Taper une ligne = ecouter le ثمن ENTIER (verification du debordement).
    // L'ajustement fin de la frontiere se fait via le panneau ±, qui rejoue
    // deja les 2s autour a chaque tap. Le dernier segment est ecoutable comme
    // les autres : sa fin est la duree audio, pas une raison de l'exclure.
    li.addEventListener('click', () => {
      if (!isLast) state.cursor = i
      if (!playSegment(i) && start != null) {
        audio.currentTime = start
        state.stopAt = null
      }
      updateCursor()
      renderSegments()
    })
    list.appendChild(li)
  })
  list.querySelector('li.active')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  updateAdjustPanel()
}

// Frontiere sur laquelle porte le panneau d'ajustement.
// Une fois la derniere marque posee, state.cursor vaut innerCount() — c'est
// sa facon de dire « termine ». Le panneau se refermait donc PILE au moment
// ou l'on veut reecouter et corriger son travail. On le rabat sur la derniere
// frontiere marquee au lieu de le cacher. On ne clampe pas state.cursor
// lui-meme : markCurrent s'en sert pour refuser de marquer au-dela.
function focusIndex() {
  const last = innerCount() - 1
  return last < 0 ? -1 : Math.min(state.cursor, last)
}

function updateAdjustPanel() {
  const panel = $('verseAdjust')
  if (!panel) return
  const i = focusIndex()
  const isMarked = i >= 0 && state.marks[i] != null
  if (!isMarked) { panel.hidden = true; return }
  panel.hidden = false

  const startTab = $('vaTabStart')
  if (startTab) {
    startTab.disabled = (i === 0)
    if (i === 0 && state.adjustMode === 'start') state.adjustMode = 'end'
  }
  $('vaTabEnd')?.classList.toggle('active', state.adjustMode === 'end')
  $('vaTabStart')?.classList.toggle('active', state.adjustMode === 'start')

  $('vaVerseNum').textContent = state.segments[i]?.name_ar ?? String(i + 1)
  const display = state.adjustMode === 'start'
    ? (state.starts[i] ?? state.marks[i-1] ?? 0)
    : state.marks[i]
  $('vaEndDisplay').textContent = fmt(display)
  $('vaModeLabel').textContent = state.adjustMode === 'start' ? 'ضبط بداية الثمن' : 'ضبط نهاية الثمن'
}

function setAdjustMode(mode) {
  if (mode === 'start' && focusIndex() === 0) return
  state.adjustMode = mode
  updateAdjustPanel()
  const i = focusIndex()
  if (i >= 0 && state.marks[i] != null) {
    const end = state.marks[i]
    const start = state.starts[i] ?? (i === 0 ? 0 : state.marks[i-1])
    if (mode === 'start' && i > 0) previewStartBoundary(state.marks[i-1] ?? 0, start, end)
    else previewBoundary(start, end)
  }
}

// ── Marking ──────────────────────────────────────────────────────────────────
function markCurrent() {
  if (innerCount() === 0) { setStatus('لا حدود داخلية في هذه السورة ✓'); return }
  if (state.cursor >= innerCount()) { setStatus('اكتمل ✓'); return }
  const t = audio.currentTime
  const prev = state.cursor === 0 ? 0 : (state.marks[state.cursor - 1] ?? 0)
  if (t <= prev) { setStatus(`${fmt(t)} ≤ الحد السابق ${fmt(prev)}`, true); return }
  state.marks[state.cursor] = t
  if (state.cursor + 1 < state.segments.length && state.starts[state.cursor + 1] == null) {
    state.starts[state.cursor + 1] = t
  }
  if (state.starts[0] == null) state.starts[0] = 0
  const sg = state.segments[state.cursor]
  state.cursor = Math.min(state.cursor + 1, innerCount())
  sealLastMark()
  persist()
  updateCursor()
  renderSegments()
  if (navigator.vibrate) navigator.vibrate(15)

  // Enchaine directement sur la frontiere suivante : l'ecoute lineaire d'une
  // sourate de 2h pour 38 frontieres n'est pas tenable.
  if (state.cursor < innerCount() && seekToEstimate(state.cursor, false)) {
    const est = estimateFor(state.cursor)
    setStatus(`✓ ${sg?.name_ar ?? ''} ${fmt(t)} → 🎯 suivante vers ${fmt(est)}`)
  } else {
    // Sourate terminee : on annonce la suite sans charger quoi que ce soit.
    // Enchainer tout seul ferait perdre un marquage non pousse.
    const next = nextInQueue()
    setStatus(next != null
      ? `✓ اكتملت السورة ${state.surahNo} — ادفع إلى GitHub، ثم السورة ${next}`
      : `✓ اكتملت السورة ${state.surahNo} — ادفع إلى GitHub`)
  }
}

// Ecoute d'un ثمن ENTIER, du debut a la fin. C'est le seul moyen d'entendre
// s'il deborde : la preview de frontiere (2s) sert a ajuster au millieme, pas
// a verifier le contenu. C'est aussi exactement ce que l'app fera jouer.
function playSegment(i) {
  const sg = state.segments[i]
  if (!sg) return false
  const start = i === 0 ? 0 : (state.starts[i] ?? state.marks[i-1] ?? null)
  const end = state.marks[i] ?? null
  if (start == null || end == null) { setStatus('هذا الثمن غير مُعلَّم بعد', true); return false }
  audio.currentTime = start
  state.stopAt = end
  audio.play().catch(() => {})
  const dur = end - start
  setStatus(`▶ ${sg.name_ar} ﴿${sg.first_verse}–${sg.last_verse}﴾ — ${fmt(start)} → ${fmt(end)} (${dur.toFixed(1)} ث)`)
  return true
}

function previewBoundary(lo, end) {
  const PRE = 1.5, POST = 0.5
  audio.currentTime = Math.max(lo, end - PRE)
  state.stopAt = Math.min((state.duration || end + POST), end + POST)
  audio.play().catch(() => {})
}

function previewStartBoundary(prevEnd, start, end) {
  const PRE = 0.5, POST = 1.5
  audio.currentTime = Math.max(prevEnd, start - PRE)
  state.stopAt = Math.min(end, start + POST)
  audio.play().catch(() => {})
}

function adjustMark(i, deltaMs) {
  if (i < 0 || i >= innerCount()) return
  if (state.adjustMode === 'start') return adjustStart(i, deltaMs)

  if (state.marks[i] == null) return
  const newVal = state.marks[i] + deltaMs / 1000
  const lower = state.starts[i] ?? (i === 0 ? 0 : state.marks[i-1] ?? 0)
  const nextStart = state.starts[i+1]
  const upper = nextStart != null ? nextStart : (state.duration || Infinity)
  if (newVal <= lower + 0.001) { setStatus(`الحد الأدنى ${fmt(lower)}`, true); return }
  if (newVal >= upper - 0.001) { setStatus(`الحد الأقصى ${fmt(upper)}`, true); return }
  state.marks[i] = newVal
  persist()
  renderSegments()
  state.cursor = i
  previewBoundary(lower, newVal)
  setStatus(`✎ ${state.segments[i]?.name_ar ?? ''} → نهاية ${fmt(newVal)} (${deltaMs > 0 ? '+' : ''}${deltaMs}ms)`)
  if (navigator.vibrate) navigator.vibrate(8)
}

function adjustStart(i, deltaMs) {
  if (i === 0) { setStatus('بداية الثمن الأول ثابتة عند الصفر', true); return }
  if (state.starts[i] == null || state.marks[i-1] == null) return
  const newVal = state.starts[i] + deltaMs / 1000
  const lower = state.marks[i-1]
  const end = state.marks[i] ?? state.duration ?? Infinity
  if (newVal < lower - 0.001) { setStatus(`الحد الأدنى ${fmt(lower)}`, true); return }
  if (newVal >= end - 0.001) { setStatus(`الحد الأقصى ${fmt(end)}`, true); return }
  state.starts[i] = newVal
  persist()
  renderSegments()
  state.cursor = i
  previewStartBoundary(lower, newVal, end)
  setStatus(`✎ ${state.segments[i]?.name_ar ?? ''} → بداية ${fmt(newVal)} (${deltaMs > 0 ? '+' : ''}${deltaMs}ms)`)
  if (navigator.vibrate) navigator.vibrate(8)
}

function undoLast() {
  const idx = countInnerMarked() - 1
  if (idx < 0) return
  state.marks[idx] = null
  state.starts[idx + 1] = null
  state.cursor = idx
  persist()
  updateCursor()
  renderSegments()
  setStatus(`↶ تراجع — ${state.segments[idx]?.name_ar ?? ''}`)
  if (navigator.vibrate) navigator.vibrate([10, 30, 10])
}

// ── Persist ──────────────────────────────────────────────────────────────────
function persist() {
  localStorage.setItem(lsKey(state.surahNo), JSON.stringify(buildPayload()))
  $('autosave').textContent = `حُفظ ${new Date().toLocaleTimeString('en-GB')}`
}

function buildPayload() {
  const surahMeta = state.surahs.find(s => s.number === state.surahNo) || {}
  const startOf = (i) => (i === 0 ? 0 : (state.starts[i] ?? state.marks[i-1] ?? null))
  const segments = state.segments.map((sg, i) => ({
    eighth_id:   sg.eighth_id,
    name_ar:     sg.name_ar,
    hizb:        sg.hizb,
    first_verse: sg.first_verse,
    last_verse:  sg.last_verse,
    start:       startOf(i),
    end:         state.marks[i] ?? null,
    ...(sg.continues_before ? { continues_before: true } : {}),
    ...(sg.continues_after  ? { continues_after:  true } : {}),
    ...(sg.shared_boundary  ? { shared_boundary:  true } : {}),
  }))
  return {
    schema_version: SCHEMA_VERSION,
    granularity:    'thumn',
    surah:          state.surahNo,
    surah_name_ar:  surahMeta.name_ar || null,
    segment_count:  state.segments.length,
    inner_boundaries: innerCount(),
    reciter:        RECITER.id,
    reciter_name:   RECITER.name,
    audio_url:      state.audioUrl,
    audio_duration: state.duration || null,
    marked_at:      new Date().toISOString(),
    segments,
    complete: state.segments.length > 0
              && segments.every(s => typeof s.start === 'number' && typeof s.end === 'number'),
  }
}

// ── Export ───────────────────────────────────────────────────────────────────
const jsonText = () => JSON.stringify(buildPayload(), null, 2)
const fileName = () => `${pad3(state.surahNo)}.json`

async function copyJson() {
  try {
    await navigator.clipboard.writeText(jsonText())
    setStatus(`📋 نُسخ JSON (${fileName()})`)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = jsonText()
    document.body.appendChild(ta)
    ta.select()
    try { document.execCommand('copy'); setStatus('📋 نُسخ (fallback)') }
    catch { setStatus('échec copie — utilise download', true) }
    ta.remove()
  }
}

async function shareJson() {
  try {
    const file = new File([jsonText()], fileName(), { type: 'application/json' })
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: fileName(), text: `Thumn markers — ${fileName()}` })
    } else {
      await navigator.share({ title: fileName(), text: jsonText() })
    }
    setStatus('📤 تمت المشاركة')
  } catch (e) {
    if (e.name !== 'AbortError') setStatus('échec share — utilise copy', true)
  }
}

function downloadJson() {
  const blob = new Blob([jsonText()], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = fileName()
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  setStatus(`⬇ ${a.download} — ضعه في ${OUT_DIR}/`)
}

// Validation stricte avant push.
function validatePayload(p) {
  if (p.schema_version !== 3) return 'schema_version doit être 3'
  if (!Number.isInteger(p.surah) || p.surah < 1 || p.surah > 114) return `surah invalide (${p.surah})`
  if (!Array.isArray(p.segments) || p.segments.length !== p.segment_count) return 'segments.length ≠ segment_count'
  if (p.complete !== true) return 'سورة non terminée (complete=false) — ne pas pousser'
  if (p.segments[0]?.start !== 0) return 'start du premier thumn doit être 0'
  if (!p.audio_duration) return 'audio_duration inconnue — recharge l’audio'

  for (let i = 0; i < p.segments.length; i++) {
    const s = p.segments[i]
    if (typeof s.start !== 'number' || typeof s.end !== 'number') return `thumn ${s.eighth_id} : borne manquante`
    if (s.start >= s.end) return `thumn ${s.eighth_id} : start ≥ end (segment vide)`
    if (s.first_verse > s.last_verse) return `thumn ${s.eighth_id} : plage de versets vide`
  }
  // Contiguïté : pas de recouvrement, pas de trou > 2s
  for (let i = 0; i < p.segments.length - 1; i++) {
    const gap = p.segments[i+1].start - p.segments[i].end
    if (gap < -0.0001) return `recouvrement entre thumn ${p.segments[i].eighth_id} et ${p.segments[i+1].eighth_id}`
    if (gap > 2.0) return `trou trop large (${gap.toFixed(2)}s) entre thumn ${p.segments[i].eighth_id} et ${p.segments[i+1].eighth_id}`
  }
  // Couverture : les versets doivent se suivre sans trou ni chevauchement
  for (let i = 0; i < p.segments.length - 1; i++) {
    if (p.segments[i+1].first_verse !== p.segments[i].last_verse + 1) {
      return `versets non contigus entre thumn ${p.segments[i].eighth_id} et ${p.segments[i+1].eighth_id}`
    }
  }
  const last = p.segments[p.segments.length - 1]
  if (Math.abs(last.end - p.audio_duration) > 0.5) {
    return `fin du dernier thumn (${last.end.toFixed(3)}s) ≠ durée audio (${p.audio_duration.toFixed(3)}s)`
  }
  return null
}

async function pushToGitHub() {
  const payload = buildPayload()
  const err = validatePayload(payload)
  if (err) { setStatus(`✗ ${err}`, true); return }

  if (!GH.getPat()) { state.pendingPush = true; openPatDialog(); return }

  const fn = fileName()
  const path = `${OUT_DIR}/${fn}`
  const ok = confirm(`📤 Pousser ${fn} sur GitHub ?\n\nSourate ${payload.surah} (${payload.surah_name_ar})\n${payload.segment_count} thumn · ${payload.inner_boundaries} frontière(s) marquée(s)\nDurée: ${fmt(payload.audio_duration)}\nChemin: ${path}`)
  if (!ok) return

  setStatus(`⏳ envoi de ${fn} à GitHub…`)
  try {
    const message = `data(timings-thumn): kouchi sourate ${payload.surah} (${payload.surah_name_ar}) — ${payload.segment_count} thumn via thumn-marker`
    const res = await GH.putFile(path, jsonText() + '\n', message)
    const sha = res.commit?.sha?.slice(0, 7) || ''
    if (navigator.vibrate) navigator.vibrate([15, 50, 15])

    // La sourate est publiee : elle compte desormais comme faite. On rafraichit
    // l'avancement des hizbs et on enchaine sur la suivante de la file.
    state.doneSurahs.add(payload.surah)
    const next = nextInQueue()
    renderHizbOptions()
    if (state.hizbNo != null) $('hizbSelect').value = String(state.hizbNo)
    renderSurahOptions(state.hizbNo ?? 1)
    if (next != null) {
      $('surahSelect').value = String(next)
      setStatus(`✅ ${fn} poussé (${sha}) — chargement de la سورة ${next}…`)
      await loadSurah(next)
    } else {
      const h = state.hizbNo
      setStatus(h != null && hizbQueue(h).length === 0
        ? `✅ ${fn} poussé (${sha}) — الحزب ${h} مكتمل ✓`
        : `✅ ${fn} poussé sur GitHub (${sha})`)
    }
  } catch (e) {
    if (/^401/.test(e.message)) {
      setStatus('✗ token invalide ou expiré — re-saisir', true)
      GH.setPat('')
      state.pendingPush = true
      openPatDialog()
    } else {
      setStatus(`✗ GitHub: ${e.message}`, true)
    }
  }
}

function openPatDialog() {
  $('patInput').value = GH.getPat()
  $('patDialog').showModal()
  setTimeout(() => $('patInput').focus(), 50)
}

// ── Audio events ─────────────────────────────────────────────────────────────
audio.addEventListener('loadedmetadata', () => {
  state.duration = audio.duration
  $('totTime').textContent = fmt(audio.duration)
  sealLastMark()
  persist()
  updateCursor()
  renderSegments()
})
audio.addEventListener('timeupdate', () => {
  $('curTime').textContent = fmt(audio.currentTime)
  if (state.stopAt != null && audio.currentTime >= state.stopAt) {
    audio.pause()
    state.stopAt = null
  }
})
audio.addEventListener('play',  () => $('btnPlayPause').classList.add('playing'))
audio.addEventListener('pause', () => $('btnPlayPause').classList.remove('playing'))
audio.addEventListener('ended', () => $('btnPlayPause').classList.remove('playing'))

// ── Buttons ──────────────────────────────────────────────────────────────────
$('hizbSelect').addEventListener('change', onHizbChange)
$('btnLoad').addEventListener('click', () => {
  const n = parseInt($('surahSelect').value, 10)
  if (n) loadSurah(n)
})
$('btnMark').addEventListener('click', markCurrent)
$('btnUndo').addEventListener('click', undoLast)
$('btnSeek').addEventListener('click', () => seekToEstimate(state.cursor, true))
$('btnPlayPause').addEventListener('click', () => {
  state.stopAt = null
  audio.paused ? audio.play() : audio.pause()
})
$('btnPushGh').addEventListener('click', pushToGitHub)
$('patSave').addEventListener('click', () => {
  const val = $('patInput').value.trim()
  if (!val) { setStatus('token vide', true); return }
  GH.setPat(val)
  $('patDialog').close()
  setStatus('🔑 token enregistré localement')
  if (state.pendingPush) { state.pendingPush = false; pushToGitHub() }
})
$('patCancel').addEventListener('click', () => { $('patDialog').close(); state.pendingPush = false })
$('btnCopy').addEventListener('click', copyJson)
$('btnShare').addEventListener('click', shareJson)
$('btnDownload').addEventListener('click', downloadJson)
document.querySelectorAll('.rates button').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.rates button').forEach(x => x.classList.remove('active'))
    b.classList.add('active')
    audio.playbackRate = parseFloat(b.dataset.rate)
  })
})
$('verseAdjust').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act="va"]')
  if (!btn) return
  adjustMark(focusIndex(), parseInt(btn.dataset.d, 10))
})
$('btnPlaySegment').addEventListener('click', () => playSegment(focusIndex()))
$('btnPlayBoundary').addEventListener('click', () => {
  const i = focusIndex()
  const end = state.marks[i]
  if (end == null) { setStatus('هذا الحدّ غير مُعلَّم بعد', true); return }
  const start = i === 0 ? 0 : (state.starts[i] ?? state.marks[i-1] ?? 0)
  if (state.adjustMode === 'start' && i > 0) previewStartBoundary(state.marks[i-1] ?? 0, start, end)
  else previewBoundary(start, end)
})
$('vaTabEnd').addEventListener('click', () => setAdjustMode('end'))
$('vaTabStart').addEventListener('click', () => setAdjustMode('start'))
document.querySelectorAll('.nudges button').forEach(b => {
  b.addEventListener('click', () => {
    const ms = parseInt(b.dataset.nudge, 10)
    audio.currentTime = Math.max(0, Math.min(state.duration || 0, audio.currentTime + ms/1000))
  })
})

// ── Keyboard (desktop bonus) ─────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea')) return
  const k = e.key
  if (k === ' ') { e.preventDefault(); audio.paused ? audio.play() : audio.pause() }
  else if (k === 'm' || k === 'M' || k === 'ArrowRight') { e.preventDefault(); markCurrent() }
  else if (k === 'z' || k === 'Z' || k === 'ArrowLeft')  { e.preventDefault(); undoLast() }
  else if (k === 'ArrowUp')   { e.preventDefault(); audio.currentTime = Math.max(0, audio.currentTime - 1) }
  else if (k === 'ArrowDown') { e.preventDefault(); audio.currentTime = Math.min(state.duration || 0, audio.currentTime + 1) }
})

boot()
