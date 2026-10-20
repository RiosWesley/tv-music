import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlayer, initialState } from './player.js';
import { parseLink } from './youtube.js';

const items = (...ids) => ids.map((id) => ({ id, title: id, artist: '', duration: 100 }));

function setup(ids, weights = (queueIds) => queueIds.map(() => 1)) {
  const state = initialState();
  const player = createPlayer(state, weights);
  player.load(items(...ids), 'replace');
  return { state, player, current: () => state.queue[state.index].id };
}

const end = ({ state, player }) => player.report({ type: 'ended', playId: state.playId });

test('fim da fila volta ao início e ended atrasado de faixa anterior é ignorado', () => {
  const { state, player, current } = setup(['a', 'b']);
  const firstPlayId = state.playId;
  player.report({ type: 'ended', playId: state.playId });
  assert.equal(current(), 'b');
  player.report({ type: 'ended', playId: firstPlayId });
  assert.equal(current(), 'b');
  player.report({ type: 'ended', playId: state.playId });
  assert.equal(current(), 'a');
});

test('remover a faixa atual toca a seguinte; remover anterior mantém a atual', () => {
  const { state, player, current } = setup(['a', 'b', 'c', 'd']);
  player.commands.play({ index: 2 });
  player.commands.remove({ index: 0 });
  assert.equal(current(), 'c');
  const playId = state.playId;
  player.commands.remove({ index: state.index });
  assert.equal(current(), 'd');
  assert.notEqual(state.playId, playId);
});

test('tocar a seguir move o item para depois da atual', () => {
  const { state, player, current } = setup(['a', 'b', 'c', 'd']);
  player.commands.play({ index: 2 });
  player.commands.playNext({ index: 0 });
  assert.deepEqual(state.queue.map((q) => q.id), ['b', 'c', 'a', 'd']);
  assert.equal(current(), 'c');
});

test('erros em todas as faixas pausam em vez de pular para sempre', () => {
  const { state, player } = setup(['a', 'b']);
  player.report({ type: 'error', playId: state.playId });
  assert.equal(state.paused, false);
  player.report({ type: 'error', playId: state.playId });
  assert.equal(state.paused, true);
});

test('adicionar à fila não interrompe o que está tocando', () => {
  const { state, player, current } = setup(['a', 'b']);
  player.commands.next();
  const playId = state.playId;
  player.load(items('c'), 'append');
  assert.equal(current(), 'b');
  assert.equal(state.playId, playId);
});

test('aleatório 2.0 sorteia pelo peso e não repete as últimas tocadas', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
  const queue = setup(ids, (queueIds) => queueIds.map((id) => (id === 'j' ? 0 : 1)));
  queue.player.commands.smartShuffle({ value: true });
  const played = [queue.current()];
  for (let i = 0; i < 300; i++) {
    end(queue);
    played.push(queue.current());
  }
  assert.ok(!played.includes('j'));
  assert.equal(new Set(played).size, 9);
  played.forEach((id, k) => assert.ok(!played.slice(Math.max(0, k - 5), k).includes(id), `repetiu ${id} na posição ${k}`));
});

test('no aleatório 2.0, voltar refaz o caminho que tocou e tocar a seguir fura o sorteio', () => {
  const queue = setup(['a', 'b', 'c', 'd', 'e', 'f']);
  queue.player.commands.smartShuffle({ value: true });
  end(queue);
  const second = queue.current();
  end(queue);
  queue.player.commands.prev();
  assert.equal(queue.current(), second);
  queue.player.commands.prev();
  assert.equal(queue.current(), 'a');

  queue.player.commands.playNext({ index: queue.state.queue.findIndex((item) => item.id === 'f') });
  end(queue);
  assert.equal(queue.current(), 'f');
});

test('reconhece links do YouTube Music', () => {
  assert.deepEqual(parseLink('https://music.youtube.com/playlist?list=PLabc123def456&si=x'), { list: 'PLabc123def456' });
  assert.deepEqual(parseLink('https://music.youtube.com/watch?v=dQw4w9WgXcQ&si=x'), { video: 'dQw4w9WgXcQ' });
  assert.deepEqual(parseLink('https://youtu.be/dQw4w9WgXcQ'), { video: 'dQw4w9WgXcQ' });
  assert.deepEqual(parseLink('https://www.youtube.com/watch?list=OLAK5uy_abc'), { list: 'OLAK5uy_abc' });
  assert.throws(() => parseLink('https://music.youtube.com/'), /não tem playlist/);
});
