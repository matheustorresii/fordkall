# Ford Kall

Call privada de voz e compartilhamento de tela entre amigos, com uma experiência compacta inspirada em ferramentas de voice chat e streaming. O acesso é fechado por contas ativadas com convites de uso único; Supabase protege a autenticação, administração e emissão dos tokens do LiveKit.

## O que já funciona

- login obrigatório e cadastro exclusivamente por convite;
- owner protegido, admins delegáveis, suspensão de contas e auditoria;
- painel para criar, vincular, expirar e revogar convites de uso único;
- perfil sincronizado com a conta e código de sala normalizado;
- links de convite no formato `?room=KIWI-123`, com sala preenchida automaticamente;
- criação de sala rápida com código aleatório curto no formato `ABC-DEFG-HIJ`;
- chamada de voz, câmera e indicador de participante falando;
- galeria responsiva com modos locais `Preencher` (até 4:3) e `Priorizar 16:9`, incluindo três participantes do mesmo tamanho;
- drawer de participantes fechado por padrão e menu contextual no clique ou botão direito;
- volume local de 0% a 400% e mute independente para voz e transmissão;
- deafen local sem perder os volumes individuais;
- perfis de microfone Voz natural, Reduzir ruído e Sem tratamento, com supressão, eco e ganho automático independentes, sem isolamento de voz oculto; escolhas explícitas já salvas são preservadas;
- sensibilidade opcional na thread de áudio (AudioWorklet), com antecipação de 12 ms, histerese e fechamento suave para preservar sílabas; retorno local acompanha o tratamento e as trocas de entrada;
- screen share com vídeo, captura de áudio e proteção anti-retorno quando o navegador oferece suporte;
- volume da transmissão separado do volume do microfone de quem transmite;
- seleção entre múltiplas transmissões simultâneas;
- chat realtime de texto e imagens de até 4 MB durante a call;
- central de jogos sincronizados na sala: Codenames, Coup, Poker, ITO, Exploding Kiwi, Truco Mineiro em duplas e The Mind cooperativo, com busca, categorias e catálogo paginado;
- optout independente nos sete jogos: ficar só assistindo sem sair da call, controle de participantes pelo organizador e confirmação para sair de partidas em andamento; só a própria pessoa pode voltar a participar;
- Coup · Corte Kiwi de 2–6 pessoas, cinco personagens com arte original, blefes, contestações, bloqueios, troca secreta, eliminação e relógio configurável para decisões;
- Poker Texas Hold’em No Limit de 2–6 pessoas, fichas fictícias, blinds e tempo configuráveis, all-in, potes paralelos e showdown;
- ITO com temas escritos pela mesa (sugestões como fallback), espaços na escala de 0 a 100 para posicionar dicas imediatamente, revelação na própria mesa, votação por pessoa, progressão em rodízio e regras configuráveis;
- Picture-in-Picture da transmissão selecionada;
- janela separada, redimensionável e encaixável no desktop para a transmissão selecionada;
- seleção persistente de microfone e webcam, além de saídas separadas para voz/live quando `setSinkId` é suportado;
- presets 720p30, 1080p30 e 1080p60;
- tratamento de autoplay, reconexão, permissão negada e cleanup de tracks;
- layout responsivo para desktop, tablet e celular;
- deploy estático em GitHub Pages por GitHub Actions.
- aplicativo Windows baseado em Electron, com instalador e executável portátil;
- seletor desktop próprio de telas/janelas, captura opcional do áudio do sistema e deep link `fordkall://`;
- bandeja do sistema e modo de fundo que mantém a voz, suspende vídeos e reduz atualizações visuais enquanto o app está minimizado.
- central de configurações por seções, com atalhos opcionais para microfone, deafen, câmera, tela e saída;
- atalhos locais no navegador e globais no aplicativo Windows, inclusive com um jogo em foco;
- atualização do aplicativo instalado por releases do GitHub, com download, instalação e reinício dentro do Ford Kall.

## Stack

- React 19 + TypeScript
- Vite
- `livekit-client`
- CSS próprio
- LiveKit Cloud
- Supabase Auth + Postgres + Edge Functions
- GitHub Pages + GitHub Actions
- Electron + electron-builder (Windows)

## Desenho dos jogos

O Gartic usa um canvas próprio e simples, limitado aos traços da rodada: cores, tamanho do pincel, desfazer e limpar. Não há editor de documentos, formas, texto, imagens, ícones ou arquivos externos. O canvas mantém a proporção em telas diferentes, preserva desenhos ao minimizar e replica os traços pelo LiveKit.

`npm run test:drawing` cobre validação, convergência, desfazer, limpeza, reconexão e envio do último traço. A prévia `?party-preview=gartic` permite verificar quatro clientes sem entrar numa call real.

## Versão 1.1.1

Excalitower removido por completo da central e da call, incluindo o editor, rotas de prévia, sincronização da atividade e dependências específicas. O desenho do Gartic é independente; os outros jogos não mudaram. Arquivos removidos permanecem recuperáveis pelo histórico Git.

## Versão 1.1.0

- Home centrada em salas, conversas e pessoas, com datas nos chats e recuperação de mensagens após suspensão ou falha do Realtime.
- Salas privadas criadas pelo token server; listagem e participação não são expostas nas tabelas públicas. Código/link permite entrar. `touch_call_room` apenas renova uma associação já emitida pelo servidor.
- 20 molduras e 20 fundos de perfil pré-selecionados (Frangoelho, Avatar, Barbie e coleção). IDs validados no cliente e no banco. Artes geradas com o modo integrado `image_gen`, otimizadas em `public/cosmetics`; prompts e origem em `scripts/cosmetic-art.json`. Não é permitido fornecer URL externa de moldura/fundo.
- Câmera substitui o avatar no mesmo tile. Transmissões têm tile separado e escuta manual. Grade/foco são totalmente locais; uma nova live não troca o foco de outras pessoas.
- Gartic Kiwi: clássico, placar em equipes e telefone sem fio por turnos, com canvas compartilhado. Impostor: palavras relacionadas ou papel explícito, palavras privadas e votação iniciada por maioria absoluta. Ambos têm optout.
- Música mantém o iframe entre faixas e após resolver playlists; deafen muda volume sem recriar o player. Minimizar mantém vídeo visível; fechar desconecta somente a escuta local. Autoplay ainda está sujeito às regras reais do navegador/YouTube.
- Ganho local de voz/transmissão até 600% via Web Audio (pode distorcer). Downloads Windows/macOS disponíveis no site.

Pesquisa de modos: [Gartic](https://gartic.io/) e [Gartic Phone](https://garticphone.com/pt). Player: [YouTube IFrame API](https://developers.google.com/youtube/iframe_api_reference).

Testes novos: `npm run test:party`; `npm run test:privacy:live -- --linked` usa e remove somente contas/salas temporárias. `?party-preview=impostor` verifica quatro clientes de protocolo e privacidade; `?design-preview` fornece fixtures de UI sem acessar mensagens reais.

## Requisitos

- Node.js 22 ou mais recente
- npm
- um projeto no [LiveKit Cloud](https://cloud.livekit.io/)
- Chrome ou Edge desktop (recomendados para screen share com áudio)

## Configuração local

Copie o arquivo de exemplo:

```bash
cp .env.example .env.local
```

Preencha somente as configurações públicas do Supabase:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx
```

Nunca adicione uma chave `sb_secret_*`, `service_role` ou credencial do LiveKit ao frontend.

## Backend Supabase

O diretório `supabase/` contém as migrations e Edge Functions. Para publicar em um projeto novo:

```bash
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push
npx supabase config push
npx supabase functions deploy
```

Configure diretamente nos secrets do projeto:

```text
FORDKALL_OWNER_EMAIL
FORDKALL_OWNER_INVITE_HASH
LIVEKIT_URL
LIVEKIT_API_KEY
LIVEKIT_API_SECRET
LIVEKIT_TOKEN_SERVER_ID
```

Depois, configure no LiveKit Cloud um webhook apontando para:

```text
https://<project-ref>.supabase.co/functions/v1/livekit-webhook
```

A função `livekit-token` verifica sessão, status da conta e rate limit antes de emitir uma credencial de sala. Com `LIVEKIT_URL`, `LIVEKIT_API_KEY` e `LIVEKIT_API_SECRET`, ela gera um JWT próprio de validade curta. Enquanto essas credenciais não estiverem configuradas, `LIVEKIT_TOKEN_SERVER_ID` permite usar o Development Token Server atrás da mesma barreira autenticada, sem expor seu ID no frontend.

### Desconectar participantes da call

Somente a conta com papel `owner` ativo pode usar **Desconectar da call** no menu de outro participante (clique/toque ou botão direito). Há confirmação antes de remover. A pessoa removida volta à home com um aviso; sua conta não é suspensa e pode entrar novamente com uma nova credencial.

A ação `disconnect_participant` da função `admin` valida a sessão e o papel no banco, exige que o owner esteja na mesma sala e confere a sessão do alvo (`participantSid`). Usa o backend salvo em `livekit_room_routes`, sem trocar a rota ou dar privilégios administrativos ao token do navegador. A remoção é feita pela API de servidor do LiveKit e registrada em `admin_audit_log`. Rotas sandbox sem credenciais de servidor não oferecem moderação.

`npm run test:moderation` cobre permissões, rotação, sessões antigas e falhas. A prévia visual está em `/?moderation-preview` apenas no desenvolvimento. Para verificar a rejeição de sessões anônimas, falsas e de um member na API publicada, use `npm run test:moderation:live -- --linked` com o CLI autenticado. Esse teste cria e apaga somente um member temporário; não usa a sessão do owner nem desconecta pessoas reais.

### Validação das mensagens diretas

A migration `20261015000000_fix_direct_message_permissions.sql` corrige a autorização de envio sem liberar a leitura de perfis privados. A política anterior consultava o destinatário sob a RLS de `profiles`, que permite ler apenas o próprio perfil, e recusava todas as DMs. Como a correção é no banco, também atende os aplicativos já instalados.

Para validar permissões, histórico offline, respostas e isolamento entre contas, sem persistir dados de teste:

```bash
npx supabase db query --linked --file supabase/tests/direct_messages.sql
```

O teste abaixo é **manual e opt-in**, exige o CLI autenticado no projeto vinculado e verifica a API pública e a entrega realtime de verdade. Cria três contas temporárias e remove suas contas e mensagens ao terminar; não consulta conversas de usuários reais nem imprime chaves. Não deve ser executado automaticamente no CI de um fork.

```bash
npm run test:social:live -- --linked
```

## Rodando localmente

### Coup · Corte Kiwi

Adaptação não oficial das regras clássicas de Coup (Rikki Tahta / La Mame Games, Indie Boards & Cards), sem expansões. As artes são originais; prompts e referências em `src/components/Games/coup-art-prompts.md`. Partidas são apenas recreativas, sem dinheiro real.

O distribuidor eleito mantém o baralho e envia cada mão por pacotes LiveKit direcionados. Snapshots públicos contêm apenas alegações, influências reveladas e moedas. É o mesmo modelo de confiança entre amigos dos outros jogos: o distribuidor conhece o baralho, não é um servidor anti-cheat. Quem sai da sala perde suas influências; se o distribuidor sai, a partida é encerrada sem transferir segredos. Pessoas que entram depois assistem até a próxima partida. Iniciar outro jogo encerra o anterior.

Renda não pode ser contestada ou bloqueada; ajuda externa só permite bloqueio. Alegações de ação e de bloqueio têm janelas separadas. As decisões usam IDs para rejeitar comandos atrasados/duplicados. O tempo padrão para reações é 20s (opcional); provas, perdas e trocas têm ao menos 45s. Não há jogada automática durante o turno normal. Quando uma escolha privada expira, o jogo prova uma carta válida se houver, revela a primeira influência ou mantém as cartas originais na troca.

```bash
npm run test:coup
```

Prévias de desenvolvimento, sem conta/microfone: `?game-preview=coup` (mesa interativa), `?game-preview=hub` (catálogo) e `?game-preview=coup-checks` (seis hooks reais com transporte simulado e partidas completas de 2–6). Essas rotas não existem no build de produção.

```bash
npm install
npm run dev
```

Abra o endereço mostrado pelo Vite, normalmente `http://localhost:5173`.

Para validar o fluxo realtime, abra duas janelas/perfis de navegador, use nomes diferentes e informe o mesmo código de sala. Para compartilhar áudio, prefira uma aba do Chrome/Edge e marque **Compartilhar áudio da guia**.

No Chrome/Edge, a captura solicita `restrictOwnAudio` para evitar que o áudio da própria call volte pela transmissão. Como essa proteção depende do navegador, fones de ouvido continuam sendo a opção mais segura ao compartilhar áudio do sistema.

## Qualidade e franquia do LiveKit

A resolução não é puramente local. Resolução, FPS, câmeras, transmissões simultâneas e número de espectadores aumentam os dados enviados pelo LiveKit. O preset 720p30 é o mais econômico; 1080p30 equilibra nitidez e consumo; 1080p60 deve ficar reservado para conteúdo em movimento.

No plano Build gratuito, os limites são compartilhados pelos projetos gratuitos da conta e funcionam como hard cap: ao atingir a franquia, novas solicitações falham em vez de gerar cobrança automática. Consulte [quotas e limites](https://docs.livekit.io/deploy/admin/quotas-and-limits/) e o [guia oficial de estimativa](https://livekit.io/field-guides/guide/estimating-pricing-video-conference-livestream).

## Validação e build

```bash
npm run typecheck
npm run build
npm run preview
```

O build estático é gerado em `dist/`.

### Regressões dos jogos

Com `npm run dev`, abra `/?game-preview=kiwi` (ou `ito`, `mind`, `truco`, `poker`, `hub`) para exercitar os componentes reais com cenários visuais determinísticos, sem precisar de conta ou usar a franquia do LiveKit. O menu de desenvolvimento troca o número de jogadores, a fase e as escolhas privadas. Esses cenários não fazem parte do build de produção.

Em `/?game-preview=checks`, execute as verificações de integração do Kiwi: dois clientes reais do hook conversam por um transporte confiável em memória. Os testes cobrem privacidade e repetição do futuro, revisão de pacotes privados, reordenação do monte, Favor, regras de alvo, combos e distribuição inicial de defesas. Eles não substituem uma partida real pelo LiveKit.

Para o ITO, `npm run test:ito` valida maioria, distribuição e progressão de 2–8 pessoas até a meta de 2–5 cartas. Em `/?game-preview=ito-checks`, cinco clientes reais do hook validam votos por pessoa, invalidação de votos quando a ordem muda, privacidade entre rodadas e as três consequências de derrota. A regra padrão mantém as mãos após perder; a vitória adiciona uma única carta, em rodízio, até a equipe vencer com duas por pessoa. Essa é uma variante configurável, não uma implementação declarada de todas as regras oficiais do ITO.

O ITO usa o protocolo `ford-kall.ito.v2`; todos os participantes precisam estar na versão atualizada para compartilhar a mesma mesa.

### Poker

`npm run test:poker` valida o motor puro: ranking das mãos, heads-up, posição dos blinds, mínimo de aumento, reabertura após all-ins curtos, side pots, empate, fichas ímpares, apostas não cobertas e saídas. Verifica a distribuição das 2.598.960 combinações de cinco cartas, cem partidas de várias mãos e mil mãos aleatórias de 2–6 pessoas com conservação das fichas, ausência de cartas duplicadas e imutabilidade do estado anterior. `npm run test:games` executa também os testes do ITO.

Em `/?game-preview=poker-checks`, seis instâncias reais do hook testam mesas de 2–6 assentos por transporte confiável em memória, cartas privadas, comandos atrasados, showdown, reconexão e encerramento após saída do controlador. Isso não substitui um teste com usuários pelo LiveKit.

O showdown é uma sequência controlada pela mesa: abre as mãos elegíveis, depois flop, turn e river em etapas, e só então calcula e distribui os potes. O estado público de cada etapa não inclui cartas futuras nem resultados antecipados. A próxima mão começa após sete segundos, preservando fichas e partida. O pagamento visual envia várias pilhas do pote a cada vencedor e só depois anima o saldo, inclusive nos side pots. Quando só resta uma pessoa conectada com fichas, o resultado final permanece e uma nova partida exige confirmação explícita. A tabela de combinações e a última mão continuam acessíveis durante o jogo. As animações usam apenas deltas públicos, respeitam movimento reduzido e não mantêm loops quando a mesa está parada.

As regras de referência são [Texas Hold’em da PokerStars](https://www.pokerstars.com/poker/games/texas-holdem/) e [Poker TDA](https://www.pokertda.com/view-poker-tda-rules/), sem usar marca ou artes dessas organizações. O modo implementado usa fichas sem valor real, blinds fixos e não tem rake, dinheiro, compras, saque, torneios ou persistência de saldo. Quem entra depois do início pode assistir. A mesa reinicia com quem está na call ao iniciar uma nova partida.

O controlador mantém o baralho em memória e envia as duas cartas privadas somente ao respectivo jogador; o estado público não carrega baralho ou mãos escondidas. Cada mão tem um identificador novo para descartar ações e cartas antigas. Não é uma arquitetura antitrapaça para apostas reais: o controlador é um cliente confiável e, se sair ou recarregar, a mesa é encerrada, sem tentar reconstruir cartas secretas. O protocolo é `ford-kall.poker.v1`; todos precisam usar uma versão que o suporte.

O baralho usa quatro cores: espadas escuro, copas vermelho, ouros azul e paus verde, mantendo os símbolos. A tabela ilustra os grupos de cada combinação e os kickers. Quem zerou pode recomprar o stack inicial fictício, sem top-up de saldo positivo ou recarga no meio do próprio all-in; quem já está fora da mão pode recomprar para a próxima. A recompra não altera o pote nem os saldos dos outros. Após o fim da partida, `Continuar mesa` retoma explicitamente os saldos após uma recompra, enquanto `Nova partida` reinicia as fichas. As recompras ficam contadas na sessão e o limite total da mesa é de 600.000 fichas fictícias.

## Aplicativo Windows

Para testar o Electron durante o desenvolvimento:

```bash
npm run desktop:dev
```

Para gerar o instalador assistido e o executável portátil de Windows x64:

```bash
npm run desktop:dist:windows
```

Os artefatos são gerados em `release/`:

- `Ford-Kall-Setup-<versão>-x64.exe`: instalador com atalhos no Desktop e menu Iniciar;
- `Ford-Kall-Portable-<versão>-x64.exe`: versão que roda sem instalação.

O aplicativo carrega o frontend empacotado localmente e continua usando o LiveKit Cloud para a call. Ao fechar a janela durante uma call, ele permanece na bandeja do Windows; **Sair do Ford Kall** no menu do ícone encerra de fato o processo. Quando minimizado ou oculto, publicações remotas de vídeo são suspensas e restauradas ao abrir a janela, reduzindo uso de GPU e banda sem interromper a voz.

Todos os atalhos começam vazios e são configurados em **Configurações → Atalhos**. No app instalado eles são globais; no navegador funcionam apenas com a página em foco. O botão **Checar update** fica em **Configurações → Aplicativo** e está disponível somente na versão Setup. A versão portátil continua sendo atualizada substituindo o executável manualmente.

O workflow [`.github/workflows/windows.yml`](.github/workflows/windows.yml) gera os executáveis e os metadados do updater ao enviar uma tag `v*`. Em seguida, [`.github/workflows/macos.yml`](.github/workflows/macos.yml) publica um DMG e um ZIP universal, compatíveis com Macs Intel e Apple Silicon. O app macOS ainda não tem assinatura Developer ID nem notarização Apple, então o Gatekeeper pode exigir autorização manual na primeira abertura. A atualização automática continua disponível somente no instalador Windows.

## Deploy no GitHub Pages

O workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) executa em todo push para `main`:

```text
npm ci → npm run build → upload-pages-artifact → deploy-pages
```

Antes do primeiro deploy:

1. Em **Settings → Pages**, selecione **GitHub Actions** como Source.
2. Defina no build `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` (ambos são públicos).
3. Confirme o domínio customizado `fordkall.11a3.dev` em **Settings → Pages**.

O arquivo `public/CNAME` preserva o domínio customizado no artefato. A aplicação é uma SPA sem rotas reais e usa assets relativos para funcionar tanto no domínio quanto dentro do protocolo local seguro do Electron.

## Música da sala

O player usa a API oficial de iframe do YouTube, sem bot de extração de áudio, chave de Data API ou servidor adicional. Aceita links de vídeo, playlists públicas, álbuns/links públicos do YouTube Music e timestamps. Em links de música com rádio automático, o padrão é adicionar só a faixa; a interface também permite escolher a playlist inteira.

- **Reprodução compartilhada:** play/pause, anterior/próxima, posição, repetição e fila valem para todos. Nenhum controle depende do iframe local estar carregado.
- **Escuta individual:** **Desconectar** remove o iframe e interrompe o áudio/banda somente daquele dispositivo. Essa preferência é lembrada; novas músicas não a desfazem. Volume e deafen também são locais.
- **Playlist única:** a primeira resolução válida congela a ordem dos IDs para a sala. Depois, cada iframe carrega um vídeo individual, sem o autoplay nativo da playlist. A fila aceita 20 links e até 200 faixas resolvidas; recortes de playlists maiores aparecem explicitamente na interface.
- **Sincronização:** protocolo `ford-kall.music.v3` sobre os dados do LiveKit, eleição de coordenador, relógios estimados por ping/pong e um ouvinte responsável pelo progresso. Há passagem de responsabilidade quando ele sai, desconecta a escuta ou para de reproduzir. Um evento de fim antigo não avança outra faixa. Se ninguém reproduz, o relógio espera.
- **Entrada/reconexão:** recebe a fila e o ponto atual. A saída de quem coordena não apaga a fila enquanto alguém permanece na sala. Os participantes precisam estar na versão nova; o protocolo v2 anterior não é compatível.
- **Interface:** fila ao lado do player no desktop e layout vertical no celular. Minimizar preserva um vídeo visível. Ao navegar para a home durante uma call, ele continua como mini-player, com botão para parar de ouvir.

O navegador ainda pode exigir **Liberar áudio neste dispositivo** na primeira vez. Conteúdo privado, bloqueado para incorporação, restrito por conta/região ou indisponível não é contornado; um link do YouTube Music não remove essas restrições. Anúncios e limitações do próprio YouTube podem afetar o alinhamento entre usuários. Não é reprodução de áudio pelo SFU nem sincronismo de amostra: cada participante usa seu próprio player oficial. Veja [eventos de autoplay/erros](https://developers.google.com/youtube/iframe_api_reference) e [requisitos do player](https://developers.google.com/youtube/terms/required-minimum-functionality).

Validação local:

```bash
npm run test:music
# Prévia isolada sem conta, convite ou sala real:
npm run dev
# /?music-preview=mock → dois participantes e iframe simulado
# /?music-preview=real → API/iframe real do YouTube
```

As prévias só existem no modo de desenvolvimento. A suíte cobre o protocolo em seis clientes com latência/relógios diferentes, troca de coordenador, reconexão, fim atrasado, fila canônica, escuta desligada e ciclo de vida do iframe. Os três pipelines (web, Windows e macOS) executam essa suíte antes de publicar.

## Limitações conhecidas da V1

- o código da sala identifica uma room, enquanto a autorização é determinada pela conta e pela Edge Function;
- chat e imagens são entregues somente aos participantes conectados naquele momento e não possuem histórico persistente;
- captura de áudio do desktop/tela depende do sistema operacional e do navegador;
- `restrictOwnAudio` é uma proteção de melhor esforço disponível principalmente em navegadores Chromium;
- conteúdo protegido por DRM pode bloquear vídeo ou áudio e não é contornado;
- Safari e Firefox podem não permitir seleção de saída ou captura de áudio do screen share.
- transmissão da própria tela no celular depende de `getDisplayMedia`; quando o navegador não oferece a API, a interface informa a limitação sem bloquear câmera ou reprodução.
- Picture-in-Picture depende do suporte do navegador.
- ganho acima de 100% (até 600%) usa o mixer Web Audio local e pode causar clipping ou distorção; ele não aumenta o consumo do LiveKit.
- a janela separada depende da permissão de pop-ups do navegador.
- em celulares, a call pode continuar por algum tempo com o navegador minimizado e expõe metadados ao sistema quando suportado, mas uma página web pode ser suspensa pelo sistema; ouvir de forma confiável com o site fechado exige um aplicativo nativo com modo de áudio em segundo plano.
