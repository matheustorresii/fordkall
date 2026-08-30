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
- supressão de ruído WebRTC opcional para o microfone;
- screen share com vídeo, captura de áudio e proteção anti-retorno quando o navegador oferece suporte;
- volume da transmissão separado do volume do microfone de quem transmite;
- seleção entre múltiplas transmissões simultâneas;
- chat realtime de texto e imagens de até 4 MB durante a call;
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

## Rodando localmente

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

O workflow [`.github/workflows/windows.yml`](.github/workflows/windows.yml) gera os executáveis e os metadados do updater manualmente ou ao enviar uma tag `v*`. Builds sem certificado funcionam normalmente, mas o Windows SmartScreen pode mostrar o aviso de editor desconhecido; assinatura de código elimina esse aviso em releases futuras.

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

## Limitações conhecidas da V1

- o código da sala identifica uma room, enquanto a autorização é determinada pela conta e pela Edge Function;
- chat e imagens são entregues somente aos participantes conectados naquele momento e não possuem histórico persistente;
- captura de áudio do desktop/tela depende do sistema operacional e do navegador;
- `restrictOwnAudio` é uma proteção de melhor esforço disponível principalmente em navegadores Chromium;
- conteúdo protegido por DRM pode bloquear vídeo ou áudio e não é contornado;
- Safari e Firefox podem não permitir seleção de saída ou captura de áudio do screen share.
- transmissão da própria tela no celular depende de `getDisplayMedia`; quando o navegador não oferece a API, a interface informa a limitação sem bloquear câmera ou reprodução.
- Picture-in-Picture depende do suporte do navegador.
- ganho acima de 100% (até 400%) usa o mixer Web Audio local e pode causar clipping ou distorção; ele não aumenta o consumo do LiveKit.
- a janela separada depende da permissão de pop-ups do navegador.
- em celulares, a call pode continuar por algum tempo com o navegador minimizado e expõe metadados ao sistema quando suportado, mas uma página web pode ser suspensa pelo sistema; ouvir de forma confiável com o site fechado exige um aplicativo nativo com modo de áudio em segundo plano.
