// Art-Net probe — run with Maestrale CLOSED and the sender (MadMapper…) running:
//   node scripts/artnet-probe.cjs            listens on every address
//   node scripts/artnet-probe.cjs 127.0.0.1  listens on one address
// Prints who holds UDP 6454, sends itself a test packet, then shows every
// Art-Net packet that arrives for 15 seconds.
const dgram = require('dgram');
const { execSync } = require('child_process');

const host = process.argv[2] || '0.0.0.0';
const OPS = { 0x5000: 'ArtDmx', 0x2000: 'ArtPoll', 0x2100: 'ArtPollReply', 0x5200: 'ArtSync' };

console.log('--- who holds UDP 6454 ---');
try {
  const lines = execSync('netstat -ano -p UDP', { encoding: 'utf8' }).split(/\r?\n/).filter((l) => /:6454\s/.test(l));
  if (!lines.length) console.log('nobody');
  for (const l of lines) {
    const pid = l.trim().split(/\s+/).pop();
    let name = '?';
    try { name = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: 'utf8' }).split(',')[0].replace(/"/g, ''); } catch { /* */ }
    console.log(l.trim(), ' ->', name);
  }
} catch (e) { console.log('(netstat not available)', e.message); }

const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
const selfSeen = {}; let n = 0, shown = 0;
const bySrc = new Map();
sock.on('error', (e) => { console.log('BIND ERROR:', e.message); process.exit(1); });
sock.on('message', (m, r) => {
  if (m.toString('ascii', 0, 7) !== 'Art-Net') return;
  const op = m.readUInt16LE(8);
  if (op === 0x5000 && m.length > 21 && m[18] === 123 && m[19] === 45) { selfSeen[m[20]] = true; return; }
  n++;
  const key = `${r.address}:${r.port} ${OPS[op] || '0x' + op.toString(16)}`;
  bySrc.set(key, (bySrc.get(key) || 0) + 1);
  if (shown < 15) {
    shown++;
    const extra = op === 0x5000 ? ` universe ${m.readUInt16LE(14) & 0x7fff} ch1-3 = ${m[18]} ${m[19]} ${m[20]}` : '';
    console.log(`  from ${r.address}:${r.port}  ${OPS[op] || op}${extra}`);
  }
});
sock.bind(6454, host, () => {
  console.log(`--- listening on ${host}:6454 ---`);
  // Self-test: one packet to 127.0.0.1 and one to 127.0.0.2 (both are this PC).
  const targets = host === '0.0.0.0' ? ['127.0.0.1', '127.0.0.2'] : [host];
  const t = dgram.createSocket('udp4');
  targets.forEach((ip, i) => {
    const p = Buffer.alloc(18 + 512); p.write('Art-Net\0', 0, 'ascii'); p.writeUInt16LE(0x5000, 8); p.writeUInt16BE(14, 10); p.writeUInt16BE(512, 16);
    p[18] = 123; p[19] = 45; p[20] = i;
    t.send(p, 6454, ip);
  });
  setTimeout(() => {
    targets.forEach((ip, i) => console.log(`self-test ${ip}: ${selfSeen[i] ? 'OK, arrives here' : 'FAILED, another program gets it'}`));
    t.close();
  }, 500);
  setTimeout(() => {
    console.log(`--- 15 s: ${n} Art-Net packets ---`);
    for (const [k, c] of bySrc) console.log(`  ${k}  x${c}`);
    process.exit(0);
  }, 15000);
});
