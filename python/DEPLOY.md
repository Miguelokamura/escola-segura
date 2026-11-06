# Migração MySQL e implantação

## Valores conhecidos no projeto

- Banco local: `escola_segura`
- Driver Flask: `mysql-connector-python`
- A tabela que registra entradas e saídas é `registros`, relacionada a `alunos`.
- A API do Arduino grava nessa tabela, usada pelo histórico existente; não cria uma tabela paralela.

## Migração para Aiven

1. Crie o serviço MySQL no Aiven e o banco de destino. Baixe o certificado CA pelo painel Aiven e salve-o como `ca.pem` na raiz do projeto; esse arquivo é ignorado pelo Git.
2. Copie `.env.example` para `.env` na raiz, preencha `LOCAL_DB_*`, `DB_*` e `DB_SSL_CA=./ca.pem` com os valores reais e mantenha `.env` fora do Git.
3. Execute `bash migrar_banco.sh` na raiz do repositório, usando Git Bash, WSL ou Linux. O script aborta com erro claro se faltar uma variável ou o certificado, exige que o banco Aiven esteja vazio, adiciona à origem a coluna nullable de idempotência dos eventos Arduino e compara as contagens de cada tabela antes e depois da importação.
4. Só prossiga se a última mensagem confirmar contagens iguais. O script não apaga nem esvazia o banco local. Não execute duas migrações concorrentes.

As credenciais anteriores devem ser tratadas como comprometidas: redefina a senha no painel Aiven (**Reset password**) e atualize apenas o `.env` local e as variáveis do serviço Render/Express. Não reescreva o histórico Git; a rotação da senha invalida o segredo antigo. Não envie credenciais por chat nem as grave no Git.

Se o Flask alcançar o host/porta, mas o handshake do MySQL expirar, confirme no painel Aiven que o serviço está ativo, que o endpoint e a porta correspondem ao serviço e que o acesso público/IP está permitido. O Flask limita a tentativa de conexão com `DB_CONNECT_TIMEOUT` (5 segundos por padrão); isso evita esperas longas, mas não corrige indisponibilidade ou bloqueio de rede.

## Render

O `render.yaml` prepara um Web Service Flask, usando `python/` como diretório raiz. No Render, conecte o repositório e crie o serviço pelo Blueprint:

- Build Command: `pip install -r requirements.txt`
- Start Command: `gunicorn --bind 0.0.0.0:$PORT app:app`
- Health check: `/ping`

Cadastre no painel do serviço os valores Aiven de `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` e `DB_NAME` como **Environment Variables**, e gere um `SECRET_KEY` longo e aleatório. Para o certificado, converta o conteúdo PEM de `ca.pem` para Base64 e cadastre-o em `DB_SSL_CA_B64`; a aplicação decodifica o valor em runtime. Alternativamente, use um Secret File e configure `DB_SSL_CA` com o caminho do arquivo. Não inclua credenciais ou certificados no repositório. Defina `CORS_ORIGINS` com as origens exatas do frontend que realmente chamar a API Flask, separadas por vírgula.

O endpoint `/ping` pode ser usado por um monitor externo, como o UptimeRobot. Um ping periódico pode reduzir a espera de inicialização, mas os planos gratuitos podem suspender o serviço mesmo assim; não é uma garantia de disponibilidade nem um SLA.

O Flask é a API pública do Arduino. O painel React existente continua usando a API Express. Para o histórico React ler os mesmos dados, configure `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` e `DB_SSL_CA_B64` também em `react/server/.env` (ou nas variáveis do serviço Express, caso seja hospedado), com os mesmos dados Aiven. O Express também aceita `DB_SSL_CA` apontando para um arquivo CA. O `VITE_API_URL` do cliente é opcional: vazio mantém o proxy local do Vite; se a API Express estiver em outra origem, configure a URL base e permita a origem do frontend em `CORS_ORIGINS` no Express. O polling de resumo e histórico é de 2,5 segundos.

## Arduino Uno + GM77 + ESP-01

O sketch está em `arduino/esp01/EscolaSegura.ino`. Ele usa o QR como `codigo`, gera um `evento_id` persistente por leitura e chama `GET /api/acesso` por TLS. O identificador torna seguros os reenvios após uma resposta perdida: a migração adiciona `registros.arduino_event_id` com índice único. Eventos já recebidos não criam um segundo registro.

Antes de compilar, preencha no sketch o SSID/senha do Wi-Fi e o hostname HTTPS exato fornecido pelo Render, sem `https://` no campo do host. O ESP-01 precisa de firmware AT com suporte SSL/TLS e SNI compatível com o endpoint Render. Verifique a compatibilidade do firmware e da validação de certificado no módulo; uma conexão TLS sem verificação do servidor não protege contra interceptação.

- ESP-01: use alimentação regulada de 3,3 V com corrente suficiente; não alimente o módulo pelo pino 3,3 V do Uno. Coloque divisor de nível no RX do ESP-01.
- GM77: saída TX no pino 10 (RX da `SoftwareSerial`); entrada RX no pino 11 (TX da `SoftwareSerial`), se necessária pelo leitor.
- ESP-01: saída TX no pino 2 (RX da `SoftwareSerial`); entrada RX no pino 3 (TX da `SoftwareSerial`), com divisor de nível.
- LEDs verde e vermelho: pinos 6 e 7, cada um com resistor apropriado.
- A EEPROM do Uno tem capacidade limitada; o sketch mantém uma fila circular de até 14 eventos. Se a fila encher enquanto não houver rede, o LED vermelho sinaliza que a nova leitura não pôde ser armazenada. Durante uma tentativa de rede, a SoftwareSerial alterna do leitor para o ESP-01; para este protótipo, evite novas leituras enquanto os LEDs indicarem envio.

O ESP-01 em modo AT depende da versão de firmware para TLS e SNI. Teste o handshake com o domínio Render antes de instalar o dispositivo. O servidor só remove um evento da fila após receber JSON válido; uma resposta perdida pode ser reenviada com o mesmo identificador sem duplicar o acesso.
