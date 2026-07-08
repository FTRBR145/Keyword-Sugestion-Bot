/**
 * classifier.js
 * Logika klasifikasi kata kunci dan ekspor ke Excel (.xlsx)
 */

const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

// ─────────────────────────────────────────────
// DAFTAR KATA TRANSAKSIONAL (Buying Keywords)
// ─────────────────────────────────────────────
const BUYING_KEYWORDS = [
  'jasa', 'terbaik', 'murah', 'agency', 'harga', 'beli', 'order',
  'pesan', 'booking', 'sewa', 'hire', 'layanan', 'service', 'profesional',
  'terpercaya', 'terjangkau', 'promo', 'diskon', 'paket', 'biaya',
  'tarif', 'ongkos', 'gratis', 'free', 'trial', 'demo', 'konsultasi',
  'rekomendasi', 'review', 'terbaik', 'top', 'bagus', 'berkualitas',
];

// ─────────────────────────────────────────────
// DAFTAR KOMPETITOR (isi sesuai kebutuhan)
// ─────────────────────────────────────────────
const COMPETITORS = [
  // Contoh: 'sribu', 'dewiweb', 'niagahoster', 'idwebhost'
  // Tambahkan nama kompetitor Anda di sini
];

// ─────────────────────────────────────────────
// FUNGSI KLASIFIKASI
// ─────────────────────────────────────────────

/**
 * Mengklasifikasikan satu kata kunci ke dalam kategori yang relevan.
 * @param {string} keyword - Kata kunci yang akan diklasifikasikan
 * @param {string[]} goldenKeywords - Array 10 golden keyword dari Tahap 1
 * @returns {{ isGolden: boolean, isBuying: boolean, isLongtail: boolean, isCompetitor: boolean }}
 */
function classifyKeyword(keyword, goldenKeywords = []) {
  const kw = keyword.toLowerCase().trim();
  const words = kw.split(/\s+/).filter(Boolean);

  const isGolden = goldenKeywords.map(g => g.toLowerCase().trim()).includes(kw);

  const isBuying = BUYING_KEYWORDS.some(bk =>
    kw.includes(bk.toLowerCase())
  );

  const isLongtail = words.length >= 4;

  const isCompetitor = COMPETITORS.length > 0 && COMPETITORS.some(comp =>
    kw.includes(comp.toLowerCase())
  );

  return { isGolden, isBuying, isLongtail, isCompetitor };
}

/**
 * Memproses semua data seeding mentah dan mengklasifikasikan setiap keyword.
 * @param {object} rawData - Data mentah dari scraper
 * @param {string[]} goldenKeywords - Array 10 golden keyword
 * @returns {object[]} Array baris data yang sudah diklasifikasi
 */
function processAndClassify(rawData, goldenKeywords) {
  const rows = [];

  for (const goldenItem of rawData) {
    const { goldenKeyword, prefix, suffix } = goldenItem;

    // === BLOK GOLDEN KEYWORDS (di atas seeding) ===
    // Header blok golden
    rows.push({
      type: 'golden_header',
      label: `Golden Keywords : ${goldenKeyword}`,
    });
    // 10 golden keyword sebagai baris data golden
    goldenKeywords.forEach((kw, idx) => {
      const classification = classifyKeyword(kw, goldenKeywords);
      rows.push({
        type: 'data',
        rawSeed: kw,
        golden: kw,  // semua golden keyword masuk kolom golden
        buying: classification.isBuying ? kw : '',
        longtail: classification.isLongtail ? kw : '',
        competitor: classification.isCompetitor ? kw : '',
      });
    });

    // === PREFIX (Depan) ===
    for (const prefixItem of prefix) {
      const { char, keywords } = prefixItem;

      rows.push({
        type: 'header',
        label: `Kata Kunci : ${goldenKeyword} (Huruf ${char.toUpperCase()} Depan)`,
      });

      for (const kw of keywords) {
        const classification = classifyKeyword(kw, goldenKeywords);
        rows.push({
          type: 'data',
          rawSeed: kw,
          golden: classification.isGolden ? kw : '',
          buying: classification.isBuying ? kw : '',
          longtail: classification.isLongtail ? kw : '',
          competitor: classification.isCompetitor ? kw : '',
        });
      }
    }

    // === SUFFIX (Belakang) ===
    for (const suffixItem of suffix) {
      const { char, keywords } = suffixItem;

      rows.push({
        type: 'header',
        label: `Kata Kunci : ${goldenKeyword} (Huruf ${char.toUpperCase()} Belakang)`,
      });

      for (const kw of keywords) {
        const classification = classifyKeyword(kw, goldenKeywords);
        rows.push({
          type: 'data',
          rawSeed: kw,
          golden: classification.isGolden ? kw : '',
          buying: classification.isBuying ? kw : '',
          longtail: classification.isLongtail ? kw : '',
          competitor: classification.isCompetitor ? kw : '',
        });
      }
    }
  }

  return rows;
}

// ─────────────────────────────────────────────
// FUNGSI EKSPOR EXCEL
// ─────────────────────────────────────────────

/**
 * Mengekspor hasil scraping ke file .xlsx
 * @param {object[]} rows - Baris data yang sudah diproses
 * @param {string[]} goldenKeywords - Array golden keywords untuk sheet terpisah
 * @param {string} outputDir - Direktori output
 * @returns {string} Path file .xlsx yang dibuat
 */
async function exportToExcel(rows, goldenKeywords, outputDir = './output', targetKeyword = '') {
  // Pastikan folder output ada
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Format nama file: [keyword]_DD-MM-YYYY_HH-mm.xlsx
  // Bersihkan keyword: hapus karakter tidak valid untuk nama file
  const safeKeyword = (targetKeyword || 'keyword')
    .trim()
    .toLowerCase()
    .replace(/[<>:"/\\|?*]+/g, '')   // hapus karakter ilegal Windows
    .replace(/\s+/g, '-')             // spasi → dash
    .replace(/-+/g, '-')              // double dash → single
    .substring(0, 40);                // maks 40 karakter

  const now = new Date();
  const dd   = String(now.getDate()).padStart(2, '0');
  const mm   = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  const hh   = String(now.getHours()).padStart(2, '0');
  const min  = String(now.getMinutes()).padStart(2, '0');

  const filename = `${safeKeyword}_${dd}-${mm}-${yyyy}_${hh}-${min}.xlsx`;
  const filepath = path.join(outputDir, filename);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Keyword Scraping Tool';
  workbook.created = new Date();

  // ─── SHEET 1: Semua Hasil Seeding ───
  const mainSheet = workbook.addWorksheet('Hasil Seeding', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  // Style warna
  const COLORS = {
    headerRow: 'FF1E40AF',     // Biru gelap untuk header kolom
    separatorRow: 'FFFBBF24',  // Kuning untuk baris pembatas
    goldenCell: 'FF86EFAC',    // Hijau muda
    buyingCell: 'FFFCA5A5',    // Merah muda
    longtailCell: 'FFC4B5FD',  // Ungu muda
    competitorCell: 'FFFDE68A',// Kuning muda
    oddRow: 'FFF8FAFC',
    evenRow: 'FFFFFFFF',
  };

  // Definisi kolom
  mainSheet.columns = [
    { header: 'Hasil Seeding Mentah', key: 'rawSeed', width: 45 },
    { header: 'Golden Keyword', key: 'golden', width: 35 },
    { header: 'Buying Keyword', key: 'buying', width: 35 },
    { header: 'Longtail Keyword', key: 'longtail', width: 40 },
    { header: 'Competitor', key: 'competitor', width: 35 },
  ];

  // Style header kolom
  const headerRow = mainSheet.getRow(1);
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern', pattern: 'solid',
      fgColor: { argb: COLORS.headerRow },
    };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      bottom: { style: 'medium', color: { argb: 'FF000000' } },
    };
  });
  headerRow.height = 22;

  // Isi data
  let rowIndex = 2;
  for (const row of rows) {
    if (row.type === 'golden_header') {
      // Baris header blok golden — kolom A saja, tidak merge
      mainSheet.addRow([row.label, '', '', '', '']);
      const cell = mainSheet.getCell(`A${rowIndex}`);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF15803D' } };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      cell.border = {
        top: { style: 'medium', color: { argb: 'FF000000' } },
        bottom: { style: 'medium', color: { argb: 'FF000000' } },
      };
      mainSheet.getRow(rowIndex).height = 22;
      rowIndex++;
    } else if (row.type === 'header') {
      // Baris pembatas / separator — kolom A saja, tidak merge
      mainSheet.addRow([row.label, '', '', '', '']);
      const cell = mainSheet.getCell(`A${rowIndex}`);
      cell.fill = {
        type: 'pattern', pattern: 'solid',
        fgColor: { argb: COLORS.separatorRow },
      };
      cell.font = { bold: true, italic: true, size: 10 };
      cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFC0C0C0' } },
        bottom: { style: 'thin', color: { argb: 'FFC0C0C0' } },
      };
      mainSheet.getRow(rowIndex).height = 18;
      rowIndex++;
    } else {
      // Baris data
      const dataRow = mainSheet.addRow([
        row.rawSeed,
        row.golden,
        row.buying,
        row.longtail,
        row.competitor,
      ]);

      const bgColor = rowIndex % 2 === 0 ? COLORS.evenRow : COLORS.oddRow;

      dataRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cell.fill = {
          type: 'pattern', pattern: 'solid',
          fgColor: { argb: bgColor },
        };
        cell.alignment = { vertical: 'middle', wrapText: false };
        cell.font = { size: 10 };
      });

      // Warnai kolom klasifikasi jika terisi
      if (row.golden) {
        mainSheet.getCell(`B${rowIndex}`).fill = {
          type: 'pattern', pattern: 'solid',
          fgColor: { argb: COLORS.goldenCell },
        };
      }
      if (row.buying) {
        mainSheet.getCell(`C${rowIndex}`).fill = {
          type: 'pattern', pattern: 'solid',
          fgColor: { argb: COLORS.buyingCell },
        };
      }
      if (row.longtail) {
        mainSheet.getCell(`D${rowIndex}`).fill = {
          type: 'pattern', pattern: 'solid',
          fgColor: { argb: COLORS.longtailCell },
        };
      }
      if (row.competitor) {
        mainSheet.getCell(`E${rowIndex}`).fill = {
          type: 'pattern', pattern: 'solid',
          fgColor: { argb: COLORS.competitorCell },
        };
      }

      dataRow.height = 16;
      rowIndex++;
    }
  }

  // ─── SHEET 2: Golden Keywords ───
  const goldenSheet = workbook.addWorksheet('Golden Keywords');
  goldenSheet.columns = [
    { header: 'No', key: 'no', width: 8 },
    { header: 'Golden Keyword', key: 'keyword', width: 50 },
  ];

  const gHeader = goldenSheet.getRow(1);
  gHeader.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF16A34A' } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  goldenKeywords.forEach((kw, idx) => {
    const r = goldenSheet.addRow({ no: idx + 1, keyword: kw });
    r.getCell('no').alignment = { horizontal: 'center' };
    r.getCell('keyword').fill = {
      type: 'pattern', pattern: 'solid',
      fgColor: { argb: idx % 2 === 0 ? 'FFBBF7D0' : 'FFF0FDF4' },
    };
  });

  // ─── SHEET 3: Ringkasan ───
  const summarySheet = workbook.addWorksheet('Ringkasan');
  const totalData = rows.filter(r => r.type === 'data');
  const buyingCount = totalData.filter(r => r.buying).length;
  const longtailCount = totalData.filter(r => r.longtail).length;
  const competitorCount = totalData.filter(r => r.competitor).length;

  summarySheet.columns = [
    { header: 'Kategori', key: 'cat', width: 30 },
    { header: 'Jumlah', key: 'count', width: 15 },
  ];

  const sHeader = summarySheet.getRow(1);
  sHeader.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  const summaryData = [
    { cat: 'Total Kata Kunci Mentah', count: totalData.length },
    { cat: 'Golden Keyword', count: goldenKeywords.length },
    { cat: 'Buying Keyword', count: buyingCount },
    { cat: 'Longtail Keyword (≥4 kata)', count: longtailCount },
    { cat: 'Competitor Keyword', count: competitorCount },
  ];

  summaryData.forEach((item, idx) => {
    const r = summarySheet.addRow(item);
    r.getCell('count').alignment = { horizontal: 'center' };
    r.eachCell((cell) => {
      cell.fill = {
        type: 'pattern', pattern: 'solid',
        fgColor: { argb: idx % 2 === 0 ? 'FFF0F9FF' : 'FFFFFFFF' },
      };
    });
  });

  await workbook.xlsx.writeFile(filepath);
  return filepath;
}

module.exports = {
  classifyKeyword,
  processAndClassify,
  exportToExcel,
  BUYING_KEYWORDS,
  COMPETITORS,
};
