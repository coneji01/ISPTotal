const net = require('net');
const sock = new net.Socket();
let buf = '';

sock.setTimeout(20000);

sock.on('connect', () => {
  const ip = [192, 168, 20, 80];
  const b = Buffer.alloc(9);
  b[0] = 4; b[1] = 1; b.writeUInt16BE(23, 2);
  for (let i = 0; i < 4; i++) b[4+i] = ip[i];
  b[8] = 0;
  sock.write(b);
});

let loggedIn = false;
let cmdQueue = ['terminal length 0', 'show gpon onu state', 'show gpon onu uncfg', 'show version'];

function sendNext() {
  if (cmdQueue.length === 0) {
    console.log(buf);
    process.exit(0);
  }
  const cmd = cmdQueue.shift();
  sock.write(cmd + '\r\n');
  setTimeout(sendNext, 3000);
}

sock.on('data', d => {
  buf += d.toString('ascii');
  
  if (buf.includes('Username:') && !buf.toLowerCase().includes('zteraw')) {
    sock.write('zte\r\n');
  } else if (buf.includes('Password:') && !loggedIn) {
    sock.write('zte\r\n');
    loggedIn = true;
    setTimeout(sendNext, 1000);
  }
});

sock.on('error', err => { console.error(err.message); process.exit(1); });
sock.on('timeout', () => { console.log(buf); sock.destroy(); process.exit(0); });

sock.connect(1080, '10.50.255.245');
