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
  upNext: [], // aleatório 2.0: IDs que vão tocar, em ordem (os de "tocar a seguir" na frente, depois os já sorteados)
});

const HISTORY_SIZE = 100;
const NO_REPEAT = 30;
const UPCOMING = 10;

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
    refill();
  }

  // Troca de faixa lembrando a atual, para "voltar" refazer o caminho que realmente tocou.
  function moveTo(index) {
    const current = state.queue[state.index];
    if (current) state.history = [...state.history, current.id].slice(-HISTORY_SIZE);
    startTrack(index);
  }

  const indexOf = (id) => state.queue.findIndex((item) => item.id === id);

  // Aleatório 2.0: sorteia pelo peso dos votos, sem repetir nenhuma das últimas tocadas ou já sorteadas
  // (até 30, ou metade da fila). -1 quando não há candidata (fila vazia ou só com IDs repetidos).
  function draw() {
    const planned = [...state.history, state.queue[state.index]?.id, ...state.upNext];
    const noRepeat = Math.min(NO_REPEAT, Math.floor(state.queue.length / 2));
    const recent = new Set(planned.slice(Math.max(0, planned.length - noRepeat)));
    const weight = weights(state.queue.map((item) => item.id));
    const candidates = state.queue.map((_, i) => i).filter((i) => !recent.has(state.queue[i].id));
    if (!candidates.length) return -1;
    let roll = Math.random() * candidates.reduce((sum, i) => sum + weight[i], 0);
    return candidates.find((i) => (roll -= weight[i]) < 0) ?? candidates.at(-1);
  }

  // Aleatório 2.0: deixa as próximas sorteadas com antecedência, para a fila mostrar o que vai tocar de verdade.
  function refill() {
    if (!state.smartShuffle) return;
    const current = state.queue[state.index]?.id;
    state.upNext = state.upNext.filter((id) => id !== current && indexOf(id) >= 0);
    while (state.upNext.length < UPCOMING) {
      const index = draw();
      if (index < 0) break;
      state.upNext.push(state.queue[index].id);
    }
  }

  function nextIndex() {
    if (!state.smartShuffle) return state.index + 1;
    refill();
    const id = state.upNext.shift();
    return id === undefined ? state.index + 1 : indexOf(id);
  }

  // Índices das próximas músicas, na ordem em que vão tocar.
  function upcoming() {
    if (state.smartShuffle) return state.upNext.map(indexOf).filter((i) => i >= 0);
    const count = Math.max(0, Math.min(UPCOMING, state.queue.length - 1));
    return Array.from({ length: count }, (_, k) => (state.index + 1 + k) % state.queue.length);
  }

  function checkIndex(index) {
    if (!Number.isInteger(index) || index < 0 || index >= state.queue.length) throw new Error('Índice inválido');
    return index;
  }

  function load(items, mode) {
    if (!items.length) throw new Error('Playlist vazia ou privada');
    const wasEmpty = !state.queue.length;
    if (mode === 'append') {
      state.queue.push(...items);
    } else {
      state.queue = items;
      state.upNext = [];
    }
    if (mode !== 'append' || wasEmpty) {
      state.paused = false;
      startTrack(state.smartShuffle ? nextIndex() : 0);
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
      const current = state.queue[state.index];
      let index = -1;
      while (index < 0 && state.history.length) index = indexOf(state.history.pop());
      if (state.smartShuffle && current) state.upNext.unshift(current.id); // "próxima" volta para onde estava
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
      state.upNext = [];
      refill();
    },
    remove({ index }) {
      checkIndex(index);
      if (index === state.index && state.queue.length > 1) moveTo(nextIndex()); // remover a atual pula para a próxima
      state.queue.splice(index, 1);
      if (!state.queue.length) state.index = 0;
      else if (index < state.index) state.index--;
      refill(); // se era uma das sorteadas, sorteia outra no lugar
    },
    playNext({ index }) {
      checkIndex(index);
      if (index === state.index) return;
      const [item] = state.queue.splice(index, 1);
      if (index < state.index) state.index--;
      state.queue.splice(state.index + 1, 0, item);
      if (state.smartShuffle) state.upNext = [item.id, ...state.upNext.filter((id) => id !== item.id)];
    },
  };

  refill(); // estado salvo por uma versão sem as próximas sorteadas

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

  return { load, commands, report, upcoming };
}
