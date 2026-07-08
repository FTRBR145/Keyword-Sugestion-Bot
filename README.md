# 🔍 Keyword Suggestion Bot

Bot otomatis untuk scraping Google Autocomplete Suggestions dengan UI Dashboard berbasis web. Cocok untuk riset kata kunci SEO secara masif dan terstruktur.

---

## ✨ Fitur

- **Golden Keywords** — Ambil 10 sugesti teratas dari Google secara otomatis
- **Seeding A–Z / 0–9 / Simbol** — Prefix dan suffix yang bisa dikonfigurasi
- **Anti-Bot** — User-Agent realistis, delay acak, sembunyikan tanda otomasi
- **Real-time Log** — Status proses tampil langsung via Server-Sent Events (SSE)
- **Tombol Cancel** — Hentikan proses kapan saja
- **Export Excel** — Hasil terklasifikasi ke `.xlsx` dengan format rapi
- **Klasifikasi Otomatis** — Golden, Buying, Longtail (≥4 kata), Competitor

---

## 🗂️ Struktur Proyek

```
keyword-scraping-tool/
├── public/
│   └── index.html        # Dashboard UI
├── src/
│   ├── scraper.js        # Logika Playwright (Tahap 1–3)
│   └── classifier.js     # Klasifikasi + export Excel
├── scripts/
│   ├── start.js          # Auto-kill port lama lalu start server
│   └── stop.js           # Hentikan server
├── server.js             # Express + SSE API
└── package.json
```

---

## 🚀 Instalasi

### Prasyarat
- [Node.js](https://nodejs.org/) v18 atau lebih baru
- Git

### Langkah

```bash
# 1. Clone repo
git clone https://github.com/FTRBR145/Keyword-Sugestion-Bot.git
cd Keyword-Sugestion-Bot

# 2. Install dependencies
npm install

# 3. Install browser Playwright
npx playwright install chromium

# 4. Jalankan server
npm start
```

Buka browser ke **http://localhost:3000**

---

## 🖥️ Cara Pakai

1. Masukkan **Kata Kunci Target** (contoh: `sunat anak`)
2. Atur **Pengaturan Seed**:
   - Arah: Depan, Belakang, atau keduanya
   - Karakter: A–Z, 0–9, Simbol
3. Aktifkan **Mode Browser** jika ingin lihat proses secara visual
4. Klik **Mulai Scraping**
5. Pantau log real-time di panel kanan
6. Setelah selesai, klik **Download Excel**

---

## ⚙️ Alur Kerja

```
Input Keyword
     │
     ▼
Tahap 1 ── Ketik "keyword " → ambil 10 Golden Keywords dari dropdown Google
     │
     ▼
Tahap 2 ── Untuk setiap char (a–z, 0–9, ...):
           Ketik "keyword" → pindah cursor ke depan → sisipkan "a keyword"
     │
     ▼
Tahap 3 ── Untuk setiap char:
           Ketik "keyword" → tambah " a" di belakang → "keyword a"
     │
     ▼
Klasifikasi → Golden / Buying / Longtail / Competitor
     │
     ▼
Export → keyword_DD-MM-YYYY_HH-mm.xlsx
```

---

## 📊 Format Excel Output

File `.xlsx` terdiri dari 3 sheet:

| Sheet | Isi |
|---|---|
| **Hasil Seeding** | Semua keyword mentah + 4 kolom klasifikasi |
| **Golden Keywords** | 10 keyword utama dari Tahap 1 |
| **Ringkasan** | Jumlah per kategori |

Struktur kolom Sheet Utama:

| Hasil Seeding Mentah | Golden Keyword | Buying Keyword | Longtail Keyword | Competitor |
|---|---|---|---|---|

Setiap grup diawali baris header berwarna:
- 🟩 **Hijau** — Blok Golden Keywords
- 🟨 **Kuning** — Separator per karakter seed

---

## 🛠️ Konfigurasi

### Tambah Buying Keywords
Edit `src/classifier.js`, array `BUYING_KEYWORDS`:
```js
const BUYING_KEYWORDS = [
  'jasa', 'terbaik', 'murah', 'harga', // tambah di sini
];
```

### Tambah Kompetitor
Edit `src/classifier.js`, array `COMPETITORS`:
```js
const COMPETITORS = [
  'sribu', 'dewiweb', 'niagahoster', // tambah di sini
];
```

### Ubah Karakter Seed Default
Edit `src/scraper.js`, `CONFIG.SEED_CHARS`:
```js
SEED_CHARS: 'abcdefghijklmnopqrstuvwxyz0123456789',
```

### Ubah Port Server
```bash
PORT=4000 npm start
```

---

## 📡 API Endpoints

| Method | Endpoint | Deskripsi |
|---|---|---|
| `POST` | `/api/start` | Mulai proses scraping |
| `POST` | `/api/cancel/:sessionId` | Hentikan proses |
| `GET` | `/api/stream/:sessionId` | SSE — real-time log |
| `GET` | `/api/files` | Daftar file output |
| `GET` | `/api/download/:filename` | Download file Excel |
| `DELETE` | `/api/files/:filename` | Hapus file output |

---

## 🔒 Anti-Bot Measures

- User-Agent dirotasi dari 5 profil browser nyata
- `navigator.webdriver` di-override menjadi `undefined`
- Delay acak antar karakter saat mengetik (40–100ms)
- Delay acak antar request (200–500ms)
- Manipulasi cursor via DOM inject (terisolasi dari keyboard fisik)
- Blokir resource tidak perlu (gambar, font, stylesheet) untuk mempercepat

---

## 📦 Tech Stack

| Layer | Library |
|---|---|
| Runtime | Node.js |
| Server | Express.js |
| Browser Automation | Playwright (Chromium) |
| Excel Export | ExcelJS |
| Frontend | HTML + Tailwind CSS (CDN) + Vanilla JS |
| Realtime | Server-Sent Events (SSE) |

---

## 📝 Lisensi

MIT — bebas digunakan dan dimodifikasi.
