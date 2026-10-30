import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVotes, SUPER } from './votes.js';

test('cada pessoa tem um voto por música, pode trocar ou desfazer, e o nome ignora maiúsculas e espaços', () => {
  const votes = createVotes();
  votes.vote({ name: 'Gabriel Santos', id: 'a', value: 1 });
  votes.vote({ name: '  gabriel   SANTOS ', id: 'a', value: 1 });
  votes.vote({ name: 'Alan', id: 'a', value: 1 });
  assert.deepEqual([votes.tally('a').likes, votes.tally('a').dislikes], [2, 0]);
  votes.vote({ name: 'Gabriel Santos', id: 'a', value: -1 });
  assert.deepEqual([votes.tally('a').likes, votes.tally('a').dislikes], [1, 1]);
  votes.vote({ name: 'Alan', id: 'a', value: 0 });
  assert.deepEqual(votes.tally('a'), { likes: 0, dislikes: 1, superlikes: 0, score: -1 });
  assert.deepEqual(votes.toJSON().songs, { a: { 'gabriel santos': -1 } });
});

test('superlike vale 5 curtidas e só pode ser usado uma vez a cada 7 dias, mesmo desfazendo', () => {
  let time = 0;
  const day = 24 * 3600e3;
  const votes = createVotes({}, () => time);
  votes.vote({ name: 'Ana', id: 'a', value: SUPER });
  votes.vote({ name: 'Bia', id: 'a', value: -1 });
  assert.equal(votes.tally('a').score, 4);
  votes.vote({ name: 'Ana', id: 'a', value: 0 });
  time = 6 * day;
  assert.throws(() => votes.vote({ name: 'ana', id: 'b', value: SUPER }), /Libera em 1 dia/);
  time = 7 * day;
  votes.vote({ name: 'Ana', id: 'b', value: SUPER });
  assert.equal(votes.tally('b').superlikes, 1);
});

test('exige nome e voto válido', () => {
  const votes = createVotes();
  assert.throws(() => votes.vote({ name: '   ', id: 'a', value: 1 }), /Informe seu nome/);
  assert.throws(() => votes.vote({ name: 'Ana', id: 'a', value: 7 }), /Voto inválido/);
});

test('peso do aleatório 2.0 segue o ranking de saldo: 1,5 no topo, 1 sem votos, 0,5 no fundo', () => {
  const votes = createVotes();
  const like = (id, n) => Array.from({ length: n }, (_, i) => votes.vote({ name: `p${i}`, id, value: 1 }));
  const dislike = (id, n) => Array.from({ length: n }, (_, i) => votes.vote({ name: `p${i}`, id, value: -1 }));
  like('top', 3);
  like('dois', 2);
  like('um', 1);
  like('empate', 1);
  dislike('ruim', 1);
  dislike('pior', 3);
  votes.vote({ name: 'outra', id: 'pior', value: 1 }); // 1 curtida e 3 não curtidas: saldo -2
  assert.deepEqual(
    votes.weights(['top', 'dois', 'um', 'empate', 'neutra', 'ruim', 'pior']),
    [1.5, 1.375, 1.25, 1.25, 1, 0.75, 0.5],
  );
});

test('votos sobrevivem a salvar e carregar, inclusive nomes estranhos', () => {
  const votes = createVotes();
  votes.vote({ name: '__proto__', id: 'a', value: 1 });
  votes.vote({ name: 'Ana', id: 'b', value: -1 });
  votes.vote({ name: 'Ana', id: 'c', value: SUPER });
  const restored = createVotes(JSON.parse(JSON.stringify(votes)));
  assert.equal(restored.tally('a').likes, 1);
  assert.equal(restored.tally('b').dislikes, 1);
  assert.throws(() => restored.vote({ name: 'Ana', id: 'a', value: SUPER }), /superlike/);
  assert.equal(createVotes({ a: { ana: 1 } }).tally('a').likes, 1); // votes.json da versão anterior
  assert.equal(createVotes({ songs: { a: { ana: 3 } }, superlikes: {} }).tally('a').score, SUPER); // superlike antigo, de 3
});
