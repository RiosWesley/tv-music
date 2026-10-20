export const initialState = () => ({
  queue: [],
  index: 0,
  playId: 0,
  paused: false,
  volume: 100,
  time: 0,
  duration: 0,
  tv: false,
  smartShuffle: false,
  history: [], // IDs do que tocou antes da atual, para "voltar" e para o aleatório 2.0 não repetir
  upNext: [], // IDs pedidos com "tocar a seguir", que furam o sorteio do aleatório 2.0
});

const HISTORY_SIZE = 100;
const NO_REPEAT = 30;

// Regras da fila. O estado é a fonte da verdade: a TV só reflete. playId muda sempre que uma faixa deve (re)começar.
// weights(ids) devolve o peso de cada música no aleatório 2.0.
export function createPlayer(state, weights) {
  let errorStreak = 0;

  function startTrack(index) {
    if (!state.queue.length) return;
    state.index = (index + state.queue.length) % state.queue.length; // fila em loop
    state.playId++;
    state.time = 0;
    state.duration = state.queue[state.index].duration;
  }

  // Troca de faixa lembrando a atual, para "voltar" refazer o caminho que realmente tocou.
  function moveTo(index) {
    const current = state.queue[state.index];
    if (current) state.history = [...state.history, current.id].slice(-HISTORY_SIZE);
    startTrack(index);
  }

  const indexOf = (id) => state.queue.findIndex((item) => item.id === id);

  // Aleatório 2.0: sorteia pelo peso dos votos, sem repetir as últimas tocadas (até 30, ou metade da fila).
  function draw() {
    const played = [...state.history, state.queue[state.index]?.id];
    const noRepeat = Math.min(NO_REPEAT, Math.floor(state.queue.length / 2));
    const recent = new Set(played.slice(Math.max(0, played.length - noRepeat)));
    const weight = weights(state.queue.map((item) => item.id));
    const candidates = state.queue.map((_, i) => i).filter((i) => !recent.has(state.queue[i].id));
    if (!candidates.length) return state.index + 1; // só IDs repetidos na fila
    let roll = Math.random() * candidates.reduce((sum, i) => sum + weight[i], 0);
    return candidates.find((i) => (roll -= weight[i]) < 0) ?? candidates.at(-1);
  }

  function nextIndex() {
    while (state.upNext.length) {
      const index = indexOf(state.upNext.shift());
      if (index >= 0 && index !== state.index) return index;
    }
    return state.smartShuffle ? draw() : state.index + 1;
  }

  function checkIndex(index) {
    if (!Number.isInteger(index) || index < 0 || index >= state.queue.length) throw new Error('Índice inválido');
    return index;
  }

  function load(items, mode) {
    if (!items.length) throw new Error('Playlist vazia ou privada');
    const wasEmpty = !state.queue.length;
    if (mode === 'append') state.queue.push(...items);
    else state.queue = items;
    if (mode !== 'append' || wasEmpty) {
      state.paused = false;
      startTrack(state.smartShuffle ? draw() : 0);
    }
  }

  const commands = {
    play({ index }) {
      state.paused = false;
      moveTo(checkIndex(index));
    },
    next() {
      state.paused = false;
      moveTo(nextIndex());
    },
    prev() {
      state.paused = false;
      if (state.time > 5) return startTrack(state.index);
      let index = -1;
      while (index < 0 && state.history.length) index = indexOf(state.history.pop());
      startTrack(index >= 0 ? index : state.index - 1);
    },
    pause({ value }) {
      state.paused = Boolean(value);
    },
    seek({ time }) {
      if (!Number.isFinite(time) || time < 0) throw new Error('Tempo inválido');
      state.time = time;
    },
    volume({ value }) {
      if (!Number.isFinite(value)) throw new Error('Volume inválido');
      state.volume = Math.min(100, Math.max(0, Math.round(value)));
    },
    shuffle() {
      const [current] = state.queue.splice(state.index, 1);
      for (let i = state.queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [state.queue[i], state.queue[j]] = [state.queue[j], state.queue[i]];
      }
      if (current) state.queue.unshift(current);
      state.index = 0;
    },
    smartShuffle({ value }) {
      state.smartShuffle = Boolean(value);
    },
    remove({ index }) {
      checkIndex(index);
      if (index === state.index && state.queue.length > 1) moveTo(nextIndex()); // remover a atual pula para a próxima
      state.queue.splice(index, 1);
      if (!state.queue.length) state.index = 0;
      else if (index < state.index) state.index--;
    },
    playNext({ index }) {
      checkIndex(index);
      if (index === state.index) return;
      const [item] = state.queue.splice(index, 1);
      if (index < state.index) state.index--;
      state.queue.splice(state.index + 1, 0, item);
      state.upNext.unshift(item.id);
    },
  };

  // Relatórios da TV. Retorna o evento a transmitir. playId descarta relatórios atrasados de faixas anteriores.
  function report({ type, playId, time, duration, playing }) {
    if (playId !== state.playId) return null;
    if (type === 'progress') {
      state.time = Number(time) || 0;
      state.duration = Number(duration) || state.duration;
      if (playing) errorStreak = 0;
      return 'progress';
    }
    if (type === 'error' && ++errorStreak >= state.queue.length) {
      state.paused = true; // nada da fila toca na TV: para em vez de girar em loop
    } else if (type === 'ended' || type === 'error') {
      moveTo(nextIndex());
    }
    return 'state';
  }

  return { load, commands, report };
}
