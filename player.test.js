import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlayer, initialState } from './player.js';
import { parseLink } from './youtube.js';

const items = (...ids) => ids.map((id) => ({ id, title: id, artist: '', duration: 100 }));

function setup(ids, weights = (queueIds) => queueIds.map(() => 1)) {
  const state = initialState();
  const player = createPlayer(state, weights);
  player.sync(items(...ids));
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

test('reordenar as próximas, com e sem o aleatório 2.0', () => {
  const { state, player } = setup(['a', 'b', 'c', 'd', 'e']);
  const next = () => player.upcoming().map((i) => state.queue[i].id);
  player.commands.play({ index: 3 });
  player.commands.moveUpcoming({ from: 0, to: 2 }); // próximas eram e, a, b, c (fila em loop)
  assert.deepEqual(next(), ['a', 'b', 'e', 'c']);
  assert.equal(state.queue[state.index].id, 'd');
  assert.throws(() => player.commands.moveUpcoming({ from: 0, to: 4 }), /Posição inválida/);

  player.commands.smartShuffle({ value: true });
  const before = next();
  player.commands.moveUpcoming({ from: before.length - 1, to: 0 });
  assert.deepEqual(next(), [before.at(-1), ...before.slice(0, -1)]);
});

test('erros em todas as faixas pausam em vez de pular para sempre', () => {
  const { state, player } = setup(['a', 'b']);
  player.report({ type: 'error', playId: state.playId });
  assert.equal(state.paused, false);
  player.report({ type: 'error', playId: state.playId });
  assert.equal(state.paused, true);
});

test('atualizar a playlist mantém a atual tocando e o histórico, e junta duplicadas', () => {
  const { state, player, current } = setup(['a', 'b', 'c']);
  player.commands.next();
  const playId = state.playId;
  player.sync(items('c', 'b', 'd', 'd'));
  assert.equal(current(), 'b');
  assert.equal(state.playId, playId);
  assert.deepEqual(state.queue.map((q) => q.id), ['c', 'b', 'd']);
  assert.deepEqual(state.history, ['a']);
  player.sync(items('c', 'd')); // a atual saiu da playlist: começa outra
  assert.notEqual(state.playId, playId);
});

test('atualizar a playlist no aleatório 2.0 mantém as próximas sorteadas, tirando só as removidas', () => {
  const ids = Array.from({ length: 40 }, (_, i) => `s${i}`);
  const { state, player } = setup(ids);
  player.commands.smartShuffle({ value: true });
  const [removed, ...kept] = state.upNext;
  player.sync(items(...ids.filter((id) => id !== removed), 'nova'));
  assert.deepEqual(state.upNext.slice(0, kept.length), kept);
  assert.equal(state.upNext.length, 10);
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

test('aleatório 2.0 deixa as próximas 10 sorteadas, toca nessa ordem e repõe as que saem', () => {
  const ids = Array.from({ length: 40 }, (_, i) => `s${i}`);
  const queue = setup(ids);
  const upcomingIds = () => queue.player.upcoming().map((i) => queue.state.queue[i].id);
  queue.player.commands.smartShuffle({ value: true });
  const before = upcomingIds();
  assert.equal(new Set(before).size, 10);
  end(queue);
  assert.equal(queue.current(), before[0]);
  assert.deepEqual(upcomingIds().slice(0, 9), before.slice(1));
  assert.equal(upcomingIds().length, 10);

  const removed = upcomingIds()[2];
  queue.player.commands.remove({ index: queue.state.queue.findIndex((item) => item.id === removed) });
  assert.ok(!upcomingIds().includes(removed));
  assert.equal(upcomingIds().length, 10);

  queue.player.commands.smartShuffle({ value: false });
  assert.deepEqual(queue.player.upcoming(), Array.from({ length: 10 }, (_, k) => (queue.state.index + 1 + k) % 39));
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
