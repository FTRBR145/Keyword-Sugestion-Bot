/**
 * classifier.js
 * Logika klasifikasi kata kunci dan ekspor ke Excel (.xlsx)
 */

const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

// ─────────────────────────────────────────────
// KAMUS KLASIFIKASI
// Urutan prioritas: Competitor → Longtail → Buying
// ─────────────────────────────────────────────

// 1. COMPETITOR (Default)
const COMPETITOR_SIGNALS = [
  'review', 'reviews', 'rating', 'ratings', 'testimonial', 'testimoni',
  'ulasan', 'feedback', 'instagram', 'facebook', 'linkedin', 'youtube', 'twitter', 'tiktok',
  'ig ', ' ig', 'fb ', ' fb', 'photo', 'photos', 'foto', 'gambar', 'image', 'images', 'logo',
  'branding', 'brochure', 'brosur', 'map', 'maps', 'direction', 'directions', 'alamat', 'address',
  'google maps', 'google review', 'google reviews', 'tempat', 'lokasi', 'location',
  'glassdoor', 'indeed', 'loker', 'lowongan',
];

// Kamus Parameter Tambahan untuk Long-tail Pendek
const LONGTAIL_SIGNALS = [
  "tahun", "umur", "usia", "berapa", "menurut", "islam", "laki", "perempuan", "bayi"
];

// Kamus Intent Transaksi (Buying Keyword)
const BUYING_SIGNALS = [
  "harga", "biaya", "tarif", "promo", "murah", "tempat", "klinik", "center", 
  "ulasan", "review", "terdekat", "di", "depok", "bekasi", "jakarta", "bogor", 
  "alfatih", "jasa", "sunatan"
];

// ─────────────────────────────────────────────
// DAFTAR KOMPETITOR (isi nama brand/domain kompetitor)
// ─────────────────────────────────────────────
const COMPETITORS = [
  // Tambahkan nama kompetitor di sini, contoh:
  // 'sribu', 'dewiweb', 'niagahoster',
];

// ─────────────────────────────────────────────
// FUNGSI KLASIFIKASI
// ─────────────────────────────────────────────

/**
 * Mengklasifikasikan satu kata kunci.
 */
function classifyKeyword(keyword, goldenKeywords = [], targetKeyword = '') {
  const kw = keyword.toLowerCase().trim();
  const kataArray = keyword.trim().split(/\s+/).filter(String);
  const jumlahKata = kataArray.length;
  
  // Kata kunci asli untuk pengecekan baseline
  const kataKunciAsli = targetKeyword ? targetKeyword.toLowerCase().trim() : "";
  
  let punyaKataKunciAsli = true;
  if (kataKunciAsli !== "" && !kw.includes(kataKunciAsli)) {
    punyaKataKunciAsli = false;
  }
  
  let isBuying = false;
  let isLongtail = false;
  
  // 1. EVALUASI BUYING KEYWORD (Fokus utama niat beli: 3-5 kata & mengandung intent transaksi)
  if (jumlahKata >= 3 && jumlahKata <= 5) {
    for (let j = 0; j < BUYING_SIGNALS.length; j++) {
      if (kw.includes(BUYING_SIGNALS[j].toLowerCase())) {
        isBuying = true;
        break;
      }
    }
  }
  
  // 2. EVALUASI LONG-TAIL KEYWORD
  if (jumlahKata > 5 || (kataKunciAsli !== "" && !punyaKataKunciAsli && jumlahKata >= 3)) {
    // Jika lebih dari 5 kata ATAU (tidak memiliki keyword seed DAN minimal 3 kata), otomatis Long-tail
    isLongtail = true;
  } else if (jumlahKata >= 3 && jumlahKata <= 5) {
    // Jika 3-5 kata dan punya kata kunci asli, cek parameter spesifik tambahan
    const adaAngka = /\d+/.test(kw);
    let adaKataSpesifik = false;
    for (let k = 0; k < LONGTAIL_SIGNALS.length; k++) {
      if (kw.includes(LONGTAIL_SIGNALS[k].toLowerCase())) {
        adaKataSpesifik = true;
        break;
      }
    }
    if (adaAngka || adaKataSpesifik) {
      isLongtail = true;
    }
  }
  
  // 3. EVALUASI GOLDEN KEYWORD (Wajib mengandung kata kunci asli dan bukan long-tail)
  let isGolden = !isLongtail && punyaKataKunciAsli;
  
  // 4. Competitor (dipertahankan agar tidak break UI)
  let isCompetitor = false;
  if (COMPETITORS.length > 0 && COMPETITORS.some(c => kw.includes(c.toLowerCase()))) {
    isCompetitor = true;
  } else if (COMPETITOR_SIGNALS.some(s => kw.includes(s.toLowerCase()))) {
    isCompetitor = true;
  }

  return { isGolden, isBuying, isLongtail, isCompetitor };
}

/**
 * Memproses semua data seeding mentah dan mengklasifikasikan setiap keyword.
 * @param {object} rawData - Data mentah dari scraper
 * @param {string[]} goldenKeywords - Array 10 golden keyword
 * @returns {object[]} Array baris data yang sudah diklasifikasi
 */
/**
 * Menghitung frekuensi kemunculan setiap keyword di hasil seeding A-Z.
 * Keyword yang paling sering muncul di banyak variasi char → paling "golden".
 *
 * @param {object[]} rawData  - Data mentah dari scraper
 * @param {string[]} tahap1Golden - 10 golden keyword dari Tahap 1 (sebagai seed awal)
 * @param {number} topN - Jumlah golden keyword yang diambil (default 10)
 * @returns {string[]} Array golden keyword terurut dari paling sering muncul
 */
function deriveGoldenFromSeeding(rawData, tahap1Golden, topN = 10) {
  const freq = new Map(); // keyword.lowercase → { keyword, count, chars: Set }

  for (const item of rawData) {
    const allItems = [...(item.prefix || []), ...(item.middle || []), ...(item.suffix || [])];
    for (const { char, keywords } of allItems) {
      for (const kw of keywords) {
        const key = kw.toLowerCase().trim();
        if (!freq.has(key)) {
          freq.set(key, { keyword: kw, count: 0, chars: new Set() });
        }
        const entry = freq.get(key);
        entry.count++;
        entry.chars.add(char);
      }
    }
  }

  // Urutkan: keyword yang muncul di paling banyak karakter berbeda (spread),
  // lalu total kemunculan sebagai tiebreaker
  const sorted = [...freq.values()]
    .sort((a, b) => {
      const spreadDiff = b.chars.size - a.chars.size;
      if (spreadDiff !== 0) return spreadDiff;
      return b.count - a.count;
    });

  // Ambil top N, tapi selalu masukkan tahap1Golden (Tahap 1) jika belum ada
  const result = [];
  const resultKeys = new Set();

  // Prioritas 1: dari hasil seeding yang paling sering muncul
  for (const entry of sorted) {
    if (result.length >= topN) break;
    const key = entry.keyword.toLowerCase().trim();
    if (!resultKeys.has(key)) {
      result.push(entry.keyword);
      resultKeys.add(key);
    }
  }

  // Prioritas 2: tambahkan dari Tahap 1 jika belum ada dan masih kurang dari topN
  for (const kw of tahap1Golden) {
    if (result.length >= topN) break;
    const key = kw.toLowerCase().trim();
    if (!resultKeys.has(key)) {
      result.push(kw);
      resultKeys.add(key);
    }
  }

  return result;
}

function processAndClassify(rawData, goldenKeywords, targetKeyword = '', sortConfig = {}) {
  const rows = [];
  const conf = { golden: true, buying: true, longtail: true, competitor: true, ...sortConfig };

  for (const goldenItem of rawData) {
    const { goldenKeyword, prefix, middle, suffix } = goldenItem;
    // Gunakan goldenKeyword (= targetKeyword) sebagai baseline longtail
    const base = targetKeyword || goldenKeyword;

    // === BLOK GOLDEN KEYWORDS ===
    rows.push({ type: 'golden_header', label: `Golden Keywords : ${goldenKeyword}` });
    goldenKeywords.forEach((kw) => {
      const c = classifyKeyword(kw, goldenKeywords, base);
      rows.push({
        type: 'data', rawSeed: kw, golden: kw,
        buying: (conf.buying && c.isBuying) ? kw : '',
        longtail: (conf.longtail && c.isLongtail) ? kw : '',
        competitor: (conf.competitor && c.isCompetitor) ? kw : '',
      });
    });

    const addSection = (arr, prefixText) => {
      if (!arr || !Array.isArray(arr)) return;
      for (const { char, keywords } of arr) {
        rows.push({ type: 'header', label: `Kata Kunci : ${goldenKeyword} (${prefixText} ${char.toUpperCase()})` });
        for (const kw of keywords) {
          const c = classifyKeyword(kw, goldenKeywords, base);
          rows.push({
            type: 'data', rawSeed: kw,
            golden: (conf.golden && c.isGolden) ? kw : '',
            buying: (conf.buying && c.isBuying) ? kw : '',
            longtail: (conf.longtail && c.isLongtail) ? kw : '',
            competitor: (conf.competitor && c.isCompetitor) ? kw : '',
          });
        }
      }
    };

    addSection(prefix, "Huruf Depan");
    addSection(middle, "Huruf Tengah");
    addSection(suffix, "Huruf Belakang");
  }

  return rows;
}

// ─────────────────────────────────────────────
// FUNGSI EKSPOR EXCEL
// ─────────────────────────────────────────────

/**
 * Mengekspor hasil scraping ke file .xlsx
 * @param {object[]} rows
 * @param {string[]} goldenKeywords
 * @param {string} outputDir
 * @param {string} targetKeyword
 * @param {object} colorConfig - { goldenHeader, separator, columnHeader }
 */
async function exportToExcel(rows, goldenKeywords, outputDir = './output', targetKeyword = '', colorConfig = {}) {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const safeKeyword = (targetKeyword || 'keyword')
    .trim().toLowerCase()
    .replace(/[<>:"/\\|?*]+/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').substring(0, 40);

  const now  = new Date();
  const dd   = String(now.getDate()).padStart(2, '0');
  const mm   = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  const hh   = String(now.getHours()).padStart(2, '0');
  const min  = String(now.getMinutes()).padStart(2, '0');

  const filename = `${safeKeyword}_${dd}-${mm}-${yyyy}_${hh}-${min}.xlsx`;
  const filepath = path.join(outputDir, filename);

  // ── Warna (bisa dikustom, default ke warna asli) ──
  // Hex tanpa '#', dengan prefix FF untuk alpha
  const toArgb = (hex) => 'FF' + hex.replace('#', '').toUpperCase();

  const COLORS = {
    columnHeader:   toArgb(colorConfig.columnHeader   || '#1E40AF'),
    goldenHeader:   toArgb(colorConfig.goldenHeader    || '#15803D'),
    separator:      toArgb(colorConfig.separator       || '#FBBF24'),
    goldenCell:     toArgb(colorConfig.goldenCell      || '#86EFAC'),
    buyingCell:     toArgb(colorConfig.buyingCell       || '#FCA5A5'),
    longtailCell:   toArgb(colorConfig.longtailCell    || '#C4B5FD'),
    competitorCell: toArgb(colorConfig.competitorCell  || '#FDE68A'),
  };

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Keyword Scraping Tool';
  workbook.created = new Date();

  // ─── SHEET 1: Semua Hasil Seeding ───
  const mainSheet = workbook.addWorksheet('Hasil Seeding', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  mainSheet.columns = [
    { header: 'Hasil Seeding Mentah', key: 'rawSeed',    width: 45 },
    { header: 'Golden Keyword',       key: 'golden',     width: 35 },
    { header: 'Buying Keyword',       key: 'buying',     width: 35 },
    { header: 'Longtail Keyword',     key: 'longtail',   width: 40 },
    { header: 'Competitor',           key: 'competitor', width: 35 },
  ];

  // Style header kolom (baris 1)
  mainSheet.getRow(1).eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.columnHeader } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { bottom: { style: 'medium', color: { argb: 'FF000000' } } };
  });
  mainSheet.getRow(1).height = 22;

  let rowIndex = 2;
  for (const row of rows) {
    if (row.type === 'golden_header') {
      const gRow = mainSheet.addRow([row.label, '', '', '', '']);
      gRow.eachCell({ includeEmpty: true }, cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.goldenHeader } };
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        cell.border = {
          top:    { style: 'medium', color: { argb: 'FF000000' } },
          bottom: { style: 'medium', color: { argb: 'FF000000' } },
        };
      });
      mainSheet.getCell(`A${rowIndex}`).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      gRow.height = 22;
      rowIndex++;

    } else if (row.type === 'header') {
      const headerRow = mainSheet.addRow([row.label, '', '', '', '']);
      headerRow.eachCell({ includeEmpty: true }, cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.separator } };
        cell.font = { bold: true, italic: true, size: 10 };
        cell.border = {
          top:    { style: 'thin', color: { argb: 'FFC0C0C0' } },
          bottom: { style: 'thin', color: { argb: 'FFC0C0C0' } },
        };
      });
      mainSheet.getCell(`A${rowIndex}`).alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      headerRow.height = 18;
      rowIndex++;

    } else {
      // Baris data — PUTIH POLOS, tanpa zebra stripe
      const dataRow = mainSheet.addRow([
        row.rawSeed, row.golden, row.buying, row.longtail, row.competitor,
      ]);

      dataRow.eachCell({ includeEmpty: true }, cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
        cell.alignment = { vertical: 'middle', wrapText: false };
        cell.font = { size: 10 };
      });

      // Hanya warnai sel klasifikasi yang terisi (B-E)
      if (row.golden)     mainSheet.getCell(`B${rowIndex}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.goldenCell } };
      if (row.buying)     mainSheet.getCell(`C${rowIndex}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.buyingCell } };
      if (row.longtail)   mainSheet.getCell(`D${rowIndex}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.longtailCell } };
      if (row.competitor) mainSheet.getCell(`E${rowIndex}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.competitorCell } };

      dataRow.height = 16;
      rowIndex++;
    }
  }

  // ─── SHEET 2: Golden Keywords ───
  const goldenSheet = workbook.addWorksheet('Golden Keywords');
  goldenSheet.columns = [
    { header: 'No',             key: 'no',      width: 8  },
    { header: 'Golden Keyword', key: 'keyword', width: 50 },
  ];
  goldenSheet.getRow(1).eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.goldenHeader } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  goldenKeywords.forEach((kw, idx) => {
    const r = goldenSheet.addRow({ no: idx + 1, keyword: kw });
    r.getCell('no').alignment = { horizontal: 'center' };
    // Baris data putih polos
    r.eachCell({ includeEmpty: true }, cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
    });
  });

  // ─── SHEET 3: Ringkasan ───
  const summarySheet = workbook.addWorksheet('Ringkasan');
  const totalData     = rows.filter(r => r.type === 'data');
  summarySheet.columns = [
    { header: 'Kategori', key: 'cat',   width: 30 },
    { header: 'Jumlah',   key: 'count', width: 15 },
  ];
  summarySheet.getRow(1).eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.columnHeader } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  [
    { cat: 'Total Kata Kunci Mentah',   count: totalData.length },
    { cat: 'Golden Keyword',            count: goldenKeywords.length },
    { cat: 'Buying Keyword',            count: totalData.filter(r => r.buying).length },
    { cat: 'Longtail Keyword (≥4 kata)',count: totalData.filter(r => r.longtail).length },
    { cat: 'Competitor Keyword',        count: totalData.filter(r => r.competitor).length },
  ].forEach(item => {
    const r = summarySheet.addRow(item);
    r.getCell('count').alignment = { horizontal: 'center' };
    r.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
    });
  });

  await workbook.xlsx.writeFile(filepath);
  return filepath;
}

// ─────────────────────────────────────────────
// FUNGSI: Baca & Klasifikasi Excel Upload
// ─────────────────────────────────────────────

/**
 * Membaca file Excel yang diupload, membaca semua keyword dari kolom pertama
 * yang terisi teks (bukan header / baris kosong / baris separator),
 * lalu mengklasifikasikan dan mengekspor ke file baru.
 *
 * Format input yang didukung:
 *  - Satu kolom keyword per baris (kolom A)
 *  - Multi-kolom: baca semua kolom yang terisi di setiap baris
 *  - Baris header / separator (warna background / teks pendek) diabaikan
 *
 * @param {string} inputPath  - Path file .xlsx yang diupload
 * @param {string} outputDir  - Direktori output
 * @returns {{ filepath, stats }}
 */
async function classifyUploadedExcel(inputPath, outputDir = './output') {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(inputPath);

  const keywords = [];
  const seen = new Set();
  let extractedTargetKeyword = "";

  wb.eachSheet((sheet) => {
    sheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const val = cell.text?.trim() || String(cell.value ?? '').trim();

        if (extractedTargetKeyword === "" && val.toLowerCase().includes("kata kunci") && !val.toLowerCase().includes("(huruf")) {
           const parts = val.split(":");
           if (parts.length > 1) {
             extractedTargetKeyword = parts[1].trim().toLowerCase();
           }
        }

        // Abaikan: kosong, terlalu pendek, mengandung CSS, atau baris separator
        if (
          !val ||
          val.length < 2 ||
          val.includes('{') ||
          val.toLowerCase().startsWith('golden keyword') ||
          val.toLowerCase().startsWith('kata kunci') ||
          val.toLowerCase().startsWith('hasil seeding') ||
          val.toLowerCase().startsWith('buying') ||
          val.toLowerCase().startsWith('longtail') ||
          val.toLowerCase().startsWith('competitor') ||
          val.toLowerCase() === 'no' ||
          seen.has(val.toLowerCase())
        ) return;

        seen.add(val.toLowerCase());
        keywords.push(val);
      });
    });
  });

  if (keywords.length === 0) {
    throw new Error('Tidak ada keyword yang ditemukan di file Excel.');
  }

  // Klasifikasi setiap keyword
  const rows = keywords.map(kw => {
    const c = classifyKeyword(kw, [], extractedTargetKeyword);
    return {
      type: 'data',
      rawSeed: kw,
      golden:     c.isGolden    ? kw : '',
      buying:     c.isBuying    ? kw : '',
      longtail:   c.isLongtail  ? kw : '',
      competitor: c.isCompetitor ? kw : '',
    };
  });

  // Buat Excel output
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const now = new Date();
  const dd   = String(now.getDate()).padStart(2, '0');
  const mm   = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  const hh   = String(now.getHours()).padStart(2, '0');
  const min  = String(now.getMinutes()).padStart(2, '0');
  const baseName = path.basename(inputPath, path.extname(inputPath))
    .replace(/[<>:"/\\|?*]+/g, '').replace(/\s+/g, '-').substring(0, 30);
  const filename = `classified-${baseName}_${dd}-${mm}-${yyyy}_${hh}-${min}.xlsx`;
  const filepath = path.join(outputDir, filename);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Keyword Scraping Tool';

  // ── Sheet Hasil Klasifikasi ──
  const sheet = workbook.addWorksheet('Hasil Klasifikasi', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  sheet.columns = [
    { header: 'Keyword',          key: 'rawSeed',    width: 50 },
    { header: 'Buying Keyword',   key: 'buying',     width: 40 },
    { header: 'Longtail Keyword', key: 'longtail',   width: 45 },
    { header: 'Competitor',       key: 'competitor', width: 35 },
  ];

  // Style header kolom
  sheet.getRow(1).eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = { bottom: { style: 'medium', color: { argb: 'FF000000' } } };
  });
  sheet.getRow(1).height = 22;

  const COLORS = {
    buyingCell:     'FFFCA5A5',
    longtailCell:   'FFC4B5FD',
    competitorCell: 'FFFDE68A',
  };

  rows.forEach((row, idx) => {
    const r = sheet.addRow({
      rawSeed:    row.rawSeed,
      buying:     row.buying,
      longtail:   row.longtail,
      competitor: row.competitor,
    });

    const bg = idx % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF';
    r.eachCell({ includeEmpty: true }, cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      cell.font = { size: 10 };
      cell.alignment = { vertical: 'middle' };
    });

    if (row.buying)     r.getCell('buying').fill     = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.buyingCell } };
    if (row.longtail)   r.getCell('longtail').fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.longtailCell } };
    if (row.competitor) r.getCell('competitor').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.competitorCell } };

    r.height = 16;
  });

  // ── Sheet Ringkasan ──
  const sumSheet = workbook.addWorksheet('Ringkasan');
  sumSheet.columns = [
    { header: 'Kategori', key: 'cat',   width: 30 },
    { header: 'Jumlah',   key: 'count', width: 15 },
  ];
  sumSheet.getRow(1).eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  const buying     = rows.filter(r => r.buying).length;
  const longtail   = rows.filter(r => r.longtail).length;
  const competitor = rows.filter(r => r.competitor).length;

  [
    { cat: 'Total Keyword',             count: rows.length },
    { cat: 'Buying Keyword',            count: buying },
    { cat: 'Longtail Keyword (≥4 kata)',count: longtail },
    { cat: 'Competitor',                count: competitor },
  ].forEach((item, i) => {
    const r = sumSheet.addRow(item);
    r.getCell('count').alignment = { horizontal: 'center' };
    r.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i % 2 === 0 ? 'FFF0F9FF' : 'FFFFFFFF' } };
    });
  });

  await workbook.xlsx.writeFile(filepath);

  return {
    filepath,
    filename,
    stats: { total: rows.length, buying, longtail, competitor },
  };
}

module.exports = {
  classifyKeyword,
  deriveGoldenFromSeeding,
  processAndClassify,
  exportToExcel,
  classifyUploadedExcel,
  BUYING_SIGNALS,
  LONGTAIL_SIGNALS,
  COMPETITOR_SIGNALS,
  COMPETITORS,
};
