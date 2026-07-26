// Wrapper da GitHub Action: roda o cnpj-scan no diretório indicado, mostra o
// relatório humano no log e decide o exit code conforme o input fail-on.

const { spawnSync } = require("child_process");
const path = require("path");

const scanScript = path.join(__dirname, "cnpj-scan.js");
const alvo = process.env.INPUT_PATH || ".";
const failOn = (process.env["INPUT_FAIL-ON"] || "alta").toLowerCase();

// 1. Saída humana para o log do CI.
const humano = spawnSync(process.execPath, [scanScript, alvo], { encoding: "utf8" });
process.stdout.write(humano.stdout || "");
process.stderr.write(humano.stderr || "");
if (humano.status !== 0 && !humano.stdout) {
  console.error("cnpj-scan não conseguiu analisar o diretório: " + alvo);
  process.exit(1);
}

// 2. Saída JSON para decidir o resultado do build.
const json = spawnSync(process.execPath, [scanScript, alvo, "--json"], { encoding: "utf8" });
let resultado;
try {
  resultado = JSON.parse(json.stdout);
} catch {
  console.error("Não foi possível interpretar a saída JSON do cnpj-scan.");
  process.exit(1);
}

const alta = resultado.findings.filter((f) => f.severity === "alta").length;
const media = resultado.findings.filter((f) => f.severity === "media").length;

console.log("");
console.log(`cnpj-scan: ${resultado.filesScanned} arquivo(s) analisado(s) — ${alta} achado(s) ALTA, ${media} MÉDIA.`);

let falhou = false;
if (failOn === "alta") falhou = alta > 0;
else if (failOn === "media") falhou = alta + media > 0;
else if (failOn !== "never") {
  console.error(`Valor inválido para fail-on: "${failOn}" (use alta, media ou never).`);
  process.exit(1);
}

if (falhou) {
  console.error("");
  console.error("❌ O código contém padrões que quebram com o CNPJ alfanumérico.");
  console.error("   Guia de correção: https://cnpjcomletras.com.br/como-adaptar-sistema-cnpj-alfanumerico");
  process.exit(1);
}
if (alta + media > 0) {
  console.log("⚠️ Há achados, mas o build não falha com fail-on=" + failOn + ". Revise o relatório acima.");
} else {
  console.log("✅ Nenhum padrão de risco para o CNPJ alfanumérico.");
}
