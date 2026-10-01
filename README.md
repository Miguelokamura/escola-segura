<<<<<<< HEAD
# EscolaSegura

O projeto está separado em duas aplicações independentes:

- `python/`: versão original em Flask/Python.
- `react/`: versão React + JavaScript descrita abaixo.

# React + JavaScript

Esta migração mantém as funcionalidades do projeto Flask em uma arquitetura JavaScript: React/Vite no cliente e Express/MySQL no servidor. Os arquivos Python originais foram preservados.

## Executar

1. Entre na pasta `react`: `cd react`.
2. Copie `server/.env.example` para `server/.env` e preencha a senha do MySQL.
3. Use `server/database.sql` para criar o banco.
4. Instale as dependências: `npm install`.
5. Em terminais separados, execute `npm run dev:server` e `npm run dev:client`.
5. Acesse a URL mostrada pelo Vite (normalmente `http://localhost:5173`).

O proxy do Vite encaminha automaticamente chamadas `/api` para a API em `http://localhost:3001`.

## Iniciar pela IDE

No VS Code, execute **Terminal → Run Task** e escolha as tarefas criadas para Python ou React. Para React, inicie primeiro **React: iniciar API** e depois **React: iniciar interface**. Abra a URL exibida pelo Vite (em geral `http://localhost:5173`).

A versão Flask pode ser aberta em `http://localhost:5000` após executar **Python: iniciar Flask**.

## App para celular (Expo)

O app Expo está em `react/mobile`. Edite `react/mobile/src/config.js` com o IP local do computador que está executando a API. Com celular e computador na mesma rede Wi-Fi, execute:

```bash
cd react/mobile
npm start -- --clear
```

Abra o Expo Go no celular e leia o QR Code exibido. A tarefa **React: iniciar API** deve continuar em execução.

## Credenciais locais do React

Para facilitar o desenvolvimento, o login React também aceita as credenciais visíveis em `react/server/credentials.js`:

- Usuário: `admin`
- Senha: `admin123`

Edite esse arquivo e reinicie a tarefa **React: iniciar API** para trocar os valores.
=======
Sistema de segurança
>>>>>>> c4957d8eb62304e5f0ce80e7754ec738364f447d
