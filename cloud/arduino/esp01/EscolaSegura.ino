#include <EEPROM.h>
#include <SoftwareSerial.h>
#include <stdio.h>
#include <string.h>

// Configure estes valores antes de gravar o sketch no Arduino.
const char WIFI_SSID[] = "NOME_DA_REDE";
const char WIFI_SENHA[] = "SENHA_DA_REDE";
const char API_HOST[] = "escola-segura-flask-api.onrender.com";
const char DISPOSITIVO_ID[] = "UNO-01";

const uint8_t PINO_LED_VERDE = 6;
const uint8_t PINO_LED_VERMELHO = 7;
const uint32_t INTERVALO_REENVIO_MS = 15000;
const uint32_t TIMEOUT_WIFI_MS = 25000;
const uint32_t TIMEOUT_RESPOSTA_MS = 12000;
const uint16_t EEPROM_MAGIC = 0x5341;

// SoftwareSerial(recebe, transmite): ESP TX -> pino 2; ESP RX <- pino 3.
SoftwareSerial esp01(2, 3);
// GM77 TX -> pino 10; GM77 RX <- pino 11 (se o leitor precisar de entrada).
SoftwareSerial gm77(10, 11);

struct CabecalhoFila {
  uint16_t magic;
  uint8_t inicio;
  uint8_t quantidade;
  uint32_t proximaSequencia;
};

struct EventoPendente {
  uint32_t sequencia;
  uint8_t tamanhoCodigo;
  char codigo[65];
};

CabecalhoFila fila;
char codigoLido[65];
uint8_t tamanhoCodigoLido = 0;
uint32_t ultimaLeituraSerialMs = 0;
uint32_t ultimaTentativaMs = 0;

uint8_t capacidadeFila() {
  return (EEPROM.length() - sizeof(CabecalhoFila)) / sizeof(EventoPendente);
}

int enderecoEvento(uint8_t posicao) {
  return sizeof(CabecalhoFila) + posicao * sizeof(EventoPendente);
}

void salvarCabecalho() {
  EEPROM.put(0, fila);
}

void inicializarFila() {
  EEPROM.get(0, fila);
  if (fila.magic != EEPROM_MAGIC || fila.inicio >= capacidadeFila() ||
      fila.quantidade > capacidadeFila() || fila.proximaSequencia == 0) {
    fila.magic = EEPROM_MAGIC;
    fila.inicio = 0;
    fila.quantidade = 0;
    fila.proximaSequencia = 1;
    salvarCabecalho();
  }
}

void indicarResultado(bool liberado) {
  digitalWrite(PINO_LED_VERDE, liberado ? HIGH : LOW);
  digitalWrite(PINO_LED_VERMELHO, liberado ? LOW : HIGH);
  delay(800);
  digitalWrite(PINO_LED_VERDE, LOW);
  digitalWrite(PINO_LED_VERMELHO, LOW);
}

bool adicionarNaFila(const char *codigo, uint8_t tamanho) {
  if (tamanho == 0 || tamanho > 64 || fila.quantidade >= capacidadeFila()) {
    Serial.println(F("Fila EEPROM cheia ou codigo invalido."));
    indicarResultado(false);
    return false;
  }

  uint8_t posicao = (fila.inicio + fila.quantidade) % capacidadeFila();
  EventoPendente evento;
  evento.sequencia = fila.proximaSequencia;
  evento.tamanhoCodigo = tamanho;
  memset(evento.codigo, 0, sizeof(evento.codigo));
  memcpy(evento.codigo, codigo, tamanho);
  EEPROM.put(enderecoEvento(posicao), evento);

  fila.proximaSequencia++;
  if (fila.proximaSequencia == 0) fila.proximaSequencia = 1;
  fila.quantidade++;
  salvarCabecalho();
  Serial.println(F("Leitura guardada na fila."));
  return true;
}

bool lerEventoAtual(EventoPendente &evento) {
  if (fila.quantidade == 0) return false;
  EEPROM.get(enderecoEvento(fila.inicio), evento);
  return evento.tamanhoCodigo > 0 && evento.tamanhoCodigo <= 64;
}

void removerDaFila() {
  if (fila.quantidade == 0) return;
  fila.inicio = (fila.inicio + 1) % capacidadeFila();
  fila.quantidade--;
  salvarCabecalho();
}

bool esperarRespostaAT(const char *marcador, uint32_t timeoutMs,
                       char *captura, size_t capacidade) {
  size_t tamanho = 0;
  uint32_t inicio = millis();
  captura[0] = '\0';

  while (millis() - inicio < timeoutMs) {
    while (esp01.available()) {
      char caractere = (char)esp01.read();
      if (tamanho + 1 < capacidade) {
        captura[tamanho++] = caractere;
        captura[tamanho] = '\0';
      }
      if (strstr(captura, marcador)) return true;
      if (strstr(captura, "ERROR") || strstr(captura, "FAIL")) return false;
    }
  }
  return strstr(captura, marcador) != nullptr;
}

bool enviarComandoAT(const char *comando, const char *marcador,
                     uint32_t timeoutMs, char *captura, size_t capacidade) {
  while (esp01.available()) esp01.read();
  esp01.print(comando);
  esp01.print("\r\n");
  return esperarRespostaAT(marcador, timeoutMs, captura, capacidade);
}

bool conectarWiFi() {
  char resposta[180];
  esp01.listen();

  enviarComandoAT("AT", "OK", 2000, resposta, sizeof(resposta));
  if (enviarComandoAT("AT+CWSTATE?", "OK", 2000, resposta, sizeof(resposta)) &&
      strstr(resposta, "CWSTATE:2")) {
    return true;
  }

  enviarComandoAT("AT+CWMODE=1", "OK", 3000, resposta, sizeof(resposta));
  char comando[180];
  snprintf(comando, sizeof(comando), "AT+CWJAP=\"%s\",\"%s\"",
           WIFI_SSID, WIFI_SENHA);
  if (!enviarComandoAT(comando, "OK", TIMEOUT_WIFI_MS,
                       resposta, sizeof(resposta))) {
    Serial.println(F("Falha ao conectar ao Wi-Fi."));
    return false;
  }
  return true;
}

enum ResultadoEnvio {
  ENVIO_FALHOU,
  ACESSO_NEGADO,
  ACESSO_LIBERADO
};

ResultadoEnvio enviarEvento(const EventoPendente &evento) {
  if (!conectarWiFi()) return ENVIO_FALHOU;

  char identificador[32];
  snprintf(identificador, sizeof(identificador), "%s-%08lX",
           DISPOSITIVO_ID, (unsigned long)evento.sequencia);

  // Os códigos QR deste sistema são tokens hexadecimais, seguros na URL.
  char requisicao[360];
  int tamanho = snprintf(
      requisicao, sizeof(requisicao),
      "GET /api/acesso?codigo=%s&evento_id=%s HTTP/1.1\r\n"
      "Host: %s\r\n"
      "Accept: application/json\r\n"
      "Connection: close\r\n\r\n",
      evento.codigo, identificador, API_HOST);
  if (tamanho <= 0 || tamanho >= (int)sizeof(requisicao)) {
    return ENVIO_FALHOU;
  }

  char comando[150];
  char respostaAT[220];
  snprintf(comando, sizeof(comando), "AT+CIPSTART=\"SSL\",\"%s\",443", API_HOST);
  if (!enviarComandoAT(comando, "CONNECT", 20000,
                       respostaAT, sizeof(respostaAT))) {
    Serial.println(F("Falha ao abrir conexao TLS com a API."));
    return ENVIO_FALHOU;
  }

  snprintf(comando, sizeof(comando), "AT+CIPSEND=%d", tamanho);
  if (!enviarComandoAT(comando, ">", 5000, respostaAT, sizeof(respostaAT))) {
    enviarComandoAT("AT+CIPCLOSE", "OK", 2000, respostaAT, sizeof(respostaAT));
    return ENVIO_FALHOU;
  }

  esp01.print(requisicao);
  char respostaHttp[700];
  size_t usados = 0;
  uint32_t inicio = millis();
  respostaHttp[0] = '\0';
  bool conexaoFechada = false;
  while (millis() - inicio < TIMEOUT_RESPOSTA_MS && !conexaoFechada) {
    while (esp01.available()) {
      char caractere = (char)esp01.read();
      if (usados + 1 < sizeof(respostaHttp)) {
        respostaHttp[usados++] = caractere;
        respostaHttp[usados] = '\0';
      }
      if (strstr(respostaHttp, "CLOSED")) {
        conexaoFechada = true;
        break;
      }
    }
  }
  enviarComandoAT("AT+CIPCLOSE", "OK", 2000, respostaAT, sizeof(respostaAT));

  if (!strstr(respostaHttp, "HTTP/1.1 200") &&
      !strstr(respostaHttp, "HTTP/1.0 200")) {
    Serial.println(F("Sem resposta HTTP valida; evento continua na fila."));
    return ENVIO_FALHOU;
  }
  if (strstr(respostaHttp, "\"liberado\":true")) return ACESSO_LIBERADO;
  if (strstr(respostaHttp, "\"liberado\":false")) return ACESSO_NEGADO;
  return ENVIO_FALHOU;
}

void lerLeitor() {
  gm77.listen();
  while (gm77.available()) {
    char caractere = (char)gm77.read();
    ultimaLeituraSerialMs = millis();
    if (caractere == '\r' || caractere == '\n') {
      if (tamanhoCodigoLido > 0) {
        codigoLido[tamanhoCodigoLido] = '\0';
        adicionarNaFila(codigoLido, tamanhoCodigoLido);
        tamanhoCodigoLido = 0;
      }
    } else if (caractere >= 32 && caractere <= 126) {
      if (tamanhoCodigoLido < 64) {
        codigoLido[tamanhoCodigoLido++] = caractere;
      } else {
        Serial.println(F("Codigo lido excede 64 caracteres."));
        tamanhoCodigoLido = 0;
        indicarResultado(false);
      }
    }
  }

  // Alguns leitores enviam o código sem CR/LF: finalize após a pausa serial.
  if (tamanhoCodigoLido > 0 && millis() - ultimaLeituraSerialMs > 120) {
    codigoLido[tamanhoCodigoLido] = '\0';
    adicionarNaFila(codigoLido, tamanhoCodigoLido);
    tamanhoCodigoLido = 0;
  }
}

void processarFila() {
  if (fila.quantidade == 0 ||
      millis() - ultimaTentativaMs < INTERVALO_REENVIO_MS) return;
  ultimaTentativaMs = millis();

  EventoPendente evento;
  if (!lerEventoAtual(evento)) {
    Serial.println(F("Evento EEPROM invalido; removendo item corrompido."));
    removerDaFila();
    indicarResultado(false);
    return;
  }

  ResultadoEnvio resultado = enviarEvento(evento);
  if (resultado == ENVIO_FALHOU) {
    indicarResultado(false);
    return;
  }

  // Resposta recebida: libera o próximo item. O evento_id evita duplicidade
  // caso a API tenha gravado o registro e a conexão caia antes da resposta.
  removerDaFila();
  indicarResultado(resultado == ACESSO_LIBERADO);
}

void setup() {
  pinMode(PINO_LED_VERDE, OUTPUT);
  pinMode(PINO_LED_VERMELHO, OUTPUT);
  digitalWrite(PINO_LED_VERDE, LOW);
  digitalWrite(PINO_LED_VERMELHO, LOW);
  Serial.begin(9600);
  esp01.begin(9600);
  gm77.begin(9600);
  inicializarFila();
  ultimaTentativaMs = millis() - INTERVALO_REENVIO_MS;
  Serial.println(F("Leitor EscolaSegura pronto."));
}

void loop() {
  lerLeitor();
  processarFila();
}
