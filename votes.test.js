import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVotes } from './votes.js';

test('cada pessoa tem um voto por música, pode trocar ou desfazer, e o nome ignora maiúsculas e espaços', () => {
  const votes = createVotes();
  votes.vote({ name: 'Gabriel Santos', id: 'a', value: 1 });
  votes.vote({ name: '  gabriel   SANTOS ', id: 'a', value: 1 });
  votes.vote({ name: 'Alan', id: 'a', value: 1 });
  assert.deepEqual([votes.tally('a').likes, votes.tally('a').dislikes], [2, 0]);
  votes.vote({ name: 'Gabriel Santos', id: 'a', value: -1 });
  assert.deepEqual([votes.tally('a').likes, votes.tally('a').dislikes], [1, 1]);
  votes.vote({ name: 'Alan', id: 'a', value: 0 });
  assert.deepEqual(votes.tally('a'), { likes: 0, dislikes: 1, voters: { 'gabriel santos': -1 } });
});

test('exige nome e voto válido', () => {
  const votes = createVotes();
  assert.throws(() => votes.vote({ name: '   ', id: 'a', value: 1 }), /Informe seu nome/);
  assert.throws(() => votes.vote({ name: 'Ana', id: 'a', value: 5 }), /Voto inválido/);
});

test('votos sobrevivem a salvar e carregar, inclusive nomes estranhos', () => {
  const votes = createVotes();
  votes.vote({ name: '__proto__', id: 'a', value: 1 });
  votes.vote({ name: 'Ana', id: 'b', value: -1 });
  const restored = createVotes(JSON.parse(JSON.stringify(votes)));
  assert.equal(restored.tally('a').likes, 1);
  assert.equal(restored.tally('b').dislikes, 1);
});
