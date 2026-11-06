# Relatório: conexão da interface React com a API

Data da verificação: 08/10/2026

## Diagnóstico

A interface React chama caminhos relativos como `/api/session`. Durante o desenvolvimento, o Vite encaminha essas chamadas para `http://localhost:3001`, conforme `client/vite.config.js`. A API usada pelo React é o servidor Express em `server/src/index.js`; ela é separada da API Flask em `python/app.py`.

Na primeira verificação, nada respondia na porta 3001. Depois de iniciar a API Express, `/api/session` respondeu, mas `/api/dashboard` retornou HTTP 500. O servidor React não tinha `server/.env` e, sem esse arquivo, tentava conectar ao MySQL com a senha vazia definida como padrão. A configuração existente do Flask usa a mesma base `escola_segura`, mas tem credenciais próprias.

## Correção aplicada e verificada

Criei `server/.env` local com a configuração de banco já usada pelo projeto Flask. Esse arquivo está listado no `.gitignore`, então não será incluído em commits. Reiniciei a API para carregar as configurações e confirmei:

- `GET http://localhost:3001/api/session` responde;
- login local seguido de `GET /api/dashboard` responde com HTTP 200;
- a consulta ao banco funciona e retornou zero alunos cadastrados;
- Vite entrega a interface em `http://localhost:5173/` e o proxy `/api` encaminha login e dashboard corretamente.

Assim, o bloqueio confirmado era a API React parada e a configuração de banco ausente no servidor Express. A configuração local foi corrigida.

## Como iniciar

No VS Code, inicie **React: iniciar API** e **React: iniciar interface**. A interface deve ser aberta pela URL do Vite, normalmente `http://localhost:5173`. Também é possível executar, em dois terminais dentro de `react`, `npm run dev:server` e `npm run dev:client`.

Se a tela ainda disser que a API está indisponível, confira se ambos os processos continuam ativos e se a API está na porta 3001. O servidor Flask/Python não substitui o servidor Express esperado pelo proxy React.

## Observação adicional

O primeiro início do Vite foi bloqueado pelo sandbox (`spawn EPERM`). Com a permissão de execução fora dele, o Vite iniciou e a interface e o proxy foram verificados com sucesso.

Também encontrei marcadores de conflito Git (`<<<<<<<`, `=======`, `>>>>>>>`) no `README.md` da raiz. Eles prejudicam a leitura das instruções, mas não são usados pelo servidor e não explicam a falha HTTP observada.
