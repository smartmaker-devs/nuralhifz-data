/* Audio Marker — Kouchi (Warsh Muhammadi) — Android mobile-first
 * Schema v2: marks[] = end timestamps. starts[] = start timestamps (length = verse_count).
 *            Gap between verses ALLOWED (start[N+1] >= end[N], not strictly equal).
 *            Schema v1 (legacy 114.json) had end[N] === start[N+1]; still readable.
 * Output → data/timings/kouchi/{NNN}.json (clipboard / share / download).
 */

const RECITER = { id: 'el_ayoun_el_kouchi', name: 'El-Ayoun El-Kouchi', server: 'https://github.com/smartmaker-devs/nuralhifz-data/releases/download/audio-kouchi-v1/' }
const SCHEMA_VERSION = 2
const DATA_BASE = 'https://cdn.jsdelivr.net/gh/smartmaker-devs/nuralhifz-data@v1.0.0/data/'
const TIMINGS_BASE = 'https://cdn.jsdelivr.net/gh/smartmaker-devs/nuralhifz-data@main/data/timings/kouchi/'
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
  verses: [],
  surahNo: null,
  cursor: 0,
  marks: [],            // marks[i] = end of verse (i+1)
  starts: [],           // starts[i] = start of verse (i+1) ; starts[0] always 0
  audioUrl: '',
  duration: 0,
  stopAt: null,
  pendingPush: false,
  adjustMode: 'end',    // 'end' adjusts marks[cursor], 'start' adjusts starts[cursor]
}

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
const lsKey = (n) => `marker:kouchi:${pad3(n)}`

// ── Boot ─────────────────────────────────────────────────────────────────────
async function boot() {
  try {
    const r = await fetch(`${DATA_BASE}surahs.json`)
    if (!r.ok) throw new Error()
    state.surahs = await r.json()
  } catch {
    setStatus('échec chargement surahs.json — sers ce dossier en HTTP', true)
    return
  }
  const sel = $('surahSelect')
  for (const s of state.surahs) {
    const opt = document.createElement('option')
    opt.value = s.number
    opt.textContent = `${s.number}. ${s.name_ar} (${s.verse_count})`
    sel.appendChild(opt)
  }
  setStatus('جاهز — اختر سورة.')

  // Hide Share button if Web Share API absent (most desktop browsers)
  if (navigator.share) $('btnShare').hidden = false

  // Review mode via URL ?surah=N — auto-load committed JSON for verification
  const params = new URLSearchParams(location.search)
  const reviewN = parseInt(params.get('surah') || '', 10)
  if (reviewN >= 1 && reviewN <= 114) {
    $('surahSelect').value = reviewN
    await loadSurah(reviewN)
    await overlayCommittedMarks(reviewN)
  }
}

// Fetch committed marks from public repo and overlay them (review mode)
async function overlayCommittedMarks(n) {
  try {
    const r = await fetch(`${TIMINGS_BASE}${pad3(n)}.json`, { cache: 'no-store' })
    if (!r.ok) { setStatus(`لا يوجد JSON محفوظ للسورة ${n} في المستودع`); return }
    const obj = await r.json()
    if (!Array.isArray(obj.marks)) throw new Error('marks missing')
    state.marks = obj.marks.slice(0, state.verses.length)
    if (Array.isArray(obj.starts)) {
      state.starts = obj.starts.slice(0, state.verses.length)
    } else {
      state.starts = []
    }
    syncStartsToMarks()
    state.cursor = Math.min(state.marks.length, state.verses.length - 1)
    persist()
    updateCursor()
    renderVerses()
    setStatus(`📥 وضع المراجعة: ${obj.marks.length} علامة من المستودع (${pad3(n)}.json)`)
  } catch (e) {
    setStatus(`فشل تحميل JSON من المستودع: ${e.message}`, true)
  }
}

// ── Load surah ───────────────────────────────────────────────────────────────
async function loadSurah(n) {
  setStatus(`جارٍ تحميل السورة ${n}…`)
  state.surahNo = n

  try {
    const r = await fetch(`${DATA_BASE}quran_muhammadi.json`)
    if (!r.ok) throw new Error()
    const all = await r.json()
    state.verses = all
      .filter(v => v.sura === n)
      .map(v => ({ aya: v.aya, text: v.text }))
      .sort((a,b) => a.aya - b.aya)
  } catch {
    setStatus('échec chargement quran_muhammadi.json', true)
    return
  }

  state.audioUrl = `${RECITER.server}${pad3(n)}.mp3`
  audio.src = state.audioUrl

  const saved = localStorage.getItem(lsKey(n))
  state.marks = []
  state.starts = []
  if (saved) {
    try {
      const obj = JSON.parse(saved)
      if (Array.isArray(obj.marks)) state.marks = obj.marks.slice(0, state.verses.length)
      if (Array.isArray(obj.starts)) state.starts = obj.starts.slice(0, state.verses.length)
    } catch {}
  }
  // Backfill starts from marks if missing (legacy v1: zero-gap)
  syncStartsToMarks()
  state.cursor = Math.min(state.marks.length, state.verses.length - 1)
  state.adjustMode = 'end'

  $('metaPanel').hidden = false
  $('metaUrl').textContent = state.audioUrl
  $('metaVerseCount').textContent = state.verses.length
  $('actionBar').hidden = false
  $('exportBar').hidden = false

  renderVerses()
  updateCursor()
  setStatus(`السورة ${n} — ${state.verses.length} آية. شغّل الصوت واضغط MARK في نهاية كل آية.`)
}

// ── Render ───────────────────────────────────────────────────────────────────
function updateCursor() {
  $('metaCursor').textContent = state.cursor < state.verses.length
    ? `${state.cursor + 1} / ${state.verses.length}`
    : 'اكتمل ✓'
}
function renderVerses() {
  const list = $('versesList')
  list.innerHTML = ''
  state.verses.forEach((v, i) => {
    const end   = state.marks[i] ?? null
    const start = i === 0 ? 0 : (state.starts[i] ?? (state.marks[i-1] ?? null))
    const done  = end != null
    const active = i === state.cursor

    const li = document.createElement('li')
    if (done) li.classList.add('done')
    if (active) li.classList.add('active')
    li.dataset.idx = i
    li.innerHTML = `
      <span class="num">﴿${v.aya}﴾</span>
      <span class="text">${escapeHtml(v.text)}</span>
      <span class="range">
        <span class="t-start">${start != null ? fmt(start) : '—'}</span>
        <span class="t-end">${end != null ? fmt(end) : '—'}</span>
      </span>
    `
    li.addEventListener('click', () => {
      state.cursor = i
      if (end != null && start != null) {
        // Preview around whichever boundary the current adjust mode targets
        if (state.adjustMode === 'start' && i > 0) {
          previewStartBoundary(state.marks[i-1] ?? 0, start, end)
        } else {
          previewBoundary(start, end)
        }
      } else if (start != null) {
        audio.currentTime = start
        state.stopAt = null
      } else {
        state.stopAt = null
      }
      updateCursor()
      renderVerses()
    })
    list.appendChild(li)
  })
  const el = list.querySelector('li.active')
  el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  updateAdjustPanel()
}

// Show/hide & populate the contextual adjuster for the active verse
function updateAdjustPanel() {
  const panel = $('verseAdjust')
  if (!panel) return
  const i = state.cursor
  const isMarked = i >= 0 && i < state.marks.length && state.marks[i] != null
  if (!isMarked) { panel.hidden = true; return }
  panel.hidden = false

  // Disable "start" tab for verse 1 (start always 0, immutable)
  const startTab = $('vaTabStart')
  if (startTab) {
    startTab.disabled = (i === 0)
    if (i === 0 && state.adjustMode === 'start') state.adjustMode = 'end'
  }

  // Update tab visual state
  $('vaTabEnd')?.classList.toggle('active', state.adjustMode === 'end')
  $('vaTabStart')?.classList.toggle('active', state.adjustMode === 'start')

  $('vaVerseNum').textContent = String(i + 1)
  const display = state.adjustMode === 'start'
    ? (state.starts[i] ?? state.marks[i-1] ?? 0)
    : state.marks[i]
  $('vaEndDisplay').textContent = fmt(display)
  $('vaModeLabel').textContent = state.adjustMode === 'start' ? 'ضبط بداية الآية' : 'ضبط نهاية الآية'
}

function setAdjustMode(mode) {
  if (mode === 'start' && state.cursor === 0) return
  state.adjustMode = mode
  updateAdjustPanel()
  // Re-preview with the new boundary focus
  const i = state.cursor
  if (i < state.marks.length && state.marks[i] != null) {
    const end = state.marks[i]
    const start = state.starts[i] ?? (i === 0 ? 0 : state.marks[i-1])
    if (mode === 'start' && i > 0) {
      previewStartBoundary(state.marks[i-1] ?? 0, start, end)
    } else {
      previewBoundary(start, end)
    }
  }
}
const escapeHtml = (s) => s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))

// ── Marking ──────────────────────────────────────────────────────────────────
function markCurrent() {
  if (state.cursor >= state.verses.length) { setStatus('اكتمل ✓'); return }
  const t = audio.currentTime
  const prev = state.cursor === 0 ? 0 : (state.marks[state.cursor - 1] ?? 0)
  if (t <= prev) { setStatus(`${fmt(t)} ≤ نهاية السابقة ${fmt(prev)}`, true); return }
  state.marks[state.cursor] = t
  // Default: next verse starts where this one ends (zero gap, user can adjust later)
  if (state.cursor + 1 < state.verses.length && state.starts[state.cursor + 1] == null) {
    state.starts[state.cursor + 1] = t
  }
  if (state.starts[0] == null) state.starts[0] = 0
  state.cursor = Math.min(state.cursor + 1, state.verses.length)
  persist()
  updateCursor()
  renderVerses()
  setStatus(`✓ آية ${state.cursor} — ${fmt(t)}`)
  // Haptic on mobile
  if (navigator.vibrate) navigator.vibrate(15)
}
// Ensure starts[] has a value for every i ≤ marks.length, defaulting to zero-gap
// (start[i] = marks[i-1], start[0] = 0). Preserves any explicit values already set.
function syncStartsToMarks() {
  state.starts[0] = 0
  for (let i = 1; i <= state.marks.length && i < state.verses.length; i++) {
    if (state.starts[i] == null) state.starts[i] = state.marks[i-1]
  }
}

// Smart preview around the END of a verse: last ~1.5s + 0.5s after end mark.
function previewBoundary(lo, end) {
  const PRE = 1.5, POST = 0.5
  const previewStart = Math.max(lo, end - PRE)
  const previewEnd   = Math.min((state.duration || end + POST), end + POST)
  audio.currentTime = previewStart
  state.stopAt = previewEnd
  audio.play().catch(() => {})
}

// Smart preview around the START of a verse: 0.5s before start + 1.5s after.
// Lets the user hear what's EXCLUDED (echo of prev verse) vs the clean attack.
function previewStartBoundary(prevEnd, start, end) {
  const PRE = 0.5, POST = 1.5
  const previewStart = Math.max(prevEnd, start - PRE)
  const previewEnd   = Math.min(end, start + POST)
  audio.currentTime = previewStart
  state.stopAt = previewEnd
  audio.play().catch(() => {})
}

// Adjust either marks[i] (end) or starts[i] (start) by deltaMs, with constraints.
function adjustMark(i, deltaMs) {
  if (i < 0 || i >= state.verses.length) return

  if (state.adjustMode === 'start') {
    return adjustStart(i, deltaMs)
  }

  // END adjustment
  if (state.marks[i] == null) return
  const newVal = state.marks[i] + deltaMs / 1000
  const lower = state.starts[i] ?? (i === 0 ? 0 : state.marks[i-1] ?? 0)
  const nextStart = state.starts[i+1]
  const upper = nextStart != null ? nextStart : (state.duration || Infinity)
  if (newVal <= lower + 0.001) { setStatus(`الحد الأدنى ${fmt(lower)} — لا يمكن النزول أكثر`, true); return }
  if (newVal >= upper - 0.001) { setStatus(`الحد الأقصى ${fmt(upper)} — لا يمكن الصعود أكثر`, true); return }
  state.marks[i] = newVal
  persist()
  renderVerses()
  state.cursor = i
  previewBoundary(lower, newVal)
  setStatus(`✎ آية ${i+1} → نهاية ${fmt(newVal)} (${deltaMs > 0 ? '+' : ''}${deltaMs}ms)`)
  if (navigator.vibrate) navigator.vibrate(8)
}

// Adjust starts[i]. Constraints: starts[i] >= marks[i-1] (no overlap with prev verse)
// AND starts[i] < marks[i] (verse non-empty). starts[0] cannot move (always 0).
function adjustStart(i, deltaMs) {
  if (i === 0) { setStatus('بداية الآية الأولى ثابتة عند الصفر', true); return }
  if (state.starts[i] == null || state.marks[i-1] == null) return
  const newVal = state.starts[i] + deltaMs / 1000
  const lower = state.marks[i-1]
  const end = state.marks[i] ?? state.duration ?? Infinity
  if (newVal < lower - 0.001) { setStatus(`الحد الأدنى ${fmt(lower)} (نهاية السابقة)`, true); return }
  if (newVal >= end - 0.001) { setStatus(`الحد الأقصى ${fmt(end)} (نهاية الآية)`, true); return }
  state.starts[i] = newVal
  persist()
  renderVerses()
  state.cursor = i
  previewStartBoundary(lower, newVal, end)
  setStatus(`✎ آية ${i+1} → بداية ${fmt(newVal)} (${deltaMs > 0 ? '+' : ''}${deltaMs}ms)`)
  if (navigator.vibrate) navigator.vibrate(8)
}

function undoLast() {
  const idx = Math.min(state.cursor, state.marks.length) - 1
  if (idx < 0) return
  state.marks.length = idx
  state.starts.length = Math.min(state.starts.length, idx + 1) // keep starts[0..idx], drop starts[idx+1..]
  state.cursor = idx
  persist()
  updateCursor()
  renderVerses()
  setStatus(`↶ تراجع — الآية ${idx + 1}`)
  if (navigator.vibrate) navigator.vibrate([10, 30, 10])
}

// ── Persist ──────────────────────────────────────────────────────────────────
function persist() {
  const payload = buildPayload()
  localStorage.setItem(lsKey(state.surahNo), JSON.stringify(payload))
  $('autosave').textContent = `حُفظ ${new Date().toLocaleTimeString('en-GB')}`
}

function buildPayload() {
  const surahMeta = state.surahs.find(s => s.number === state.surahNo) || {}
  const startOf = (i) => (i === 0 ? 0 : (state.starts[i] ?? state.marks[i-1] ?? null))
  const timings = state.verses.map((v, i) => ({
    verse: v.aya,
    start: startOf(i),
    end:   state.marks[i] ?? null,
  }))
  // Materialize starts[] aligned to verse_count for output (default to zero-gap)
  const startsOut = state.verses.map((_, i) => startOf(i))
  return {
    schema_version: SCHEMA_VERSION,
    surah: state.surahNo,
    surah_name_ar: surahMeta.name_ar || null,
    verse_count: state.verses.length,
    reciter: RECITER.id,
    reciter_name: RECITER.name,
    audio_url: state.audioUrl,
    audio_duration: state.duration || null,
    marked_at: new Date().toISOString(),
    marks: state.marks,
    starts: startsOut,
    timings,
    complete: state.marks.length === state.verses.length
              && state.marks.every(x => typeof x === 'number'),
  }
}

// ── Export ───────────────────────────────────────────────────────────────────
function jsonText() { return JSON.stringify(buildPayload(), null, 2) }
function fileName() { return `${pad3(state.surahNo)}.json` }

async function copyJson() {
  try {
    await navigator.clipboard.writeText(jsonText())
    setStatus(`📋 نُسخ JSON (${fileName()}) — الصِق في GitHub web editor`)
  } catch {
    // Fallback for non-secure contexts
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
      await navigator.share({ files: [file], title: fileName(), text: `Audio markers — ${fileName()}` })
    } else {
      await navigator.share({ title: fileName(), text: jsonText() })
    }
    setStatus('📤 تمت المشاركة')
  } catch (e) {
    if (e.name !== 'AbortError') setStatus('échec share — utilise copy', true)
  }
}
// Strict validation before pushing to GitHub.
// v1 (legacy): zero-gap strictly enforced (end[i] === start[i+1]).
// v2 (current): gaps allowed (end[i] <= start[i+1], capped at 2s max gap to avoid orphan silences).
function validatePayload(p) {
  if (![1, 2].includes(p.schema_version)) return 'schema_version doit être 1 ou 2'
  if (!Number.isInteger(p.surah) || p.surah < 1 || p.surah > 114) return `surah invalide (${p.surah})`
  if (p.complete !== true) return 'سورة non terminée (complete=false) — ne pas pousser'
  if (!Array.isArray(p.marks) || p.marks.length !== p.verse_count) return `marks.length (${p.marks?.length}) ≠ verse_count (${p.verse_count})`
  if (!Array.isArray(p.timings) || p.timings.length !== p.verse_count) return `timings.length ≠ verse_count`
  if (p.timings[0]?.start !== 0) return 'start[0] doit être 0'
  for (let i = 0; i < p.marks.length; i++) {
    const m = p.marks[i]
    if (typeof m !== 'number' || !isFinite(m)) return `marks[${i}] invalide`
    if (i > 0 && m <= p.marks[i-1] + 0.001) return `marks[${i+1}] ≤ marks[${i}] (non strictement croissant)`
  }
  for (let i = 0; i < p.timings.length; i++) {
    const t = p.timings[i]
    if (typeof t.start !== 'number' || typeof t.end !== 'number') return `timings[${i+1}] invalide`
    if (t.start >= t.end) return `الآية ${i+1} : start ≥ end (verset vide)`
  }
  for (let i = 0; i < p.timings.length - 1; i++) {
    const gap = p.timings[i+1].start - p.timings[i].end
    if (p.schema_version === 1 && Math.abs(gap) > 0.0001) return `v1: gap/overlap entre آية ${i+1} et ${i+2}`
    if (gap < -0.0001) return `overlap (recouvrement) entre آية ${i+1} et ${i+2}`
    if (gap > 2.0) return `gap trop large (${gap.toFixed(2)}s) entre آية ${i+1} et ${i+2}`
  }
  if (p.audio_duration && Math.abs(p.marks[p.marks.length-1] - p.audio_duration) > 0.5) {
    return `end[last] (${p.marks.at(-1).toFixed(3)}s) ≠ audio_duration (${p.audio_duration.toFixed(3)}s) à plus de 0.5s`
  }
  return null
}

async function pushToGitHub() {
  const payload = buildPayload()
  const err = validatePayload(payload)
  if (err) { setStatus(`✗ ${err}`, true); return }

  if (!GH.getPat()) {
    state.pendingPush = true
    openPatDialog()
    return
  }

  const fileName = `${pad3(state.surahNo)}.json`
  const path = `data/timings/${RECITER.id === 'el_ayoun_el_kouchi' ? 'kouchi' : RECITER.id}/${fileName}`
  const ok = confirm(`📤 Pousser ${fileName} sur GitHub ?\n\nSourate ${payload.surah} (${payload.surah_name_ar}) — ${payload.verse_count} versets\nDurée: ${fmt(payload.audio_duration)}\nBranche: ${GH.branch}`)
  if (!ok) return

  setStatus(`⏳ envoi de ${fileName} à GitHub…`)
  try {
    const message = `data(timings): kouchi sourate ${payload.surah} (${payload.surah_name_ar}) — ${payload.verse_count} versets via audio-marker`
    const res = await GH.putFile(path, jsonText() + '\n', message)
    const sha = res.commit?.sha?.slice(0, 7) || ''
    const action = res.content ? (res.commit?.parents?.length ? 'mis à jour' : 'créé') : ''
    setStatus(`✅ ${fileName} ${action} sur GitHub (${sha})`)
    if (navigator.vibrate) navigator.vibrate([15, 50, 15])
  } catch (e) {
    if (/^401/.test(e.message)) {
      setStatus(`✗ token invalide ou expiré — re-saisir`, true)
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

function downloadJson() {
  const blob = new Blob([jsonText()], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = fileName()
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  setStatus(`⬇ ${a.download} — ضعه في data/timings/kouchi/`)
}
function importJson(file) {
  const r = new FileReader()
  r.onload = () => {
    try {
      const obj = JSON.parse(r.result)
      if (!obj.surah || !Array.isArray(obj.marks)) throw new Error()
      $('surahSelect').value = obj.surah
      loadSurah(obj.surah).then(() => {
        state.marks = obj.marks.slice(0, state.verses.length)
        state.cursor = Math.min(state.marks.length, state.verses.length - 1)
        persist()
        updateCursor()
        renderVerses()
        setStatus(`تم استيراد ${obj.marks.length} علامة.`)
      })
    } catch {
      setStatus('JSON غير صالح', true)
    }
  }
  r.readAsText(file)
}

// ── Audio events ─────────────────────────────────────────────────────────────
audio.addEventListener('loadedmetadata', () => {
  state.duration = audio.duration
  $('totTime').textContent = fmt(audio.duration)
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
$('btnLoad').addEventListener('click', () => {
  const n = parseInt($('surahSelect').value, 10)
  if (n) loadSurah(n)
})
$('btnMark').addEventListener('click', markCurrent)
$('btnUndo').addEventListener('click', undoLast)
$('btnPlayPause').addEventListener('click', () => {
  // Manual play clears any pending "stop at end of verse" from preview mode
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
$('patCancel').addEventListener('click', () => {
  $('patDialog').close()
  state.pendingPush = false
})
$('btnCopy').addEventListener('click', copyJson)
$('btnShare').addEventListener('click', shareJson)
$('btnDownload').addEventListener('click', downloadJson)
$('btnImport').addEventListener('click', () => $('fileImport').click())
$('fileImport').addEventListener('change', (e) => {
  const f = e.target.files?.[0]
  if (f) importJson(f)
  e.target.value = ''
})
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
  adjustMark(state.cursor, parseInt(btn.dataset.d, 10))
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
