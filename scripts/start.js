/**
 * scripts/start.js
 * Otomatis bebaskan port 3000 jika masih terpakai, lalu jalankan server.
 */
const { execSync, spawn } = require('child_process');
const PORT = process.env.PORT || 3000;

function killPort(port) {
  try {
    const result = execSync(
      `netstat -ano | findstr :${port} | findstr LISTENING`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }
    );
    const lines = result.trim().split('\n');
    const pids = new Set();
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && !isNaN(pid) && pid !== '0') pids.add(pid);
    }
    for (const pid of pids) {
      try {
        execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
        console.log(`✅ Port ${port} dibebaskan (PID ${pid})`);
      } catch {}
    }
  } catch {
    // Port tidak sedang dipakai — lanjut
  }
}

killPort(PORT);

// Jalankan server
const server = spawn('node', ['server.js'], {
  stdio: 'inherit',
  cwd: __dirname + '/..',
});

server.on('exit', (code) => {
  process.exit(code ?? 0);
});
