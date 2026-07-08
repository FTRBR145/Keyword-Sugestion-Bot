/**
 * scripts/stop.js
 * Hentikan server yang berjalan di port 3000.
 */
const { execSync } = require('child_process');
const PORT = process.env.PORT || 3000;

try {
  const result = execSync(
    `netstat -ano | findstr :${PORT} | findstr LISTENING`,
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }
  );
  const lines = result.trim().split('\n');
  let stopped = 0;
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    const pid = parts[parts.length - 1];
    if (pid && !isNaN(pid) && pid !== '0') {
      execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
      console.log(`🛑 Server dihentikan (PID ${pid})`);
      stopped++;
    }
  }
  if (stopped === 0) console.log(`ℹ️  Tidak ada server yang berjalan di port ${PORT}.`);
} catch {
  console.log(`ℹ️  Tidak ada server yang berjalan di port ${PORT}.`);
}
