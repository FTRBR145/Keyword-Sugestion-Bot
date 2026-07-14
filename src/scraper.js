/**
 * scraper.js
 * Logika utama Playwright untuk scraping Google Autocomplete Suggestions
 */

const { chromium } = require('playwright');

// ─────────────────────────────────────────────
// KONFIGURASI
// ─────────────────────────────────────────────

const CONFIG = {
  // Karakter untuk seeding (prefix/suffix)
  SEED_CHARS: 'abcdefghijklmnopqrstuvwxyz0123456789',
  // Tambahkan simbol jika diperlukan:
  // SEED_CHARS: 'abcdefghijklmnopqrstuvwxyz0123456789!@#$%',

  // Jeda antar karakter saat mengetik (ms)
  TYPE_DELAY_MIN: 40,
  TYPE_DELAY_MAX: 100,

  // Jeda sebelum membaca dropdown (ms)
  DROPDOWN_WAIT_MIN: 400,
  DROPDOWN_WAIT_MAX: 700,

  // Jeda antar request pencarian (ms)
  REQUEST_DELAY_MIN: 200,
  REQUEST_DELAY_MAX: 500,

  // Timeout tunggu elemen (ms)
  ELEMENT_TIMEOUT: 8000,

  // Maksimal sugesti per pencarian
  MAX_SUGGESTIONS: 10,

  // URL Google
  GOOGLE_URL: 'https://www.google.com/?hl=id',

  // User Agents realistis (dirotasi secara acak)
  USER_AGENTS: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  ],
};

// ─────────────────────────────────────────────
// HELPER: Jeda acak
// ─────────────────────────────────────────────
function randomDelay(min, max) {
  return new Promise(resolve =>
    setTimeout(resolve, Math.floor(Math.random() * (max - min + 1)) + min)
  );
}

// ─────────────────────────────────────────────
// HELPER: Mengetik teks dengan delay manusiawi
// ─────────────────────────────────────────────
async function typeHumanLike(page, selector, text) {
  const input = page.locator(selector).first();
  await input.click();

  for (const char of text) {
    await input.pressSequentially(char, {
      delay: Math.floor(
        Math.random() * (CONFIG.TYPE_DELAY_MAX - CONFIG.TYPE_DELAY_MIN + 1)
      ) + CONFIG.TYPE_DELAY_MIN,
    });
  }
}

// ─────────────────────────────────────────────
// HELPER: Mengambil sugesti dari dropdown Google
// ─────────────────────────────────────────────
async function getSuggestions(page) {
  try {
    // Tunggu dropdown muncul
    await page.waitForSelector('ul[role="listbox"] li', {
      timeout: CONFIG.ELEMENT_TIMEOUT,
      state: 'visible',
    });

    await randomDelay(CONFIG.DROPDOWN_WAIT_MIN, CONFIG.DROPDOWN_WAIT_MAX);

    // Ambil teks sugesti dengan logika ketat (hanya teks murni, tanpa CSS/HTML)
    const suggestions = await page.evaluate((maxItems) => {
      const results = [];

      // Strategi 1: role="option" — paling akurat di Google terbaru
      const options = document.querySelectorAll('[role="option"], [role="listitem"]');
      if (options.length > 0) {
        for (const opt of options) {
          if (results.length >= maxItems) break;

          // Hapus semua tag <style> dan <script> sebelum baca teks
          const clone = opt.cloneNode(true);
          clone.querySelectorAll('style, script').forEach(el => el.remove());

          // Ambil hanya teks dari span yang mengandung kata kunci (bukan icon/button)
          // Prioritaskan elemen dengan data-attrid atau class teks spesifik
          let text = '';

          // Coba ambil dari span teks utama (bukan tombol "Hapus")
          const spans = clone.querySelectorAll('span');
          for (const span of spans) {
            const t = span.textContent.trim();
            // Teks valid: tidak mengandung CSS ({), tidak kosong, dan bukan teks UI
            if (
              t &&
              t.length > 0 &&
              t.length < 200 &&
              !t.includes('{') &&
              !t.includes('color:') &&
              !['Hapus', 'Remove', 'Lihat lainnya', 'See more'].includes(t)
            ) {
              text = t;
              break;
            }
          }

          // Fallback: innerText langsung dari option (lebih bersih dari textContent)
          if (!text) {
            text = opt.innerText?.split('\n')[0]?.trim() || '';
          }

          if (
            text &&
            text.length > 0 &&
            text.length < 200 &&
            !text.includes('{') &&
            !text.includes('color:') &&
            !['Hapus', 'Remove'].includes(text)
          ) {
            results.push(text.replace(/\s+/g, ' '));
          }
        }
      }

      // Strategi 2: selector class umum Google Suggest
      if (results.length === 0) {
        const classSelectors = [
          '.wM6W7d', '.sbl1', '.hGavRe span', '.cbll3d', '.srl9nd',
        ];
        for (const sel of classSelectors) {
          const items = document.querySelectorAll(sel);
          if (items.length > 0) {
            for (let i = 0; i < Math.min(items.length, maxItems); i++) {
              const t = items[i].textContent?.trim().replace(/\s+/g, ' ');
              if (t && t.length > 0 && t.length < 200 && !t.includes('{')) {
                results.push(t);
              }
            }
            if (results.length > 0) break;
          }
        }
      }

      // Strategi 3: li[data-ved] — menggunakan innerText baris pertama
      if (results.length === 0) {
        const liItems = document.querySelectorAll('ul[role="listbox"] li[data-ved]');
        for (const li of liItems) {
          if (results.length >= maxItems) break;
          const clone = li.cloneNode(true);
          clone.querySelectorAll('style, script').forEach(el => el.remove());
          const t = (clone.innerText || clone.textContent || '')
            .split('\n')[0].trim().replace(/\s+/g, ' ');
          if (t && t.length > 0 && t.length < 200 && !t.includes('{')) {
            results.push(t);
          }
        }
      }

      return results;
    }, CONFIG.MAX_SUGGESTIONS);

    // Filter final: buang duplikat, CSS, dan sugesti < 2 kata (word completion)
    const seen = new Set();
    return suggestions.filter(s => {
      const clean = s.trim();
      if (!clean || clean.length < 3 || clean.includes('{') || seen.has(clean.toLowerCase())) return false;
      if (clean.split(/\s+/).length < 2) return false;
      seen.add(clean.toLowerCase());
      return true;
    });

  } catch {
    // Dropdown tidak muncul atau timeout
    return [];
  }
}

// ─────────────────────────────────────────────
// HELPER: Bersihkan input field
// ─────────────────────────────────────────────
async function clearInput(page) {
  const input = page.locator('textarea[name="q"], input[name="q"]').first();

  // Ctrl+A lalu Delete untuk menghapus semua teks
  await input.click();
  await page.keyboard.press('Control+a');
  await randomDelay(50, 150);
  await page.keyboard.press('Delete');
  await randomDelay(100, 300);

  // Verifikasi kosong
  const value = await input.inputValue();
  if (value) {
    await input.fill('');
    await randomDelay(50, 150);
  }
}

// ─────────────────────────────────────────────
// FUNGSI UTAMA: Membuat browser dan halaman
// ─────────────────────────────────────────────
async function createBrowser(headless = true) {
  const userAgent = CONFIG.USER_AGENTS[Math.floor(Math.random() * CONFIG.USER_AGENTS.length)];

  const browser = await chromium.launch({
    headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  const context = await browser.newContext({
    userAgent,
    viewport: { width: 1366, height: 768 },
    locale: 'id-ID',
    timezoneId: 'Asia/Jakarta',
    // Sembunyikan properti webdriver
    javaScriptEnabled: true,
  });

  // Injeksi script untuk menyembunyikan tanda-tanda otomasi
  await context.addInitScript(() => {
    // Override navigator.webdriver
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });

    // Override chrome property
    window.chrome = {
      runtime: {},
      loadTimes: function () {},
      csi: function () {},
      app: {},
    };

    // Override permissions
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : originalQuery(parameters);

    // Override plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    });

    // Override languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['id-ID', 'id', 'en-US', 'en'],
    });
  });

  const page = await context.newPage();

  // Blokir resource tidak perlu (gambar, font, media) untuk mempercepat
  await page.route('**/*', (route) => {
    const resourceType = route.request().resourceType();
    if (['image', 'media', 'font', 'stylesheet'].includes(resourceType)) {
      route.abort();
    } else {
      route.continue();
    }
  });

  return { browser, context, page };
}

// ─────────────────────────────────────────────
// TAHAP 1: Golden Keywords
// ─────────────────────────────────────────────
async function scrapeGoldenKeywords(page, targetKeyword, onLog) {
  onLog(`🔍 [Tahap 1] Mencari golden keyword untuk: "${targetKeyword}"`);

  // Navigasi ke Google
  await page.goto(CONFIG.GOOGLE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await randomDelay(500, 1000);

  // Tutup dialog cookie jika muncul
  try {
    const acceptBtn = page.locator('button:has-text("Terima semua"), button:has-text("Accept all"), #L2AGLb').first();
    if (await acceptBtn.isVisible({ timeout: 3000 })) {
      await acceptBtn.click();
      await randomDelay(300, 600);
    }
  } catch { /* tidak ada dialog */ }

  // Ketik kata kunci secara manusiawi
  const inputSelector = 'textarea[name="q"], input[name="q"]';
  await typeHumanLike(page, inputSelector, targetKeyword);

  // Tunggu dan ambil sugesti
  const suggestions = await getSuggestions(page);

  if (suggestions.length === 0) {
    onLog(`⚠️  Tidak ada sugesti ditemukan untuk "${targetKeyword}". Coba periksa koneksi atau format keyword.`);
    return [];
  }

  const goldenKeywords = suggestions.slice(0, 10);
  onLog(`✅ [Tahap 1] Ditemukan ${goldenKeywords.length} golden keyword:`);
  goldenKeywords.forEach((kw, i) => onLog(`   ${i + 1}. ${kw}`));

  return goldenKeywords;
}

// ─────────────────────────────────────────────
// TAHAP 2 & 3: Seeding A-Z
// ─────────────────────────────────────────────

/**
 * Scrape PREFIX: ketik keyword awal dulu, lalu pindah cursor ke depan dan ketik char.
 * Contoh: ketik "sunat anak" → Home → ketik spasi → Home → ketik "a" → hasil: "a sunat anak"
 * Menggunakan fill() + dispatchEvent agar terisolasi dari keyboard fisik user.
 */
async function scrapeForPrefix(page, baseKeyword, char, onLog) {
  try {
    const inputSelector = 'textarea[name="q"], input[name="q"]';
    const input = page.locator(inputSelector).first();

    // Bersihkan input
    await clearInput(page);
    await randomDelay(CONFIG.REQUEST_DELAY_MIN, CONFIG.REQUEST_DELAY_MAX);

    // Ketik keyword awal char by char (manusiawi)
    await typeHumanLike(page, inputSelector, baseKeyword);
    await randomDelay(80, 150);

    // Gunakan evaluasi DOM langsung untuk manipulasi cursor
    // Ini terisolasi dari keyboard fisik user
    await page.evaluate(({ sel, ch }) => {
      const el = document.querySelector(sel);
      if (!el) return;

      // Pindah cursor ke posisi 0 (paling depan)
      el.focus();
      el.setSelectionRange(0, 0);

      // Insert spasi di posisi 0
      const before = el.value;
      el.value = ' ' + before;
      el.setSelectionRange(1, 1);

      // Trigger input event agar Google mendeteksi perubahan
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ' ' }));
    }, { sel: 'textarea[name="q"], input[name="q"]', ch: char });

    await randomDelay(40, 80);

    // Pindah cursor ke posisi 0 lagi, lalu insert char
    await page.evaluate(({ ch }) => {
      const el = document.querySelector('textarea[name="q"], input[name="q"]');
      if (!el) return;

      el.focus();
      el.setSelectionRange(0, 0);

      // Insert char di posisi 0
      el.value = ch + el.value;
      el.setSelectionRange(1, 1);

      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }));
      el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ch }));
    }, { ch: char });

    await randomDelay(60, 120);

    // Ambil sugesti — validasi harus mengandung baseKeyword
    const suggestions = await getSuggestions(page);
    return suggestions;
  } catch (err) {
    onLog(`⚠️  Error pada prefix [${char}] "${baseKeyword}": ${err.message}`);
    return [];
  }
}

/**
 * Scrape SUFFIX: ketik keyword awal, lalu tambahkan spasi + char di belakang.
 * Contoh: ketik "sunat anak" → End → ketik " a" → hasil: "sunat anak a"
 * Menggunakan fill() + dispatchEvent agar terisolasi dari keyboard fisik user.
 */
async function scrapeForSuffix(page, baseKeyword, char, onLog) {
  try {
    const inputSelector = 'textarea[name="q"], input[name="q"]';

    // Bersihkan input
    await clearInput(page);
    await randomDelay(CONFIG.REQUEST_DELAY_MIN, CONFIG.REQUEST_DELAY_MAX);

    // Ketik keyword awal char by char (manusiawi)
    await typeHumanLike(page, inputSelector, baseKeyword);
    await randomDelay(80, 150);

    // Tambahkan " char" di belakang via DOM
    await page.evaluate(({ ch }) => {
      const el = document.querySelector('textarea[name="q"], input[name="q"]');
      if (!el) return;

      el.focus();
      const pos = el.value.length;
      el.setSelectionRange(pos, pos);

      // Append spasi + char
      el.value = el.value + ' ' + ch;
      const newPos = el.value.length;
      el.setSelectionRange(newPos, newPos);

      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ' ' + ch }));
      el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ch }));
    }, { ch: char });

    await randomDelay(60, 120);

    // Ambil sugesti — validasi harus mengandung baseKeyword
    const suggestions = await getSuggestions(page);
    return suggestions;
  } catch (err) {
    onLog(`⚠️  Error pada suffix [${char}] "${baseKeyword}": ${err.message}`);
    return [];
  }
}

/**
 * Scrape MIDDLE: ketik keyword awal, lalu insert char setelah kata pertama.
 * Contoh: "sunat anak" -> "sunat a anak"
 */
async function scrapeForMiddle(page, baseKeyword, char, onLog) {
  try {
    const words = baseKeyword.trim().split(' ');
    if (words.length < 2) {
      // Jika hanya 1 kata, middle tidak berlaku, return empty
      return [];
    }
    const midWordIdx = Math.floor(words.length / 2);
    const spaceIndex = words.slice(0, midWordIdx).join(' ').length;

    const inputSelector = 'textarea[name="q"], input[name="q"]';
    await clearInput(page);
    await randomDelay(CONFIG.REQUEST_DELAY_MIN, CONFIG.REQUEST_DELAY_MAX);

    await typeHumanLike(page, inputSelector, baseKeyword);
    await randomDelay(80, 150);

    await page.evaluate(({ ch, idx }) => {
      const el = document.querySelector('textarea[name="q"], input[name="q"]');
      if (!el) return;

      el.focus();
      const insertPos = idx; // Tepat sebelum spasi
      el.setSelectionRange(insertPos, insertPos);

      // Insert spasi + char (agak autocomplete membaca huruf terakhir, bukan spasi terakhir)
      const before = el.value.substring(0, insertPos);
      const after = el.value.substring(insertPos);
      el.value = before + ' ' + ch + after;
      
      const newPos = insertPos + 2; // spasi (1) + char (1)
      el.setSelectionRange(newPos, newPos);

      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ' ' + ch }));
      el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ch }));
    }, { ch: char, idx: spaceIndex });

    await randomDelay(60, 120);

    const suggestions = await getSuggestions(page);
    return suggestions;
  } catch (err) {
    onLog(`⚠️  Error pada middle [${char}] "${baseKeyword}": ${err.message}`);
    return [];
  }
}

/**
 * Tahap 2: Seeding karakter di DEPAN keyword
 */
async function scrapePrefix(page, goldenKeyword, chars, onLog, onProgress, cancelToken = { cancelled: false }, overallOffset = 0, overallSpan = 40) {
  const results = [];
  const charList = chars.split('');

  onLog(`\n📌 [Tahap 2] Seeding DEPAN untuk: "${goldenKeyword}" (${charList.length} karakter)`);

  for (let i = 0; i < charList.length; i++) {
    if (cancelToken.cancelled) throw new Error('CANCELLED');

    const char = charList[i];
    onLog(`   ➤ Prefix [${char}] → "${char} ${goldenKeyword}"`);

    const keywords = await scrapeForPrefix(page, goldenKeyword, char, onLog);
    results.push({ char, keywords });

    const localPct = Math.round(((i + 1) / charList.length) * 100);
    const overallPct = Math.round(overallOffset + ((i + 1) / charList.length) * overallSpan);
    onProgress({
      stage: 'prefix',
      goldenKeyword,
      char,
      found: keywords.length,
      progress: localPct,
      overallPct,
    });

    await randomDelay(CONFIG.REQUEST_DELAY_MIN, CONFIG.REQUEST_DELAY_MAX);
  }

  return results;
}

/**
 * Tahap 3: Seeding karakter di BELAKANG keyword
 */
async function scrapeSuffix(page, goldenKeyword, chars, onLog, onProgress, cancelToken = { cancelled: false }, overallOffset = 0, overallSpan = 40) {
  const results = [];
  const charList = chars.split('');

  onLog(`\n📌 [Tahap 3] Seeding BELAKANG untuk: "${goldenKeyword}" (${charList.length} karakter)`);

  for (let i = 0; i < charList.length; i++) {
    if (cancelToken.cancelled) throw new Error('CANCELLED');

    const char = charList[i];
    onLog(`   ➤ Suffix [${char}] → "${goldenKeyword} ${char}"`);

    const keywords = await scrapeForSuffix(page, goldenKeyword, char, onLog);
    results.push({ char, keywords });

    const localPct = Math.round(((i + 1) / charList.length) * 100);
    const overallPct = Math.round(overallOffset + ((i + 1) / charList.length) * overallSpan);
    onProgress({
      stage: 'suffix',
      goldenKeyword,
      char,
      found: keywords.length,
      progress: localPct,
      overallPct,
    });

    await randomDelay(CONFIG.REQUEST_DELAY_MIN, CONFIG.REQUEST_DELAY_MAX);
  }

  return results;
}

/**
 * Tahap 4: Seeding karakter di TENGAH keyword
 */
async function scrapeMiddle(page, goldenKeyword, chars, onLog, onProgress, cancelToken = { cancelled: false }, overallOffset = 0, overallSpan = 30) {
  const results = [];
  const charList = chars.split('');
  const words = goldenKeyword.trim().split(' ');

  if (words.length < 2) {
    onLog(`\n📌 [Tahap 4] Dibelati: Keyword "${goldenKeyword}" hanya 1 kata, tidak bisa ditengah.`);
    return [];
  }

  const midWordIdx = Math.floor(words.length / 2);
  const spaceIndex = words.slice(0, midWordIdx).join(' ').length;

  onLog(`\n📌 [Tahap 4] Seeding TENGAH untuk: "${goldenKeyword}" (${charList.length} karakter)`);
  const word1 = goldenKeyword.substring(0, spaceIndex);
  const word2 = goldenKeyword.substring(spaceIndex + 1);

  for (let i = 0; i < charList.length; i++) {
    if (cancelToken.cancelled) throw new Error('CANCELLED');

    const char = charList[i];
    onLog(`   ➤ Middle [${char}] → "${word1} ${char} ${word2}"`);

    const keywords = await scrapeForMiddle(page, goldenKeyword, char, onLog);
    if (keywords.length > 0) results.push({ char, keywords });

    const localPct = Math.round(((i + 1) / charList.length) * 100);
    const overallPct = Math.round(overallOffset + ((i + 1) / charList.length) * overallSpan);
    onProgress({
      stage: 'middle',
      goldenKeyword,
      char,
      found: keywords.length,
      progress: localPct,
      overallPct,
    });

    await randomDelay(CONFIG.REQUEST_DELAY_MIN, CONFIG.REQUEST_DELAY_MAX);
  }

  return results;
}

// ─────────────────────────────────────────────
// FUNGSI SCRAPER UTAMA
// ─────────────────────────────────────────────

/**
 * Menjalankan seluruh proses scraping
 * @param {string} targetKeyword - Kata kunci target dari pengguna
 * @param {boolean} headless - Mode headless atau visible
 * @param {function} onLog - Callback untuk mengirim log ke SSE
 * @param {function} onProgress - Callback untuk update progres
 * @param {object} cancelToken - { cancelled: boolean } — set true dari luar untuk stop
 * @returns {object} { goldenKeywords, rawData }
 */
/**
 * Menjalankan seluruh proses scraping
 * @param {string} targetKeyword
 * @param {boolean} headless
 * @param {function} onLog
 * @param {function} onProgress
 * @param {object} cancelToken - { cancelled: boolean }
 * @param {object} seedConfig  - { chars: string, prefix: boolean, suffix: boolean }
 */
async function runScraper(targetKeyword, headless = true, onLog, onProgress, cancelToken = { cancelled: false }, seedConfig = {}) {
  let browser = null;

  const CHARS      = seedConfig.chars  || CONFIG.SEED_CHARS;
  const DO_PREFIX  = seedConfig.prefix !== false;
  const DO_MIDDLE  = seedConfig.middle === true;
  const DO_SUFFIX  = seedConfig.suffix !== false;

  function checkCancel() {
    if (cancelToken.cancelled) throw new Error('CANCELLED');
  }

  try {
    onLog(`🚀 Memulai Keyword Scraping Tool`);
    onLog(`🎯 Target: "${targetKeyword}"`);
    onLog(`🌐 Mode: ${headless ? 'Headless' : 'Visible (UI)'}`);
    onLog(`🔡 Karakter: ${CHARS.length} char | Depan: ${DO_PREFIX ? '✓' : '✗'} | Tengah: ${DO_MIDDLE ? '✓' : '✗'} | Belakang: ${DO_SUFFIX ? '✓' : '✗'}`);
    onLog(`📊 Estimasi pencarian: ${CHARS.length * ((DO_PREFIX?1:0)+(DO_MIDDLE?1:0)+(DO_SUFFIX?1:0))}`);

    const { browser: b, page } = await createBrowser(headless);
    browser = b;
    onLog(`✅ Browser berhasil dibuat`);

    checkCancel();

    // Tahap 1: Golden Keywords (dengan trailing space)
    const keywordWithSpace = targetKeyword.trim() + ' ';
    const goldenKeywords = await scrapeGoldenKeywords(page, keywordWithSpace, onLog);

    if (goldenKeywords.length === 0) {
      throw new Error('Tidak dapat mengambil golden keyword. Proses dihentikan.');
    }

    checkCancel();
    onProgress({ stage: 'golden_done', goldenKeywords, overallPct: 5 });

    const seedKeyword = targetKeyword.trim();
    onLog(`\n${'═'.repeat(50)}`);
    onLog(`🌱 Seeding dari: "${seedKeyword}"`);
    onLog(`${'═'.repeat(50)}`);

    onProgress({ stage: 'processing_golden', current: 1, total: 1, keyword: seedKeyword, overallPct: 8 });

    const prefix = [];
    const middle = [];
    const suffix = [];

    // Hitung span untuk progress agar 10% → 95%
    const totalSpan = 85; 
    const stagesCount = (DO_PREFIX?1:0) + (DO_MIDDLE?1:0) + (DO_SUFFIX?1:0);
    const spanPerStage = stagesCount > 0 ? totalSpan / stagesCount : 0;
    
    let currentOffset = 10;

    // Tahap 2: Prefix
    if (DO_PREFIX) {
      const result = await scrapePrefix(page, seedKeyword, CHARS, onLog, onProgress, cancelToken, currentOffset, spanPerStage);
      prefix.push(...result);
      currentOffset += spanPerStage;
      checkCancel();
    } else {
      onLog(`⏭️  Seeding DEPAN dilewati`);
    }

    // Tahap 3: Middle
    if (DO_MIDDLE && seedKeyword.includes(' ')) {
      const result = await scrapeMiddle(page, seedKeyword, CHARS, onLog, onProgress, cancelToken, currentOffset, spanPerStage);
      middle.push(...result);
      currentOffset += spanPerStage;
      checkCancel();
    } else if (DO_MIDDLE) {
      onLog(`⏭️  Seeding TENGAH dilewati (keyword hanya 1 kata)`);
      currentOffset += spanPerStage;
    }

    // Tahap 4: Suffix
    if (DO_SUFFIX) {
      const result = await scrapeSuffix(page, seedKeyword, CHARS, onLog, onProgress, cancelToken, currentOffset, spanPerStage);
      suffix.push(...result);
    } else {
      onLog(`⏭️  Seeding BELAKANG dilewati`);
    }

    const rawData = [{ goldenKeyword: seedKeyword, prefix, middle, suffix }];

    let totalKeywords = 0;
    for (const p of prefix) totalKeywords += p.keywords.length;
    for (const m of middle) totalKeywords += m.keywords.length;
    for (const s of suffix) totalKeywords += s.keywords.length;

    onLog(`\n${'═'.repeat(50)}`);
    onLog(`🎉 Scraping selesai!`);
    onLog(`📈 Total kata kunci mentah terkumpul: ${totalKeywords}`);
    onLog(`${'═'.repeat(50)}\n`);

    onProgress({ stage: 'scraping_done', totalKeywords, overallPct: 95 });

    return { goldenKeywords, rawData };
  } finally {
    if (browser) {
      await browser.close();
      onLog(`🔒 Browser ditutup`);
    }
  }
}

/**
 * Debug helper: snapshot HTML dropdown untuk diagnosa selector
 * Panggil jika sugesti masih tidak terbaca dengan benar.
 */
async function debugDropdownHTML(page) {
  try {
    const html = await page.evaluate(() => {
      const el = document.querySelector('ul[role="listbox"]');
      return el ? el.innerHTML.substring(0, 3000) : 'listbox tidak ditemukan';
    });
    console.log('[DEBUG] Dropdown HTML:\n', html);
  } catch (e) {
    console.log('[DEBUG] Error:', e.message);
  }
}

module.exports = { runScraper, CONFIG, debugDropdownHTML };
