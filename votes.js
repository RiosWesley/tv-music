// Votos por música (ID do vídeo) e por pessoa: 1 = curtiu, -1 = não curtiu. Ficam fora da fila para sobreviver
// a recarregar a playlist. Map em vez de objeto para nenhum nome digitado colidir com propriedades do JS.
const voterKey = (name) => String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

export function createVotes(saved = {}) {
  const songs = new Map(Object.entries(saved).map(([id, voters]) => [id, new Map(Object.entries(voters))]));

  function vote({ name, id, value }) {
    const voter = voterKey(name);
    if (!voter) throw new Error('Informe seu nome para votar');
    if (voter.length > 40) throw new Error('Nome grande demais');
    if (![1, -1, 0].includes(value)) throw new Error('Voto inválido');
    const voters = songs.get(id) ?? new Map();
    if (value) voters.set(voter, value);
    else voters.delete(voter);
    if (voters.size) songs.set(id, voters);
    else songs.delete(id);
  }

  function tally(id) {
    const voters = songs.get(id) ?? new Map();
    const values = [...voters.values()];
    return {
      likes: values.filter((v) => v === 1).length,
      dislikes: values.filter((v) => v === -1).length,
      voters: Object.fromEntries(voters),
    };
  }

  const toJSON = () => Object.fromEntries([...songs].map(([id, voters]) => [id, Object.fromEntries(voters)]));

  return { vote, tally, toJSON };
}
