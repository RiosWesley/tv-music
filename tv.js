import dgram from 'node:dgram';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import WebSocket from 'ws';

const APP_ID = 'com.wesley.tvmusic';
const KEY_FILE = join(import.meta.dirname, 'tv-key.json');
const SEARCH = [
  'M-SEARCH * HTTP/1.1',
  'HOST: 239.255.255.250:1900',
  'MAN: "ssdp:discover"',
  'MX: 2',
  'ST: urn:lge-com:service:webos-second-screen:1',
  '',
  '',
].join('\r\n');

// Acha a TV LG na rede por SSDP, o mesmo anúncio que o app LG ThinQ usa.
function findTv(timeout = 4000) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('TV LG não encontrada na rede. Ela está ligada?'));
    }, timeout);
    socket.on('error', (e) => {
      clearTimeout(timer);
      socket.close();
      reject(e);
    });
    socket.on('message', (_msg, remote) => {
      clearTimeout(timer);
      socket.close();
      resolve(remote.address);
    });
    socket.bind(() => socket.send(SEARCH, 1900, '239.255.255.250'));
  });
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

// Sessão SSAP (API de controle da LG). Na primeira vez a TV pede para aceitar este PC; a chave fica em tv-key.json.
function connect(ip) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://${ip}:3001`, { rejectUnauthorized: false }); // certificado autoassinado da TV
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
  const ip = await findTv();
  const server = `http://${await localAddressTo(ip)}:${port}`;
  const tv = await connect(ip);
  try {
    const saved = existsSync(KEY_FILE) ? JSON.parse(readFileSync(KEY_FILE, 'utf8')).clientKey : undefined;
    const { 'client-key': clientKey } = await tv.register(saved);
    if (clientKey !== saved) writeFileSync(KEY_FILE, JSON.stringify({ clientKey }));
    // Se o app já estiver aberto, a TV entrega os parâmetros pelo evento webOSRelaunch (tratado nas páginas do app).
    await tv.request('ssap://system.launcher/launch', { id: APP_ID, params: { server } });
    return { tv: ip, server };
  } finally {
    tv.close();
  }
}
