# cnpj-scan Action — seu código está pronto para o CNPJ alfanumérico?

GitHub Action que varre o repositório atrás de padrões que **quebram com o CNPJ alfanumérico** ([IN RFB nº 2.229/2024](https://www.gov.br/receitafederal/pt-br/assuntos/noticias/2024/outubro/cnpj-tera-letras-e-numeros-a-partir-de-julho-de-2026)) — em vigor a partir de 31/07/2026:

- 🗄️ Colunas numéricas para CNPJ (`BIGINT`, `NUMERIC(14)`) — não salvam letras
- 🧾 Regex só-dígitos (`^\d{14}$`) — rejeitam CNPJs válidos
- 🔢 Conversões para número (`parseInt(cnpj)`, `cnpj = Long.parseLong(...)`, `CAST`) — corrompem silenciosamente
- 🎭 Máscaras só-dígitos e limpezas que apagam letras

Rode em cada pull request e impeça que uma regressão volte para produção.

## Uso

```yaml
name: cnpj-scan
on: [pull_request]

jobs:
  cnpj-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: andrehenrique311085-debug/cnpj-scan-action@v1
        with:
          path: "."        # diretório a analisar (padrão: raiz)
          fail-on: "alta"  # alta | media | never
```

## Inputs

| Input | Padrão | Descrição |
|---|---|---|
| `path` | `.` | Diretório a analisar, relativo à raiz do repositório |
| `fail-on` | `alta` | Quando falhar o build: `alta` (só severidade ALTA), `media` (ALTA ou MÉDIA), `never` (só reporta) |

## Como funciona

Análise 100% estática e **100% local no runner** — nenhum código é enviado para servidor nenhum. Um achado só é reportado se a linha (ou o contexto próximo) mencionar CNPJ, o que mantém o ruído baixo. Cada achado sai no log com arquivo, linha e trecho.

A ferramenta por trás é o [cnpj-scan](https://cnpjcomletras.com.br/diagnostico), do [CNPJcomLetras.com.br](https://cnpjcomletras.com.br) — que também oferece:

- 🔍 [Validador online + gerador de massa de teste](https://cnpjcomletras.com.br) (grátis)
- 📚 [Guia de adaptação de sistemas](https://cnpjcomletras.com.br/como-adaptar-sistema-cnpj-alfanumerico)
- 📊 Relatório Executivo de Prontidão em PDF (score, plano de ação priorizado) — [saiba mais](https://cnpjcomletras.com.br/diagnostico)

## Exemplo de saída

```
🔴 ALTA  schema.sql:12
   Coluna/tipo numérico não comporta letras. Migre para VARCHAR(14)/texto.
   > CREATE TABLE clientes (cnpj BIGINT NOT NULL);

cnpj-scan: 214 arquivo(s) analisado(s) — 1 achado(s) ALTA, 0 MÉDIA.
❌ O código contém padrões que quebram com o CNPJ alfanumérico.
```

## Licença

[MIT](./LICENSE) © [CNPJcomLetras.com.br](https://cnpjcomletras.com.br)
