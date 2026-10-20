import { Innertube, Log } from 'youtubei.js';

Log.setLevel(Log.Level.NONE);
let client = null;

// Quem adicionou cada música em playlists colaborativas (ID do vídeo -> nome). O youtubei.js descarta esse campo,
// então ele é lido das respostas brutas do /browse. Se o YouTube mudar o formato, só o nome some.
const contributors = new Map();

function collectContributors(node) {
  if (!node || typeof node !== 'object') return;
  const row = node.musicResponsiveListItemRenderer;
  const id = row?.playlistItemData?.videoId;
  const name = row?.contributorsAvatars?.avatarStackViewModel?.avatars?.[0]?.avatarViewModel?.accessibilityText;
  if (id && name) contributors.set(id, name);
  for (const value of Object.values(node)) collectContributors(value);
}

async function fetchRecordingContributors(input, init) {
  const response = await fetch(input, init);
  if (response.ok && new URL(input.url ?? input).pathname.endsWith('/browse')) {
    collectContributors(await response.clone().json());
  }
  return response;
}

// Lazy e refeito após falha: o servidor sobe mesmo sem internet no boot.
function youtube() {
  client ??= Innertube.create({ fetch: fetchRecordingContributors }).catch((e) => {
    client = null;
    throw e;
  });
  return client;
}

export function parseLink(input) {
  const text = String(input ?? '').trim();
  if (/^[\w-]{11}$/.test(text)) return { video: text };
  let url;
  try {
    url = new URL(text);
  } catch {
    if (/^[\w-]{12,}$/.test(text)) return { list: text };
    throw new Error('Link inválido');
  }
  const list = url.searchParams.get('list');
  const video = url.searchParams.get('v') ?? (url.hostname === 'youtu.be' ? url.pathname.slice(1) : null);
  if (list && (url.pathname === '/playlist' || !video)) return { list };
  if (video) return { video };
  throw new Error('O link não tem playlist nem música');
}

const toItem = (v) => ({
  id: v.id,
  title: String(v.title ?? ''),
  artist: (v.artists ?? v.authors ?? []).map((a) => a.name).join(', '),
  duration: v.duration?.seconds ?? 0,
  addedBy: contributors.get(v.id) ?? '',
});

// Link → itens da fila. Playlists vêm completas (segue todas as páginas).
export async function resolve(link) {
  const { list, video } = parseLink(link);
  const yt = await youtube();
  if (video) {
    const { basic_info: info } = await yt.music.getInfo(video);
    return [{ id: video, title: info.title ?? '', artist: info.author ?? '', duration: info.duration ?? 0, addedBy: '' }];
  }
  contributors.clear();
  let page = await yt.music.getPlaylist(list.replace(/^VL/, ''));
  const items = [...(page.contents ?? [])];
  while (page.has_continuation) {
    page = await page.getContinuation();
    items.push(...(page.contents ?? []));
  }
  return items.filter((v) => v.id).map(toItem);
}
