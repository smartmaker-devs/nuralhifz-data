/* Audio Marker — Kouchi (Warsh Muhammadi) — Android mobile-first
 * Convention: end[N] === start[N+1]. start[0] = 0. end[last] = audio.duration.
 * Output → data/timings/kouchi/{NNN}.json (clipboard / share / download).
 */

const RECITER = { id: 'el_ayoun_el_kouchi', name: 'El-Ayoun El-Kouchi', server: 'https://github.com/smartmaker-devs/nuralhifz-data/releases/download/audio-kouchi-v1/' }
const SCHEMA_VERSION = 1
const DATA_BASE = 'https://cdn.jsdelivr.net/gh/smartmaker-devs/nuralhifz-data@v1.0.0/data/'
const TIMINGS_BASE = 'https://cdn.jsdelivr.net/gh/smartmaker-devs/nuralhifz-data@main/data/timings/kouchi/'

// ── State ────────────────────────────────────────────────────────────────────
const state = {
  surahs: [],
  verses: [],
  surahNo: null,
  cursor: 0,
  marks: [],
  audioUrl: '',
  duration: 0,
  stopAt: null,
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
  if (saved) {
    try {
      const obj = JSON.parse(saved)
      if (Array.isArray(obj.marks)) state.marks = obj.marks.slice(0, state.verses.length)
    } catch {}
  }
  state.cursor = Math.min(state.marks.length, state.verses.length - 1)

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
    const start = i === 0 ? 0 : (state.marks[i-1] ?? null)
    const end   = state.marks[i] ?? null
    const done  = end != null
    const active = i === state.cursor

    const li = document.createElement('li')
    if (done) li.classList.add('done')
    if (active) li.classList.add('active')
    li.dataset.idx = i
    const adjustHtml = done
      ? `<span class="adj-row">
           <button class="adj" data-act="adj" data-i="${i}" data-d="-100" aria-label="−100ms">−</button>
           <button class="adj" data-act="adj" data-i="${i}" data-d="100" aria-label="+100ms">+</button>
         </span>`
      : ''
    li.innerHTML = `
      <span class="num">﴿${v.aya}﴾</span>
      <span class="text">${escapeHtml(v.text)}</span>
      <span class="range">
        <span class="t-start">${start != null ? fmt(start) : '—'}</span>
        <span class="t-end">${end != null ? fmt(end) : '—'}</span>
        ${adjustHtml}
      </span>
    `
    li.addEventListener('click', () => {
      if (start != null) audio.currentTime = start
      state.cursor = i
      // If verse is fully marked → preview only this verse (seek + play + auto-stop)
      if (end != null && start != null) {
        state.stopAt = end
        audio.play().catch(() => {})
      } else {
        state.stopAt = null
      }
      updateCursor()
      renderVerses()
    })
    li.querySelectorAll('button[data-act="adj"]').forEach(b => {
      b.addEventListener('click', (e) => {
        e.stopPropagation()
        adjustMark(parseInt(b.dataset.i, 10), parseInt(b.dataset.d, 10))
      })
    })
    list.appendChild(li)
  })
  const el = list.querySelector('li.active')
  el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}
const escapeHtml = (s) => s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))

// ── Marking ──────────────────────────────────────────────────────────────────
function markCurrent() {
  if (state.cursor >= state.verses.length) { setStatus('اكتمل ✓'); return }
  const t = audio.currentTime
  const prev = state.cursor === 0 ? 0 : (state.marks[state.cursor - 1] ?? 0)
  if (t <= prev) { setStatus(`${fmt(t)} ≤ نهاية السابقة ${fmt(prev)}`, true); return }
  state.marks[state.cursor] = t
  state.cursor = Math.min(state.cursor + 1, state.verses.length)
  persist()
  updateCursor()
  renderVerses()
  setStatus(`✓ آية ${state.cursor} — ${fmt(t)}`)
  // Haptic on mobile
  if (navigator.vibrate) navigator.vibrate(15)
}
// Adjust marks[i] by deltaMs, with constraints: must stay > previous mark and < next mark.
function adjustMark(i, deltaMs) {
  if (i < 0 || i >= state.marks.length || state.marks[i] == null) return
  const newVal = state.marks[i] + deltaMs / 1000
  const prev = i === 0 ? 0 : (state.marks[i-1] ?? 0)
  const nextMark = state.marks[i+1]
  const upper = nextMark != null ? nextMark : (state.duration || Infinity)
  if (newVal <= prev + 0.001) { setStatus(`الحد الأدنى ${fmt(prev)} — لا يمكن النزول أكثر`, true); return }
  if (newVal >= upper - 0.001) { setStatus(`الحد الأقصى ${fmt(upper)} — لا يمكن الصعود أكثر`, true); return }
  state.marks[i] = newVal
  persist()
  renderVerses()
  // Re-preview this verse with the new boundary
  state.cursor = i
  audio.currentTime = prev
  state.stopAt = newVal
  audio.play().catch(() => {})
  setStatus(`✎ آية ${i+1} → نهاية ${fmt(newVal)} (${deltaMs > 0 ? '+' : ''}${deltaMs}ms)`)
  if (navigator.vibrate) navigator.vibrate(8)
}

function undoLast() {
  const idx = Math.min(state.cursor, state.marks.length) - 1
  if (idx < 0) return
  state.marks.length = idx
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
  const timings = state.verses.map((v, i) => ({
    verse: v.aya,
    start: i === 0 ? 0 : (state.marks[i-1] ?? null),
    end:   state.marks[i] ?? null,
  }))
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
