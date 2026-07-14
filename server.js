/**
 * server.js
 * Express server dengan Server-Sent Events (SSE) untuk real-time logging
 */

const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const { runScraper } = require("./src/scraper");
const {
  processAndClassify,
  exportToExcel,
  classifyUploadedExcel,
  deriveGoldenFromSeeding,
} = require("./src/classifier");

const app = express();
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────────
// MULTER: Upload Excel
// ─────────────────────────────────────────────
const upload = multer({
  dest: path.join(__dirname, "uploads"),
  limits: { fileSize: 20 * 1024 * 1024 }, // maks 20MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if ([".xlsx", ".xls"].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Hanya file .xlsx atau .xls yang diizinkan."));
    }
  },
});

// ─────────────────────────────────────────────
// MIDDLEWARE
// ─────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─────────────────────────────────────────────
// STATE MANAGEMENT (in-memory, per session)
// ─────────────────────────────────────────────
const sessions = new Map(); // sessionId -> { sseClients: Set, status, results, cancelToken }

function generateSessionId() {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// ─────────────────────────────────────────────
// SSE: Kirim event ke semua klien dalam sesi
// ─────────────────────────────────────────────
function sendSSE(sessionId, eventName, data) {
  const session = sessions.get(sessionId);
  if (!session) return;

  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;

  for (const client of session.sseClients) {
    try {
      client.write(payload);
    } catch {
      session.sseClients.delete(client);
    }
  }
}

// ─────────────────────────────────────────────
// ROUTE: SSE - Subscribe ke update
// ─────────────────────────────────────────────
app.get("/api/stream/:sessionId", (req, res) => {
  const { sessionId } = req.params;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();

  // Kirim "connected" event
  res.write(`event: connected\ndata: ${JSON.stringify({ sessionId })}\n\n`);

  // Pastikan sesi ada
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      sseClients: new Set(),
      status: "idle",
      results: null,
    });
  }

  const session = sessions.get(sessionId);
  session.sseClients.add(res);

  // Kirim status terkini jika sesi sudah berjalan
  if (session.status !== "idle") {
    res.write(
      `event: status\ndata: ${JSON.stringify({ status: session.status })}\n\n`,
    );
  }

  // Heartbeat setiap 25 detik untuk mencegah timeout
  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    session.sseClients.delete(res);
  });
});

// ─────────────────────────────────────────────
// ROUTE: POST /api/start - Mulai proses scraping
// ─────────────────────────────────────────────
app.post("/api/start", async (req, res) => {
  const {
    keyword,
    headless = true,
    sessionId: existingSessionId,
    seedConfig,
    colorConfig,
  } = req.body;

  if (!keyword || keyword.trim() === "") {
    return res
      .status(400)
      .json({ success: false, error: "Kata kunci tidak boleh kosong." });
  }

  // Validasi seedConfig
  const config = {
    chars: seedConfig?.chars || "abcdefghijklmnopqrstuvwxyz0123456789",
    prefix: seedConfig?.prefix !== false,
    middle: seedConfig?.middle === true,
    suffix: seedConfig?.suffix !== false,
  };

  // Buat atau gunakan session ID
  const sessionId = existingSessionId || generateSessionId();

  // Inisialisasi session
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      sseClients: new Set(),
      status: "idle",
      results: null,
    });
  }

  const session = sessions.get(sessionId);

  // Cegah double run
  if (session.status === "running") {
    return res
      .status(409)
      .json({ success: false, error: "Proses sedang berjalan." });
  }

  session.status = "running";
  session.results = null;
  // CancelToken: object shared dengan scraper agar bisa dicek tiap iterasi
  session.cancelToken = { cancelled: false };

  // Kirim respons awal (sessionId untuk SSE)
  res.json({ success: true, sessionId });

  // Jalankan scraper secara asinkron (non-blocking)
  setImmediate(async () => {
    try {
      sendSSE(sessionId, "status", { status: "running" });

      const onLog = (message) => {
        sendSSE(sessionId, "log", {
          message,
          timestamp: new Date().toISOString(),
        });
      };

      const onProgress = (data) => {
        sendSSE(sessionId, "progress", data);
      };

      // Jalankan scraper
      const { goldenKeywords, rawData } = await runScraper(
        keyword.trim(),
        headless,
        onLog,
        onProgress,
        session.cancelToken,
        config,
      );

      // Klasifikasi dan proses data
      onLog(`\n🔄 Mengklasifikasi kata kunci...`);
      const refinedGolden = deriveGoldenFromSeeding(rawData, goldenKeywords);
      onLog(`🥇 Golden keyword di-refine: ${refinedGolden.length} keyword (dari ${goldenKeywords.length} awal)`);
      const classifiedRows = processAndClassify(
        rawData,
        refinedGolden,
        keyword.trim(),
        req.body.sortConfig || {}
      );

      // Export ke Excel
      onLog(`📊 Membuat file Excel...`);
      const outputDir = path.join(__dirname, "output");
      const excelPath = await exportToExcel(
        classifiedRows,
        refinedGolden,
        outputDir,
        keyword.trim(),
        colorConfig || {},
      );
      const excelFilename = path.basename(excelPath);

      onLog(`✅ File Excel berhasil dibuat: ${excelFilename}`);

      // Hitung ringkasan
      const totalData = classifiedRows.filter((r) => r.type === "data");
      const summary = {
        total: totalData.length,
        golden: refinedGolden.length,
        buying: totalData.filter((r) => r.buying).length,
        longtail: totalData.filter((r) => r.longtail).length,
        competitor: totalData.filter((r) => r.competitor).length,
      };

      session.results = {
        goldenKeywords: refinedGolden,
        excelFilename,
        summary,
        rows: classifiedRows,
      };
      session.status = "done";

      sendSSE(sessionId, "done", {
        summary,
        excelFilename,
        goldenKeywords: refinedGolden,
        downloadUrl: `/api/download/${excelFilename}`,
        txtUrl: `/api/export-txt/${sessionId}`,
      });
    } catch (error) {
      console.error("Scraper error:", error);
      // Bedakan cancel vs error biasa
      if (error.message === "CANCELLED") {
        session.status = "cancelled";
        sendSSE(sessionId, "cancelled", {
          message: "Proses dihentikan oleh pengguna.",
        });
      } else {
        session.status = "error";
        sendSSE(sessionId, "error", {
          message: error.message || "Terjadi kesalahan tidak diketahui.",
        });
      }
    }
  });
});

// ─────────────────────────────────────────────
// ROUTE: GET /api/export-txt/:sessionId - Export hasil ke .txt
// ─────────────────────────────────────────────
app.get("/api/export-txt/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);

  if (!session || !session.results) {
    return res.status(404).json({ error: "Hasil tidak ditemukan." });
  }

  const { rows, goldenKeywords } = session.results;
  const lines = [];

  // Ikuti urutan rows persis seperti di Excel:
  // golden_header → data → header → data → header → data → ...
  for (const row of rows) {
    if (row.type === "golden_header") {
      // Blok golden keywords — tulis label lalu semua golden kw
      lines.push(row.label);
    } else if (row.type === "header") {
      // Separator A-Z — baris kosong sebelumnya agar rapi, lalu label
      if (lines.length > 0 && lines[lines.length - 1] !== "") {
        lines.push("");
      }
      lines.push(row.label);
    } else if (row.type === "data") {
      // Keyword — tulis langsung, hanya kolom rawSeed
      if (row.rawSeed) lines.push(row.rawSeed);
    }
  }

  const content = lines.join("\r\n");
  const keyword =
    session.results.excelFilename?.replace(
      /_\d{2}-\d{2}-\d{4}_\d{2}-\d{2}\.xlsx$/,
      "",
    ) || "keyword";
  const filename = `${keyword}_keywords.txt`;

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send("\uFEFF" + content); // BOM untuk Notepad UTF-8
});

// ─────────────────────────────────────────────
// ROUTE: POST /api/cancel/:sessionId - Cancel proses
// ─────────────────────────────────────────────
app.post("/api/cancel/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);

  if (!session) {
    return res.status(404).json({ error: "Sesi tidak ditemukan." });
  }

  if (session.status !== "running") {
    return res
      .status(409)
      .json({ error: "Tidak ada proses yang sedang berjalan." });
  }

  // Set flag cancel — scraper akan cek ini setiap iterasi
  if (session.cancelToken) {
    session.cancelToken.cancelled = true;
  }

  res.json({ success: true, message: "Sinyal cancel dikirim." });
});

// ─────────────────────────────────────────────
// ROUTE: POST /api/upload - Upload & Klasifikasi Excel
// ─────────────────────────────────────────────
app.post("/api/upload", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res
      .status(400)
      .json({ success: false, error: "Tidak ada file yang diupload." });
  }

  const uploadedPath = req.file.path;

  try {
    const outputDir = path.join(__dirname, "output");
    let colorConfig = {};
    let sortConfig = {};
    try { if (req.body.colorConfig) colorConfig = JSON.parse(req.body.colorConfig); } catch (e) {}
    try { if (req.body.sortConfig) sortConfig = JSON.parse(req.body.sortConfig); } catch (e) {}

    const { filename, stats } = await classifyUploadedExcel(
      uploadedPath,
      outputDir,
      sortConfig,
      colorConfig,
    );

    res.json({
      success: true,
      filename,
      stats,
      downloadUrl: `/api/download/${filename}`,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  } finally {
    // Hapus file upload sementara
    fs.unlink(uploadedPath, () => {});
  }
});

// ─────────────────────────────────────────────
// ROUTE: GET /api/download/:filename - Download Excel
// ─────────────────────────────────────────────
app.get("/api/download/:filename", (req, res) => {
  const { filename } = req.params;

  // Validasi nama file (cegah path traversal)
  if (!filename.match(/^[\w\-\.]+\.xlsx$/) || filename.includes("..")) {
    return res.status(400).json({ error: "Nama file tidak valid." });
  }

  const filepath = path.join(__dirname, "output", filename);

  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: "File tidak ditemukan." });
  }

  res.download(filepath, filename);
});

// ─────────────────────────────────────────────
// ROUTE: GET /api/results/:sessionId - Ambil hasil
// ─────────────────────────────────────────────
app.get("/api/results/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);

  if (!session) {
    return res.status(404).json({ error: "Sesi tidak ditemukan." });
  }

  res.json({
    status: session.status,
    results: session.results,
  });
});

// ─────────────────────────────────────────────
// ROUTE: GET /api/files - Daftar file output yang ada
// ─────────────────────────────────────────────
app.get("/api/files", (req, res) => {
  const outputDir = path.join(__dirname, "output");

  if (!fs.existsSync(outputDir)) {
    return res.json({ files: [] });
  }

  const files = fs
    .readdirSync(outputDir)
    .filter((f) => f.endsWith(".xlsx"))
    .map((f) => {
      const stat = fs.statSync(path.join(outputDir, f));
      return {
        name: f,
        size: stat.size,
        created: stat.birthtime,
        downloadUrl: `/api/download/${f}`,
      };
    })
    .sort((a, b) => new Date(b.created) - new Date(a.created));

  res.json({ files });
});

// ─────────────────────────────────────────────
// ROUTE: DELETE /api/files/:filename - Hapus file
// ─────────────────────────────────────────────
app.delete("/api/files/:filename", (req, res) => {
  const { filename } = req.params;

  if (!filename.match(/^[\w\-\.]+\.xlsx$/) || filename.includes("..")) {
    return res.status(400).json({ error: "Nama file tidak valid." });
  }

  const filepath = path.join(__dirname, "output", filename);

  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: "File tidak ditemukan." });
  }

  fs.unlinkSync(filepath);
  res.json({ success: true, message: `File ${filename} berhasil dihapus.` });
});

// ─────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(
    `\n🚀 Keyword Scraping Tool berjalan di: http://localhost:${PORT}`,
  );
  console.log(`📁 Output folder: ${path.join(__dirname, "output")}`);
  console.log(`\nTekan Ctrl+C untuk menghentikan server.\n`);

  // Buat folder output jika belum ada
  const outputDir = path.join(__dirname, "output");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
});

module.exports = app;
