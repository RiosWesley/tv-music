import http from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { networkInterfaces } from 'node:os';
import { createPlayer, initialState } from './player.js';
import { resolve } from './youtube.js';
import { openOnTv } from './tv.js';
import { createVotes } from './votes.js';

const PORT = Number(process.env.PORT ?? 8080);
const STATE_FILE = join(import.meta.dirname, 'state.json');
const VOTES_FILE = join(import.meta.dirname, 'votes.json');
const PAGES = { '/': 'remote.html', '/ouvinte': 'listener.html', '/tv': 'tv.html' };

// Campos novos ficam com o valor inicial quando o state.json é de uma versão anterior.
const state = { ...initialState(), ...(existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {}) };
state.tv = false;
const votes = createVotes(existsSync(VOTES_FILE) ? JSON.parse(readFileSync(VOTES_FILE, 'utf8')) : {});
const player = createPlayer(state, votes.weights);
const clients = new Map(); // res -> 'tv' | 'remote'

function send(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// O que as telas recebem: o estado salvo mais os votos de todas as músicas (só as votadas aparecem).
function snapshot() {
  return { ...state, votes: votes.toJSON() };
}

function emit(event = 'state', data = snapshot()) {
  for (const res of clients.keys()) send(res, event, data);
  if (event === 'state') writeFileSync(STATE_FILE, JSON.stringify(state));
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1e5) throw new Error('Corpo grande demais');
  }
  return JSON.parse(body || '{}');
}

async function runCommand(body) {
  if (body.type === 'load') player.load(await resolve(body.url), body.mode);
  else if (Object.hasOwn(player.commands, body.type)) player.commands[body.type](body);
  else throw new Error('Comando desconhecido');
  if (body.type === 'seek') emit('seek', state.time);
  emit();
}

async function openTv() {
  const { tv, server } = await openOnTv(PORT);
  console.log(`App aberto na TV ${tv}. Celular (admin): ${server}  |  Ouvintes: ${server}/ouvinte`);
  setTimeout(() => {
    if (state.tv) return;
    console.warn(
      `A TV não conseguiu acessar ${server}. Provável firewall do Windows: em "Permitir um aplicativo pelo Firewall do Windows", ` +
        'marque Node.js em "Privada" e "Pública" (ou mude esta rede para Privada).',
    );
  }, 20000);
}

function openStream(req, res, role) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write('retry: 2000\n\n');
  clients.set(res, role);
  if (role === 'tv') {
    state.tv = true;
    emit();
  } else {
    send(res, 'state', snapshot());
  }
  req.on('close', () => {
    clients.delete(res);
    state.tv = [...clients.values()].includes('tv');
    emit();
  });
}

setInterval(() => {
  for (const res of clients.keys()) res.write(': ping\n\n');
}, 15000);

// O modo desenvolvedor da LG expira em ~50h e remove o app; isto renova sozinho enquanto o servidor roda.
const devToken = process.env.LG_DEVMODE_TOKEN;
if (devToken) {
  const renew = () =>
    fetch(`https://developer.lge.com/secure/ResetDevModeSession.dev?sessionToken=${encodeURIComponent(devToken)}`)
      .then((r) => r.json())
      .then((body) => {
        if (body.result !== 'success') throw new Error(`${body.errorCode} ${body.errorMsg}`);
        console.log('Dev mode LG renovado');
      })
      .catch((e) => console.error('Falha ao renovar dev mode LG:', e.message));
  renew();
  setInterval(renew, 12 * 3600e3);
}

http
  .createServer(async (req, res) => {
    const { pathname, searchParams } = new URL(req.url, 'http://x');
    try {
      // O YouTube recusa (erro 150) músicas de gravadora quando o player está numa página aberta por IP.
      // ponytail: depende do DNS público nip.io; troque por um nome do roteador se ele passar a resolver o PC.
      const ipHost = /^\d+\.\d+\.\d+\.\d+(:\d+)?$/.test(req.headers.host ?? '');
      if (req.method === 'GET' && pathname === '/tv' && ipHost) {
        const [ip, port] = req.headers.host.split(':');
        res.writeHead(302, { Location: `http://${ip}.nip.io${port ? `:${port}` : ''}/tv` }).end();
      } else if (req.method === 'GET' && PAGES[pathname]) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(readFileSync(join(import.meta.dirname, 'public', PAGES[pathname])));
      } else if (req.method === 'GET' && pathname === '/ping') {
        res.writeHead(200, { 'Access-Control-Allow-Origin': '*' }).end('ok');
      } else if (req.method === 'GET' && pathname === '/events') {
        openStream(req, res, searchParams.get('role') === 'tv' ? 'tv' : 'remote');
      } else if (req.method === 'POST' && pathname === '/cmd') {
        await runCommand(await readJson(req));
        res.writeHead(204).end();
      } else if (req.method === 'POST' && pathname === '/vote') {
        const body = await readJson(req);
        const item = state.queue.find((q) => q.id === body.id);
        if (!item) throw new Error('Essa música não está na fila');
        votes.vote(body);
        writeFileSync(VOTES_FILE, JSON.stringify(votes));
        if (body.value) emit('vote', { name: String(body.name).trim(), value: body.value, title: item.title });
        emit();
        res.writeHead(204).end();
      } else if (req.method === 'POST' && pathname === '/open-tv') {
        await openTv();
        res.writeHead(204).end();
      } else if (req.method === 'POST' && pathname === '/tv') {
        const report = await readJson(req);
        if (report.type === 'error' && report.playId === state.playId) {
          const item = state.queue[state.index];
          console.warn(`TV pulou ${item?.id} "${item?.title}": erro ${report.code} do YouTube`);
        }
        const event = player.report(report);
        if (event === 'progress') emit('progress', { time: state.time, duration: state.duration });
        else if (event) emit();
        res.writeHead(204).end();
      } else {
        res.writeHead(404).end();
      }
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end(e.message);
    }
  })
  .listen(PORT, () => {
    const urls = Object.values(networkInterfaces())
      .flat()
      .filter((a) => a.family === 'IPv4' && !a.internal)
      .map((a) => `http://${a.address}:${PORT}`);
    console.log(`TV Music rodando. No celular: ${urls.join('  ou  ')}`);
    openTv().catch((e) => console.error(`Não abri o app na TV (${e.message}). Ligue a TV e toque em "Abrir na TV" no celular.`));
  });
