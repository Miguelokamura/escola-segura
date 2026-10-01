import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { API_URL } from "./src/config";

let chaveMobile = "";
async function api(path, options = {}) {
  const response = await fetch(API_URL + path, { headers: { "Content-Type": "application/json", "X-Escola-Mobile-Key": chaveMobile, ...options.headers }, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.msg || "Não foi possível concluir a operação.");
  return data;
}
const Button = ({ children, onPress, secondary }) => <Pressable onPress={onPress} style={[styles.button, secondary && styles.secondary]}><Text style={[styles.buttonText, secondary && styles.secondaryText]}>{children}</Text></Pressable>;

function Login({ onLogin }) {
  const [usuario, setUsuario] = useState("admin"), [senha, setSenha] = useState("admin1234"), [erro, setErro] = useState("");
  async function entrar() { try { setErro(""); const resposta = await api("/mobile-login", { method: "POST", body: JSON.stringify({ usuario, senha }) }); chaveMobile = resposta.chaveMobile; onLogin(); } catch (e) { setErro(e.message); } }
  return <SafeAreaView style={styles.login}><View style={styles.loginCard}><Text style={styles.brand}>🏫 EscolaSegura</Text><Text style={styles.subtitle}>Controle de acesso escolar</Text><TextInput style={styles.input} value={usuario} onChangeText={setUsuario} placeholder="Usuário" autoCapitalize="none" /><TextInput style={styles.input} value={senha} onChangeText={setSenha} placeholder="Senha" secureTextEntry /><Text style={styles.error}>{erro}</Text><Button onPress={entrar}>Entrar</Button><Text style={styles.helper}>Credenciais: react/server/credentials.js</Text></View></SafeAreaView>;
}
const AccessRow = ({ item }) => <View style={styles.row}><View><Text style={styles.rowTitle}>{item.nome}</Text><Text>{item.tipo} • {item.dh || item.data_hora}</Text></View><Text style={item.status === "AUTORIZADO" ? styles.ok : styles.denied}>{item.status}</Text></View>;

function Dashboard() {
  const [dados, setDados] = useState(null); const carregar = useCallback(() => api("/dashboard").then(setDados).catch(e => Alert.alert("Erro", e.message)), []);
  useEffect(() => { carregar(); }, [carregar]);
  if (!dados) return <ActivityIndicator color="#b91c1c" style={styles.loading} />;
  const cards = [[dados.stats.total_alunos, "Alunos"], [dados.stats.entradas_hoje, "Entradas"], [dados.stats.saidas_hoje, "Saídas"], [dados.stats.negados_hoje, "Negados"]];
  return <ScrollView contentContainerStyle={styles.page}><View style={styles.titleLine}><Text style={styles.title}>Dashboard</Text><Button secondary onPress={carregar}>Atualizar</Button></View><View style={styles.stats}>{cards.map(([n, t]) => <View style={styles.stat} key={t}><Text style={styles.statNumber}>{n}</Text><Text>{t} hoje</Text></View>)}</View><Text style={styles.sectionTitle}>Últimos acessos</Text>{dados.ultimos.map((r, i) => <AccessRow item={r} key={i} />)}</ScrollView>;
}
function Alunos() {
  const [alunos, setAlunos] = useState([]); const carregar = useCallback(() => api("/alunos").then(setAlunos).catch(e => Alert.alert("Erro", e.message)), []);
  useEffect(() => { carregar(); }, [carregar]);
  return <View style={styles.fill}><View style={styles.titleLine}><Text style={styles.title}>Alunos</Text><Button secondary onPress={carregar}>Atualizar</Button></View><FlatList data={alunos} keyExtractor={a => String(a.id)} ListEmptyComponent={<Text>Nenhum aluno cadastrado.</Text>} renderItem={({ item }) => <View style={styles.row}><View><Text style={styles.rowTitle}>{item.nome}</Text><Text>{item.matricula} • {item.turma || "Sem turma"}</Text></View><Text style={item.ativo ? styles.ok : styles.denied}>{item.ativo ? "Ativo" : "Inativo"}</Text></View>} /></View>;
}
function Scanner() {
  const [permissao, pedirPermissao] = useCameraPermissions(), [resultado, setResultado] = useState(""), [travado, setTravado] = useState(false);
  async function ler({ data }) { if (travado) return; setTravado(true); try { const r = await api("/validar", { method: "POST", body: JSON.stringify({ token: data }) }); setResultado(r.msg); } catch (e) { setResultado(e.message); } setTimeout(() => setTravado(false), 2500); }
  if (!permissao) return <ActivityIndicator color="#b91c1c" style={styles.loading} />;
  if (!permissao.granted) return <View style={styles.center}><Text style={styles.centerText}>Permita a câmera para ler o QR Code.</Text><Button onPress={pedirPermissao}>Permitir câmera</Button></View>;
  return <View style={styles.fill}><Text style={styles.title}>Scanner QR Code</Text><Text style={styles.description}>Aponte a câmera para o QR Code do aluno.</Text><CameraView style={styles.camera} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={ler} /><Text style={styles.result}>{resultado}</Text></View>;
}
function Registros() {
  const [registros, setRegistros] = useState([]); const carregar = useCallback(() => api("/registros").then(setRegistros).catch(e => Alert.alert("Erro", e.message)), []);
  useEffect(() => { carregar(); }, [carregar]);
  return <View style={styles.fill}><View style={styles.titleLine}><Text style={styles.title}>Histórico</Text><Button secondary onPress={carregar}>Atualizar</Button></View><FlatList data={registros} keyExtractor={(_, i) => String(i)} renderItem={({ item }) => <AccessRow item={item} />} /></View>;
}
export default function App() {
  const [logado, setLogado] = useState(false), [tela, setTela] = useState("dashboard");
  if (!logado) return <SafeAreaProvider><Login onLogin={() => setLogado(true)} /></SafeAreaProvider>;
  const pages = { dashboard: <Dashboard />, alunos: <Alunos />, scanner: <Scanner />, registros: <Registros /> };
  return <SafeAreaProvider><SafeAreaView style={styles.app}><StatusBar style="light" /><View style={styles.header}><Text style={styles.headerText}>🏫 EscolaSegura</Text></View>{pages[tela]}<View style={styles.tabs}>{[["dashboard", "Início"], ["alunos", "Alunos"], ["scanner", "Scanner"], ["registros", "Histórico"]].map(([id, label]) => <Pressable key={id} style={styles.tab} onPress={() => setTela(id)}><Text style={tela === id ? styles.tabActive : styles.tabText}>{label}</Text></Pressable>)}</View></SafeAreaView></SafeAreaProvider>;
}
const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: "#fff7f7" }, header: { backgroundColor: "#b91c1c", padding: 18 }, headerText: { color: "#fff", fontSize: 20, fontWeight: "700" }, fill: { flex: 1, padding: 18 }, page: { padding: 18, gap: 12 }, login: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "#fff7f7" }, loginCard: { backgroundColor: "#fff", borderRadius: 12, padding: 24, gap: 12, elevation: 3 }, brand: { color: "#7f1d1d", fontSize: 26, fontWeight: "700", textAlign: "center" }, subtitle: { color: "#666", textAlign: "center", marginBottom: 12 }, input: { backgroundColor: "#fff", borderColor: "#fecaca", borderRadius: 7, borderWidth: 1, padding: 13 }, error: { color: "#b91c1c", minHeight: 18 }, helper: { color: "#777", fontSize: 12, textAlign: "center" }, button: { alignSelf: "flex-start", backgroundColor: "#b91c1c", borderRadius: 7, paddingHorizontal: 15, paddingVertical: 11 }, buttonText: { color: "#fff", fontWeight: "700" }, secondary: { backgroundColor: "#fff", borderColor: "#b91c1c", borderWidth: 1 }, secondaryText: { color: "#b91c1c" }, titleLine: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 14 }, title: { color: "#7f1d1d", fontSize: 25, fontWeight: "700" }, stats: { flexDirection: "row", flexWrap: "wrap", gap: 10 }, stat: { backgroundColor: "#fff", borderColor: "#fee2e2", borderRadius: 9, borderWidth: 1, padding: 16, width: "47%" }, statNumber: { color: "#b91c1c", fontSize: 30, fontWeight: "700" }, sectionTitle: { color: "#7f1d1d", fontSize: 19, fontWeight: "700", marginTop: 12 }, row: { alignItems: "center", backgroundColor: "#fff", borderBottomColor: "#fee2e2", borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", padding: 14 }, rowTitle: { color: "#374151", fontWeight: "700" }, ok: { color: "#15803d", fontSize: 12, fontWeight: "700" }, denied: { color: "#b91c1c", fontSize: 12, fontWeight: "700" }, camera: { borderRadius: 10, height: 360, marginTop: 16, overflow: "hidden" }, description: { color: "#666" }, result: { color: "#7f1d1d", fontSize: 16, fontWeight: "700", marginTop: 16, textAlign: "center" }, center: { alignItems: "center", flex: 1, gap: 18, justifyContent: "center", padding: 24 }, centerText: { fontSize: 16, textAlign: "center" }, loading: { flex: 1, justifyContent: "center" }, tabs: { backgroundColor: "#fff", borderColor: "#fecaca", borderTopWidth: 1, flexDirection: "row" }, tab: { alignItems: "center", flex: 1, paddingVertical: 16 }, tabText: { color: "#777", fontSize: 12 }, tabActive: { color: "#b91c1c", fontSize: 12, fontWeight: "700" }
});
