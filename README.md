# المصحف المحمدي — Maghreb Warsh Quran Data

[![License: CC BY 4.0](https://img.shields.io/badge/Data-CC--BY--4.0-blue.svg)](LICENSE)
[![Code: MIT](https://img.shields.io/badge/Code-MIT-green.svg)](LICENSE-CODE)

**0% tolerance** verse-level data for the **Moroccan Muhammadi mushaf** (المصحف المحمدي), published by the Ministry of Habous and Islamic Affairs of the Kingdom of Morocco.

Built for **Maghreb users** (Maroc / Algérie / Tunisie) who follow the Warsh recitation and the Madani verse-counting tradition.

- **Riwaya (روایة):** Warsh `'an` Nafi` (ورش عن نافع)
- **Numbering:** Madani / Maghrebi (6,214 verses)
- **Pagination:** 638 pages, matching the printed Muhammadi pagination on [mushaf.ma](https://mushaf.ma)
- **Eighth index:** 480 ثُمْن boundaries (60 hizbs × 8 eighths), with **inclusive start and end** ranges

---

## مقدمة بالعربية

هذه البيانات مستخرجة من المصحف المحمدي المطبوع بالمغرب، بأرقام السور والآيات والأحزاب والأثمان كما هي معتمدة رسمياً (الرواية: ورش عن نافع، الترقيم: المدني الأخير، 6214 آية).

تم التحقق من كل ثُمْن (۞) مقابل الصورة الأصلية للصفحة المطبوعة، ليوافق الموضع الدقيق في المصحف المحمدي.

- النص المعتمد: `data/quran_muhammadi.json`
- حدود الأثمان (480 ثُمْن): `data/eighths.json`
- فهارس مجمّعة: `data/surahs.json`, `data/hizbs.json`, `data/juzs.json`
- صور الصفحات الأصلية: `raw/muhammadi-pages/` (638 PNG)

---

## What's in `data/`

| File | Entries | Purpose |
|---|---|---|
| `quran_muhammadi.json` | 6,214 | Full verses with `text`, `text_simple`, `page_mushafma`, `hizb`, `juz`, `eighth_id`, `word_count`, `is_sajda` (11 — Maliki tradition) |
| `eighths.json` | 480 | Every ۞ boundary with **inclusive** `start` / `end`, `verses_covered`, `word_count`, `name_ar` |
| `surahs.json` | 114 | Name (ar/en), revelation (makki/madani), verse count, first/last eighth |
| `hizbs.json` | 60 | Hizb → juz mapping, start/end, pages, word count |
| `juzs.json` | 30 | Juz → hizb range, pages, word count |
| `audio_sources.json` | 19 reciters | Warsh `'an` Nafi` recitations — per-surah and per-verse streaming URLs |
| `VERSION.json` | — | Dataset version + totals |

See `docs/SCHEMA.md` for full field documentation.

---

## Quick start

### JavaScript / TypeScript

```js
// Bundle or fetch from GitHub raw CDN (jsDelivr recommended):
const BASE = "https://cdn.jsdelivr.net/gh/ELAHMADI/ma-mushaf-muhammadi-data@v1/data";

const [verses, eighths, surahs] = await Promise.all([
  fetch(`${BASE}/quran_muhammadi.json`).then(r => r.json()),
  fetch(`${BASE}/eighths.json`).then(r => r.json()),
  fetch(`${BASE}/surahs.json`).then(r => r.json()),
]);

// Find the eighth containing Al-Fatiha:5
const v = verses.find(x => x.sura === 1 && x.aya === 5);
const e = eighths.find(x => x.eighth_id === v.eighth_id);
console.log(`${e.name_ar} — hizb ${e.hizb}`);
```

### Python

```python
import json, urllib.request
BASE = "https://cdn.jsdelivr.net/gh/ELAHMADI/ma-mushaf-muhammadi-data@v1/data"
with urllib.request.urlopen(f"{BASE}/quran_muhammadi.json") as r:
    verses = json.load(r)
```

### React Native (bundle at build time)

```bash
# In your project root
curl -L "https://github.com/ELAHMADI/ma-mushaf-muhammadi-data/releases/download/v1.0.0/quran_muhammadi.json" \
  -o ./assets/data/quran_muhammadi.json
```

---

## Audio (Warsh reciters)

`data/audio_sources.json` lists **16 Warsh `'an` Nafi` reciters** with per-surah streams (`001.mp3` … `114.mp3`), prioritizing Maghreb voices:

| Reciter | Country | URL pattern |
|---|---|---|
| عمر القزابري — Omar Al-Kazabri | 🇲🇦 Morocco | `server9.mp3quran.net/omar_warsh/{001..114}.mp3` |
| ياسين الجزائري — Yassine Al-Jazairi | 🇩🇿 Algeria | `server11.mp3quran.net/qari/{001..114}.mp3` |
| رشيد بلعالية — Rachid Belaalya | 🇲🇦 Morocco | `server6.mp3quran.net/bl3/Rewayat-Warsh-A-n-Nafi/…` |
| عبد المجيب بنكيران — Benkirane | 🇲🇦 Morocco | `server16.mp3quran.net/A-Benkirane/…` |
| …and 12 more | | see `audio_sources.json` |

All endpoints verified **2026-04-21**. Per-surah Warsh audio is fully aligned with the Moroccan numbering used by this dataset.

### Reciters used by the Nur al-Hifz app

Three reciters carry ثمن-level timings in `data/timings_thumn/<key>/{NNN}.json`. Their MP3s are mirrored on this repository's GitHub Releases, so timings always point to a stable, byte-identical file:

| Reciter | Key | Mirror (GitHub Releases) | Format |
|---|---|---|---|
| العيون الكوشي — El-Ayoun El-Kouchi | `kouchi` | `audio-kouchi-v1/{NNN}.mp3` | 128 kbps CBR |
| عبد المجيب بنكيران — Abdul-Majeed Benkirane | `benkirane` | not yet mirrored | — |
| ياسين الجزائري — Yassine Al-Jazairi | `jazairi` | `audio-jazairi-v1/{NNN}.mp3` | CBR, mixed: MPEG-1 96 kbps mono (62), MPEG-2 96 kbps mono 22–24 kHz (49), MPEG-1 128/192 kbps stereo (3) |

Coverage (surahs done, playable ثمن) is generated in `data/audio_status.json` on every push by `.github/workflows/timings.yml`.

---

## How it was built

1. **Ground truth:** 638 page images downloaded from [mushaf.ma](https://mushaf.ma) → `raw/muhammadi-pages/`.
2. **Text candidate A:** Al-Lawh Almahfoudh APK (extracted `coran.txt` → `raw/lawh_verses.json`).
3. **Text candidate B:** [Zizwar/mushaf-mauri](https://github.com/zizwar/mushaf-mauri) (MIT) → `raw/mauri_verses.json`.
4. **Majority-merge** (`scripts/majority_merge.py`) with targeted rules:
   - Both agree → use Mauri (richer vocalization)
   - Bismillah bundled into aya 1 → strip (112 cases)
   - Verse-boundary disagreements are always **Lawh truncation at ۞ markers** → use Mauri
5. **Eighth boundaries:** extracted 477 ۞ markers from Mauri, added 3 implicit boundaries (Fatiha 1:1, 75:1 Al-Qiyamah, 76:1 Al-Insan) to reach the canonical 480.
6. **Visual validation:** each of the 480 eighths verified against its mushaf.ma page image via `data/eighths_viewer.html`.

Full pipeline: `scripts/*.py`. Full decision log: `reports/divergences.md`, `reports/eighths_report.md`.

---

## Schema highlights

### Verse (`quran_muhammadi.json`)

```json
{
  "gid": 1,
  "sura": 1,
  "aya": 1,
  "text": "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ",
  "text_simple": "بسم الله الرحمن الرحيم",
  "page_mushafma": 3,
  "page_mauri": 2,
  "hizb": 1,
  "juz": 1,
  "eighth_id": 1,
  "word_count": 4,
  "char_count": 39,
  "is_sajda": false,
  "source_decision": "..."
}
```

### Eighth (`eighths.json`)

```json
{
  "eighth_id": 460,
  "hizb": 58,
  "pos_in_hizb": 4,
  "name_ar": "النصف",
  "juz": 29,
  "is_surah_start": false,
  "start": {"sura": 74, "aya": 31, "char_offset": 0,  "partial_verse": false, "mushafma_page": 606},
  "end":   {"sura": 74, "aya": 55, "char_offset": 87, "partial_verse": false, "mushafma_page": 607, "inclusive": true},
  "verses_covered": [{"sura": 74, "aya": 31}, …],
  "verse_count": 25,
  "word_count": 180
}
```

Full field docs: [`docs/SCHEMA.md`](docs/SCHEMA.md).

---

## Sajda verses

`is_sajda` follows the **Maliki / Maghreb tradition: 11 sajda verses**. See [`docs/SAJDA.md`](docs/SAJDA.md) for the full list.

---

## License

- **Data** (JSON, images, reports): [CC BY 4.0](LICENSE) — free to use, share, adapt, with attribution.
- **Source code** (`scripts/*.py`, HTML viewers): [MIT](LICENSE-CODE).
- **Page images** (`raw/muhammadi-pages/`): © Ministry of Habous, Morocco — distributed here under fair-use study provisions; contact [mushaf.ma](https://mushaf.ma) for commercial licensing.

## Citation

```bibtex
@dataset{elahmadi_muhammadi_2026,
  author    = {El-Ahmadi, Noureddine},
  title     = {ma-mushaf-muhammadi-data: Verse-level data for the Moroccan Muhammadi Quran},
  year      = 2026,
  url       = {https://github.com/ELAHMADI/ma-mushaf-muhammadi-data},
  version   = {1.0.0},
  license   = {CC-BY-4.0}
}
```

## Contributing

Spot a divergence between the data and the printed mushaf? Open an issue with:
- Sura:verse reference
- The mushaf.ma page number
- A screenshot or description of the mismatch

Pull requests welcome for metadata improvements (translations, transliteration, tajweed rules).
