export const initialState = () => ({ queue: [], index: 0, playId: 0, paused: false, volume: 100, time: 0, duration: 0, tv: false });

// Regras da fila. O estado é a fonte da verdade: a TV só reflete. playId muda sempre que uma faixa deve (re)começar.
export function createPlayer(state) {
  let errorStreak = 0;

  function startTrack(index) {
    if (!state.queue.length) return;
    state.index = (index + state.queue.length) % state.queue.length; // fila em loop
    state.playId++;
    state.time = 0;
    state.duration = state.queue[state.index].duration;
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
      startTrack(0);
    }
  }

  const commands = {
    play({ index }) {
      state.paused = false;
      startTrack(checkIndex(index));
    },
    next() {
      state.paused = false;
      startTrack(state.index + 1);
    },
    prev() {
      state.paused = false;
      startTrack(state.time > 5 ? state.index : state.index - 1);
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
    remove({ index }) {
      checkIndex(index);
      state.queue.splice(index, 1);
      if (!state.queue.length) state.index = 0;
      else if (index < state.index) state.index--;
      else if (index === state.index) startTrack(state.index); // a seguinte ocupa o lugar e começa a tocar
    },
    playNext({ index }) {
      checkIndex(index);
      if (index === state.index) return;
      const [item] = state.queue.splice(index, 1);
      if (index < state.index) state.index--;
      state.queue.splice(state.index + 1, 0, item);
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
      startTrack(state.index + 1);
    }
    return 'state';
  }

  return { load, commands, report };
}
