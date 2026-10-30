// Votos por música (ID do vídeo) e por pessoa: 1 = curtiu, -1 = não curtiu, SUPER = superlike (vale 3 curtidas).
// Ficam fora da fila para sobreviver a recarregar a playlist. Map em vez de objeto para nenhum nome digitado
// colidir com propriedades do JS.
export const SUPER = 3;
const WEEK = 7 * 24 * 3600e3;
const voterKey = (name) => String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

// saved: { songs: {id: {pessoa: voto}}, superlikes: {pessoa: quando usou} }, ou só songs (votes.json antigo).
export function createVotes(saved = {}, now = Date.now) {
  const data = saved.songs ? saved : { songs: saved, superlikes: {} };
  const songs = new Map(Object.entries(data.songs).map(([id, voters]) => [id, new Map(Object.entries(voters))]));
  const superlikes = new Map(Object.entries(data.superlikes));

  function vote({ name, id, value }) {
    const voter = voterKey(name);
    if (!voter) throw new Error('Informe seu nome para votar');
    if (voter.length > 40) throw new Error('Nome grande demais');
    if (![SUPER, 1, -1, 0].includes(value)) throw new Error('Voto inválido');
    const voters = songs.get(id) ?? new Map();
    if (value === SUPER && voters.get(voter) !== SUPER) {
      // Uma vez a cada 7 dias; desfazer não devolve, senão daria para trocar de música à vontade.
      const wait = superlikes.get(voter) + WEEK - now();
      if (superlikes.has(voter) && wait > 0) throw new Error(`Você já usou seu superlike da semana. Libera em ${Math.ceil(wait / 86400e3)} dia(s).`);
      superlikes.set(voter, now());
    }
    if (value) voters.set(voter, value);
    else voters.delete(voter);
    if (voters.size) songs.set(id, voters);
    else songs.delete(id);
  }

  function tally(id) {
    const values = [...(songs.get(id) ?? new Map()).values()];
    return {
      likes: values.filter((v) => v === 1).length,
      dislikes: values.filter((v) => v === -1).length,
      superlikes: values.filter((v) => v === SUPER).length,
      score: values.reduce((sum, v) => sum + v, 0), // saldo: curtidas − não curtidas, superlike vale 3
    };
  }

  // Peso de cada música no aleatório 2.0, pela posição no ranking de saldo da fila:
  // sem saldo = 1; a de maior saldo = 1,5 e as positivas descem até perto de 1 conforme quantas estão acima;
  // espelhado até 0,5 para as negativas. Empates recebem o mesmo peso.
  function weights(ids) {
    const scores = ids.map((id) => tally(id).score);
    const positive = scores.filter((s) => s > 0);
    const negative = scores.filter((s) => s < 0);
    return scores.map((s) => {
      if (s > 0) return 1 + 0.5 * (1 - positive.filter((o) => o > s).length / positive.length);
      if (s < 0) return 1 - 0.5 * (1 - negative.filter((o) => o < s).length / negative.length);
      return 1;
    });
  }

  const toJSON = () => ({
    songs: Object.fromEntries([...songs].map(([id, voters]) => [id, Object.fromEntries(voters)])),
    superlikes: Object.fromEntries(superlikes),
  });

  return { vote, tally, weights, toJSON };
}
