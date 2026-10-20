# TV Music

Toca playlists do YouTube Music na TV LG (webOS) com a fila inteira, controlada pelo celular.

- `server.js`: roda no PC, guarda a fila (em `state.json`, sobrevive a reinícios) e abre o app na TV.
- `/` é o controle do celular, `/tv` é o player que a TV abre.
- `webos/` é o app da TV. Ele recebe o endereço do PC ao ser aberto e guarda para as próximas vezes.

## Uso

1. Ligue a TV.
2. No PC, dê dois cliques em **`iniciar.bat`**.

O servidor acha a TV na rede, descobre o IP atual do PC e abre o app na TV já apontando para ele. A janela mostra os endereços:

- `http://<ip-do-pc>:8080` é o controle completo (fila, pular, volume).
- `http://<ip-do-pc>:8080/ouvinte` é para quem só quer ver o que está tocando e curtir ou não curtir. Pede um nome antes de votar; cada nome tem um voto por música, e os votos ficam em `votes.json`.

**Aleatório 2.0** (botão ao lado do volume): a cada música, sorteia a próxima dando mais chance às mais curtidas. Peso 1 para quem não tem votos, até 1,5 para a de maior saldo (curtidas − não curtidas) e até 0,5 para a de pior saldo. Não repete as últimas 30 tocadas (ou metade da fila, se for menor). "Tocar a seguir" fura o sorteio, e "voltar" volta para a que tocou antes de verdade.

Se a TV estava desligada, ligue-a e toque em **Abrir na TV** no celular. Abrir o app pelo controle remoto também funciona, enquanto o IP do PC não mudar.

Para iniciar junto com o Windows: `Win+R` → `shell:startup` → crie ali um atalho para o `iniciar.bat`.

Dica: reservar um IP fixo para o PC no roteador evita que o endereço do celular mude.

## Primeira vez num PC novo

1. Instale o Node.js 22 ou mais novo.
2. Rode o `iniciar.bat` (ele instala as dependências).
3. Permita o Node no firewall do Windows quando ele pedir.
4. Aceite o pedido de conexão que aparece na TV (só na primeira vez de cada PC).
5. Copie o `.env` do PC antigo para manter a renovação do modo desenvolvedor (veja abaixo).

## Instalar o app numa TV (uma vez)

1. Crie uma conta gratuita em https://webostv.developer.lge.com.
2. Na TV, instale o app **Developer Mode** pela LG Content Store, entre com a conta, ligue **Dev Mode Status** (a TV reinicia) e depois ligue **Key Server**.
3. No PC, dentro desta pasta, troque o IP pelo da TV:

```bash
npm install
npx ares-setup-device -a tv -i "username=prisoner" -i "host=192.168.25.113" -i "port=9922"
npx ares-novacom --device tv --getkey
npx ares-setup-device -m tv -i "passphrase=<passphrase da TV>"
npm run tv:package
npm run tv:install
```

A passphrase aparece no app Developer Mode. O `ares-install` às vezes falha com `ipk verified failed`; rode de novo.

## Renovação do modo desenvolvedor

A LG desliga o modo desenvolvedor depois de um tempo (cerca de 1000h nessa TV) e apaga o app. O servidor renova sozinho a cada 12h se houver um `.env` com o token:

```bash
npx ares-novacom --device tv --run "cat /var/luna/preferences/devmode_enabled"
```

Grave a última linha da saída no `.env` como `LG_DEVMODE_TOKEN=<token>`.

## Controle remoto da TV

OK = tocar/pausar, ◀ ▶ = anterior/próxima. Os botões ⏯ ⏪ ⏩ também funcionam.

## Limitações

- O player é o embed oficial do YouTube: pode ter anúncios (sem login Premium) e faixas com incorporação bloqueada são puladas automaticamente (o motivo aparece no log do servidor).
- O YouTube recusa músicas de gravadora (erro 150) quando a página do player é aberta por IP. Por isso o servidor redireciona `/tv` para `<ip>.nip.io`, um DNS público que devolve o próprio IP. Se o nip.io sair do ar, a TV não abre o player.
- Playlists privadas, como "Músicas curtidas", não carregam porque não há login. Deixe a playlist como "Não listada" e use o link.
- A fila repete do início quando chega ao fim.
