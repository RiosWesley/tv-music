import dgram from 'node:dgram';
import net from 'node:net';
import { networkInterfaces } from 'node:os';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import WebSocket from 'ws';

const APP_ID = 'com.wesley.tvmusic';
const SSAP_PORT = 3001;
const TV_FILE = join(import.meta.dirname, 'tv-key.json'); // chave de pareamento e último IP da TV

function portOpen(host, port, timeout = 700) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout });
    const done = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false)); // porta fechada ou host inexistente: é a resposta esperada da varredura
  });
}

// IPs com a porta de controle da LG aberta, começando pelo último IP conhecido. Varre o /24 de cada rede do PC
// por TCP de saída, que o firewall do Windows não bloqueia (a descoberta por SSDP depende de UDP de entrada).
export async function findTvs(lastIp) {
  if (lastIp && (await portOpen(lastIp, SSAP_PORT))) return [lastIp];
  const prefixes = new Set(
    Object.values(networkInterfaces())
      .flat()
      .filter((a) => a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'))
      .map((a) => a.address.split('.').slice(0, 3).join('.')),
  );
  const hosts = [...prefixes].flatMap((prefix) => Array.from({ length: 254 }, (_, i) => `${prefix}.${i + 1}`));
  const found = [];
  for (let i = 0; i < hosts.length; i += 64) {
    const batch = hosts.slice(i, i + 64);
    const open = await Promise.all(batch.map((host) => portOpen(host, SSAP_PORT)));
    found.push(...batch.filter((_, j) => open[j]));
  }
  return found;
}

// Outro aparelho pode ter a porta 3001 aberta (ex.: servidor de desenvolvimento); só a TV aceita a conexão SSAP.
async function connectToAny(ips) {
  for (const ip of ips) {
    try {
      return { ip, tv: await connect(ip) };
    } catch (e) {
      console.warn(`${ip} tem a porta ${SSAP_PORT} aberta mas não é a TV (${e.message})`);
    }
  }
  throw new Error('TV LG não encontrada na rede. Ela está ligada e na mesma rede do PC?');
}

// IP deste PC na interface que alcança a TV (ignora VPN, WSL etc.). connect() em UDP só consulta a rota, não envia nada.
function localAddressTo(ip) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    socket.on('error', reject);
    socket.connect(9, ip, () => {
      const { address } = socket.address();
      socket.close();
      resolve(address);
    });
  });
}

// Sessão SSAP (API de controle da LG). Na primeira vez a TV pede para aceitar este PC.
function connect(ip) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://${ip}:${SSAP_PORT}`, { rejectUnauthorized: false, handshakeTimeout: 5000 }); // certificado autoassinado da TV
    const pending = new Map();
    let nextId = 0;

    function call(message, expect, timeout) {
      const id = String(nextId++);
      return new Promise((done, fail) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          fail(new Error(`A TV não respondeu a ${message.uri ?? message.type}`));
        }, timeout);
        pending.set(id, { expect, done, fail, timer });
        ws.send(JSON.stringify({ id, ...message }));
      });
    }

    ws.on('message', (data) => {
      const msg = JSON.parse(data);
      const waiter = pending.get(msg.id);
      if (!waiter || (msg.type !== waiter.expect && msg.type !== 'error')) return;
      pending.delete(msg.id);
      clearTimeout(waiter.timer);
      if (msg.type === 'error') waiter.fail(new Error(`TV recusou: ${msg.error}`));
      else waiter.done(msg.payload);
    });
    ws.once('error', reject);
    ws.once('open', () =>
      resolve({
        register: (clientKey) =>
          call(
            {
              type: 'register',
              payload: {
                'client-key': clientKey,
                pairingType: 'PROMPT',
                manifest: { manifestVersion: 1, permissions: ['LAUNCH'] },
              },
            },
            'registered',
            60000,
          ),
        request: (uri, payload) => call({ type: 'request', uri, payload }, 'response', 10000),
        close: () => ws.close(),
      }),
    );
  });
}

// Abre (ou reabre) o app na TV apontando para este servidor. Retorna o endereço usado.
export async function openOnTv(port) {
  const saved = existsSync(TV_FILE) ? JSON.parse(readFileSync(TV_FILE, 'utf8')) : {};
  const { ip, tv } = await connectToAny(await findTvs(saved.ip));
  try {
    const { 'client-key': clientKey } = await tv.register(saved.clientKey);
    if (clientKey !== saved.clientKey || ip !== saved.ip) writeFileSync(TV_FILE, JSON.stringify({ clientKey, ip }));
    const server = `http://${await localAddressTo(ip)}:${port}`;
    // Se o app já estiver aberto, a TV entrega os parâmetros pelo evento webOSRelaunch (tratado nas páginas do app).
    await tv.request('ssap://system.launcher/launch', { id: APP_ID, params: { server } });
    return { tv: ip, server };
  } finally {
    tv.close();
  }
}
