# Screen Share

Aplicacao de compartilhamento de tela com autenticacao, salas persistentes e WebRTC P2P.

Requer Node.js 22.5 ou superior; o SQLite usa o modulo nativo `node:sqlite`, sem `better-sqlite3`.

```powershell
npm install
copy .env.example .env
npm run seed
npm run client:build
npm start
```

Para desenvolvimento, execute apenas `npm run dev`. O script inicia o backend em `http://localhost:3000` e o Vite em `http://localhost:5173`, encerrando os dois processos com `Ctrl+C`.

Teste: `admin@example.com` / `Admin123!`; `host@example.com` / `Host123!`; `viewer@example.com` / `Viewer123!`.
A sala persistente e `daily-dev`.

O administrador vê o botao **Administracao** depois do login e pode listar, criar, promover/rebaixar e excluir usuarios. O backend bloqueia autoexclusao, perda da propria role administrativa e exclusao de proprietarios de salas.

O host inicia a captura pelo botao **Compartilhar tela**. O viewer recebe a oferta WebRTC automaticamente quando entra em uma sala com transmissao ativa. O seletor de qualidade altera `contentHint` entre `detail` e `motion`; a captura usa ate 1440p/60 FPS e os encoders recebem alvo de 5.5 Mbps com preservacao de resolucao.
