#!/usr/bin/env node
/*
 * cnpj-scan — diagnóstico de prontidão para o CNPJ alfanumérico (IN RFB 2.229/2024).
 *
 * Varre um diretório de código-fonte e aponta padrões que quebram com CNPJs
 * contendo letras: regex só-dígitos, colunas numéricas, conversões para número,
 * máscaras de input e validadores com o algoritmo antigo.
 *
 * Uso:  node cnpj-scan.js <diretório> [--json] [--report relatorio.html] [--licenca CNPJ-XXXX-XXXX-XXXX]
 *
 * A varredura e o resumo no terminal são gratuitos.
 * --report gera o Relatório Executivo de Prontidão em HTML auto-contido,
 * pronto para impressão em PDF (Ctrl+P → Salvar como PDF) — requer licença:
 * https://cnpjcomletras.com.br/diagnostico
 *
 * Privacidade: a validação envia APENAS a chave de licença. Nenhum código,
 * caminho ou resultado da análise sai da sua máquina.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const CODE_EXTENSIONS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".vue", ".svelte", ".mjs", ".cjs",
  ".py", ".java", ".kt", ".cs", ".vb", ".php", ".rb", ".go", ".rs",
  ".sql", ".prisma", ".html", ".htm", ".xml", ".json", ".yaml", ".yml",
  ".c", ".cpp", ".h", ".swift", ".dart", ".scala", ".pas", ".prg", ".clw",
]);

const IGNORED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", "target", "bin", "obj",
  "vendor", "__pycache__", ".next", ".nuxt", "coverage", ".venv", "venv",
]);

const MAX_FILE_BYTES = 2 * 1024 * 1024;

// Um achado só é reportado se a linha (ou o contexto próximo) mencionar CNPJ.
const CNPJ_HINT = /cnpj/i;

const RULES = [
  {
    id: "regex-somente-digitos",
    severity: "alta",
    pattern: /\\d\{14\}|\\d\{2\}[^\n]{0,30}\\d\{3\}[^\n]{0,30}\\d\{4\}[^\n]{0,20}\\d\{2\}|\[0-9\]\{14\}/,
    message: "Regex aceita apenas dígitos — rejeita CNPJ alfanumérico. Troque por [0-9A-Z]{12}[0-9]{2}.",
  },
  {
    id: "coluna-numerica",
    severity: "alta",
    sameLine: true, // evita marcar colunas vizinhas (ex.: telefone BIGINT)
    pattern: /\b(BIGINT|INT8|INTEGER|NUMERIC\s*\(\s*14|DECIMAL\s*\(\s*14|NUMBER\s*\(\s*14)\b/i,
    message: "Coluna/tipo numérico não comporta letras. Migre para VARCHAR(14)/texto.",
  },
  {
    id: "conversao-numerica",
    severity: "alta",
    // Duas formas: conversão com "cnpj" no argumento (parseInt(cnpj)) e
    // atribuição a variável/campo cnpj (cnpj = parseInt(valor), cliente.cnpj = (long) x).
    pattern: /\b(parseInt|parseFloat|Number|int|long|Convert\.ToInt64|Long\.parseLong|to_i|intval|CAST\s*\(|CONVERT\s*\()\s*\(?[^\n)]{0,40}cnpj|cnpj\w*\s*=[^\n=]{0,40}?(\bparseInt\b|\bparseFloat\b|\bNumber\s*\(|\bConvert\.ToInt64\b|\bLong\.parseLong\b|\bintval\b|\.to_i\b|\bCAST\s*\(|\bCONVERT\s*\(|\(\s*(?:int|long)\s*\))/i,
    message: "Conversão do CNPJ para número corrompe/rejeita o formato alfanumérico. Trate sempre como string.",
  },
  {
    id: "mascara-somente-digitos",
    severity: "media",
    pattern: /(99\.999\.999\/9999-99|##\.###\.###\/####-##|00\.000\.000\/0000-00)/,
    message: "Máscara de input aceita só dígitos nas 12 primeiras posições. Permita letras A-Z (maiúsculas).",
  },
  {
    id: "zero-a-esquerda",
    severity: "media",
    pattern: /\b(LPAD|padStart|zfill|PadLeft|str_pad|format\s*\(\s*['"]%0?14)\s*\(?[^\n]{0,40}/i,
    message: "Preenchimento com zeros à esquerda assume CNPJ numérico. Verifique se o dado é tratado como texto.",
  },
  {
    id: "replace-nao-digitos",
    severity: "media",
    pattern: /replace\s*\(\s*\/?\[?\^?\\?d\+?\]?\/?[^\n]{0,10},\s*['"]{2}\s*\)|\[\^\\d\]|\[\^0-9\]/,
    message: "Limpeza que remove tudo que não é dígito apaga as letras do CNPJ. Remova apenas . / - e espaços.",
  },
];

function walk(dir, files = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".env") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name.toLowerCase())) walk(full, files);
    } else if (CODE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(full);
    }
  }
  return files;
}

function scanFile(file) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return [];
  }
  if (stat.size > MAX_FILE_BYTES) return [];

  const content = fs.readFileSync(file, "utf8");
  if (!CNPJ_HINT.test(content)) return [];

  const lines = content.split(/\r?\n/);
  const findings = [];

  lines.forEach((line, i) => {
    // Contexto: a própria linha ou até 3 linhas acima mencionam CNPJ.
    const context = lines.slice(Math.max(0, i - 3), i + 1).join("\n");
    if (!CNPJ_HINT.test(context)) return;

    for (const rule of RULES) {
      if (rule.sameLine && !CNPJ_HINT.test(line)) continue;
      if (rule.pattern.test(line)) {
        findings.push({
          file,
          line: i + 1,
          rule: rule.id,
          severity: rule.severity,
          message: rule.message,
          excerpt: line.trim().slice(0, 160),
        });
      }
    }
  });
  return findings;
}

/* ---------- Relatório executivo (HTML auto-contido, pronto para PDF) ---------- */

const RULE_META = {
  "regex-somente-digitos": { titulo: "Validação por regex só-dígitos", esforco: "Baixo", ordem: 3 },
  "coluna-numerica": { titulo: "Coluna de banco com tipo numérico", esforco: "Alto (migração de schema e dados)", ordem: 1 },
  "conversao-numerica": { titulo: "Conversão do CNPJ para número", esforco: "Médio", ordem: 2 },
  "mascara-somente-digitos": { titulo: "Máscara de formulário só-dígitos", esforco: "Baixo", ordem: 4 },
  "zero-a-esquerda": { titulo: "Preenchimento com zeros à esquerda", esforco: "Baixo", ordem: 5 },
  "replace-nao-digitos": { titulo: "Limpeza que remove letras", esforco: "Baixo", ordem: 4 },
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function computeScore(findings) {
  const alta = findings.filter((f) => f.severity === "alta").length;
  const media = findings.filter((f) => f.severity === "media").length;
  return Math.max(5, 100 - alta * 15 - media * 5);
}

function classify(score) {
  if (score >= 90) return { label: "PRONTO", color: "#0b6e4f", desc: "Nenhum bloqueio relevante identificado pela varredura estática." };
  if (score >= 60) return { label: "ATENÇÃO", color: "#8a5a00", desc: "Há pontos que rejeitam ou corrompem CNPJs alfanuméricos. Adequação recomendada antes que um cliente com o novo CNPJ precise ser cadastrado." };
  return { label: "CRÍTICO", color: "#b3261e", desc: "O sistema muito provavelmente NÃO consegue cadastrar empresas com o novo CNPJ alfanumérico. Adequação urgente." };
}

function buildReportHtml(root, filesScanned, findings) {
  const score = computeScore(findings);
  const cls = classify(score);
  const now = new Date().toLocaleString("pt-BR");
  const alta = findings.filter((f) => f.severity === "alta").length;
  const media = findings.filter((f) => f.severity === "media").length;

  const grupos = {};
  findings.forEach((f) => {
    (grupos[f.rule] = grupos[f.rule] || []).push(f);
  });
  const gruposOrdenados = Object.entries(grupos).sort(
    (a, b) => (RULE_META[a[0]] ? RULE_META[a[0]].ordem : 9) - (RULE_META[b[0]] ? RULE_META[b[0]].ordem : 9)
  );

  const linhasCategorias = gruposOrdenados.map(([rule, items]) => {
    const meta = RULE_META[rule] || { titulo: rule, esforco: "—" };
    const sev = items[0].severity === "alta" ? "ALTA" : "MÉDIA";
    return `<tr><td>${escapeHtml(meta.titulo)}</td><td class="sev-${items[0].severity}">${sev}</td><td>${items.length}</td><td>${escapeHtml(meta.esforco)}</td><td>${escapeHtml(items[0].message)}</td></tr>`;
  }).join("");

  const plano = gruposOrdenados.map(([rule, items], i) => {
    const meta = RULE_META[rule] || { titulo: rule };
    return `<li><strong>${escapeHtml(meta.titulo)}</strong> — ${items.length} ocorrência(s). ${escapeHtml(items[0].message)}</li>`;
  }).join("");

  const apendice = findings.map((f) =>
    `<tr><td class="mono">${escapeHtml(path.relative(root, f.file))}:${f.line}</td><td class="sev-${f.severity}">${f.severity === "alta" ? "ALTA" : "MÉDIA"}</td><td class="mono excerpt">${escapeHtml(f.excerpt)}</td></tr>`
  ).join("");

  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8">
<title>Relatório de Prontidão — CNPJ Alfanumérico</title>
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1a2330;max-width:900px;margin:0 auto;padding:32px;line-height:1.55}
  h1{font-size:1.6rem;margin:0}  h2{font-size:1.15rem;margin-top:36px;border-bottom:2px solid #e3e8ee;padding-bottom:6px}
  .meta{color:#5b6b7f;font-size:.9rem;margin-top:4px}
  .scorebox{display:flex;align-items:center;gap:24px;background:#f5f7fa;border:1px solid #dfe5ec;border-radius:12px;padding:20px 28px;margin-top:24px}
  .scoreval{font-size:3rem;font-weight:800;color:${cls.color}}
  .scorelabel{font-weight:800;color:${cls.color};font-size:1.2rem}
  table{border-collapse:collapse;width:100%;font-size:.88rem;margin-top:12px}
  th,td{border:1px solid #d8e0e8;padding:8px 10px;text-align:left;vertical-align:top}
  th{background:#eef2f6}
  .sev-alta{color:#b3261e;font-weight:700}.sev-media{color:#8a5a00;font-weight:700}
  .mono{font-family:Consolas,Menlo,monospace;font-size:.8rem}
  .excerpt{word-break:break-all}
  footer{margin-top:48px;font-size:.8rem;color:#5b6b7f;border-top:1px solid #d8e0e8;padding-top:12px}
  .printtip{background:#e3f2ec;border-radius:8px;padding:10px 16px;font-size:.85rem;margin-top:16px}
  @media print{.printtip{display:none}body{padding:0}}
</style></head><body>
<h1>Relatório de Prontidão — CNPJ Alfanumérico</h1>
<p class="meta">Sistema analisado: <strong>${escapeHtml(path.basename(root))}</strong> · ${filesScanned} arquivo(s) de código · Gerado em ${now} · cnpj-scan / CNPJcomLetras.com.br</p>
<div class="printtip">💡 Para salvar em PDF: Ctrl+P → "Salvar como PDF".</div>
<div class="scorebox">
  <div class="scoreval">${score}</div>
  <div><div class="scorelabel">${cls.label}</div><div>${cls.desc}</div></div>
</div>
<h2>Sumário executivo</h2>
<p>A varredura identificou <strong>${alta} ponto(s) de severidade ALTA</strong> (rejeitam ou corrompem o CNPJ alfanumérico) e <strong>${media} de severidade MÉDIA</strong> em código relacionado a CNPJ. Desde 31/07/2026, novas empresas podem receber CNPJ contendo letras (IN RFB nº 2.229/2024); sistemas não adaptados <strong>não conseguem cadastrar clientes e fornecedores novos</strong> com esse formato — impacto direto em vendas e operações, não apenas um problema técnico.</p>
<h2>Achados por categoria</h2>
<table><thead><tr><th>Categoria</th><th>Severidade</th><th>Ocorrências</th><th>Esforço estimado</th><th>Correção recomendada</th></tr></thead>
<tbody>${linhasCategorias || '<tr><td colspan="5">Nenhum achado.</td></tr>'}</tbody></table>
<h2>Plano de ação recomendado (em ordem)</h2>
<ol>${plano || "<li>Nenhuma ação necessária pela análise estática. Valide com massa de teste.</li>"}</ol>
<p>Após as correções, valide cada fluxo (formulário, API, banco, integrações) com CNPJs de teste válidos gerados em <strong>https://cnpjcomletras.com.br</strong> — incluindo o exemplo oficial da Receita <span class="mono">12.ABC.345/01DE-35</span>.</p>
<h2>Apêndice técnico — todos os achados</h2>
<table><thead><tr><th>Arquivo:linha</th><th>Severidade</th><th>Trecho</th></tr></thead>
<tbody>${apendice || '<tr><td colspan="3">Nenhum achado.</td></tr>'}</tbody></table>
<footer>Relatório gerado localmente pelo cnpj-scan — seu código não saiu da sua máquina. Análise estática de padrões: não substitui testes funcionais. CNPJcomLetras.com.br · IN RFB nº 2.229/2024.</footer>
</body></html>`;
}

/* ---------- Licença (necessária apenas para o --report) ---------- */

const LICENSE_APIS = process.env.CNPJ_SCAN_API
  ? [process.env.CNPJ_SCAN_API]
  : ["https://cnpjcomletras.com.br", "https://cnpj-com-letras.pages.dev"];
const LICENSE_CACHE = path.join(os.homedir(), ".cnpj-scan-licenca.json");

function lerCacheLicenca() {
  try {
    return JSON.parse(fs.readFileSync(LICENSE_CACHE, "utf8"));
  } catch {
    return null;
  }
}

async function consultarLicenca(chave) {
  for (const base of LICENSE_APIS) {
    try {
      const r = await fetch(`${base.replace(/\/$/, "")}/api/licenca/validar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chave }),
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) continue;
      const d = await r.json();
      if (d.ok) return d.valida === true ? "valida" : "invalida";
    } catch {
      // tenta o próximo endpoint
    }
  }
  return "offline";
}

async function exigirLicenca(chaveArg) {
  const cache = lerCacheLicenca();
  const chave = (chaveArg || process.env.CNPJ_SCAN_LICENCA || (cache && cache.chave) || "").trim().toUpperCase();

  if (!chave) {
    console.error("\n❌ O Relatório Executivo (--report) requer uma licença.");
    console.error("   Informe com:  --licenca CNPJ-XXXX-XXXX-XXXX");
    console.error("   Adquira a sua em: https://cnpjcomletras.com.br/diagnostico");
    console.error("   (A varredura no terminal continua gratuita — rode sem --report.)");
    process.exit(3);
  }

  const resultado = await consultarLicenca(chave);

  if (resultado === "valida") {
    try {
      fs.writeFileSync(LICENSE_CACHE, JSON.stringify({ chave, validadaEm: new Date().toISOString() }), "utf8");
    } catch {}
    return chave;
  }

  if (resultado === "offline" && cache && cache.chave === chave) {
    console.log("⚠️  Sem conexão para validar a licença — usando a validação anterior desta máquina.");
    return chave;
  }

  if (resultado === "invalida") {
    if (cache && cache.chave === chave) {
      try { fs.unlinkSync(LICENSE_CACHE); } catch {}
    }
    console.error("\n❌ Licença inválida ou desativada.");
    console.error("   Confira a chave recebida por e-mail ou fale conosco: https://cnpjcomletras.com.br/diagnostico");
  } else {
    console.error("\n❌ Não foi possível validar a licença (sem conexão com o servidor).");
    console.error("   Verifique sua internet e tente novamente. A validação envia apenas a chave — nada do seu código.");
  }
  process.exit(3);
}

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  let reportPath = null;
  const reportIdx = args.indexOf("--report");
  if (reportIdx !== -1) {
    reportPath = args[reportIdx + 1] && !args[reportIdx + 1].startsWith("--") ? args[reportIdx + 1] : "relatorio-cnpj.html";
  }
  const licencaIdx = args.indexOf("--licenca");
  const licencaArg = licencaIdx !== -1 ? args[licencaIdx + 1] : null;
  const positional = args.filter(
    (a, i) =>
      !a.startsWith("--") &&
      !(reportIdx !== -1 && i === reportIdx + 1) &&
      !(licencaIdx !== -1 && i === licencaIdx + 1)
  );
  const target = positional[0] || ".";
  const root = path.resolve(target);

  if (!fs.existsSync(root)) {
    console.error(`Diretório não encontrado: ${root}`);
    process.exit(2);
  }

  if (reportPath) {
    await exigirLicenca(licencaArg);
  }

  const files = walk(root);
  const findings = files.flatMap(scanFile);
  const bySeverity = { alta: 0, media: 0 };
  findings.forEach((f) => bySeverity[f.severity]++);

  if (reportPath) {
    const out = path.resolve(reportPath);
    fs.writeFileSync(out, buildReportHtml(root, files.length, findings), "utf8");
    console.log(`Relatório executivo gerado: ${out}`);
    console.log(`Abra no navegador e use Ctrl+P → "Salvar como PDF".`);
  }

  if (asJson) {
    console.log(JSON.stringify({ root, filesScanned: files.length, findings }, null, 2));
  } else {
    console.log(`\ncnpj-scan — diagnóstico de prontidão para o CNPJ alfanumérico`);
    console.log(`Diretório: ${root}`);
    console.log(`Arquivos analisados: ${files.length}\n`);

    if (!findings.length) {
      console.log("✅ Nenhum padrão de risco encontrado em código que mencione CNPJ.");
      console.log("   (Isso não substitui testes — gere CNPJs de teste em https://cnpjcomletras.com.br)");
    } else {
      for (const f of findings) {
        const flag = f.severity === "alta" ? "🔴 ALTA " : "🟡 MÉDIA";
        console.log(`${flag} ${path.relative(root, f.file)}:${f.line}`);
        console.log(`   ${f.message}`);
        console.log(`   > ${f.excerpt}\n`);
      }
      console.log(`Resumo: ${bySeverity.alta} achado(s) de severidade ALTA, ${bySeverity.media} de MÉDIA.`);
      console.log(`Corrija os pontos acima e valide com massa de teste: https://cnpjcomletras.com.br`);
      if (!reportPath) {
        console.log(`\n💼 Precisa apresentar isso para a diretoria? O Relatório Executivo em PDF traduz`);
        console.log(`   estes achados em score de prontidão, plano de ação e esforço estimado:`);
        console.log(`   https://cnpjcomletras.com.br/diagnostico`);
      }
    }
  }
  process.exit(findings.some((f) => f.severity === "alta") ? 1 : 0);
}

main();
