# Job Searcher

Busca vagas públicas no LinkedIn, filtra as que combinam com o perfil descrito em
[interests.md](interests.md) e grava os resultados em um CSV com as colunas:

```csv
Empresa,Título_Vaga,Salário,Link_da_vaga
```

O filtro é híbrido: palavras-chave descartam o óbvio e um LLM (compatível com a API
OpenAI) lê a descrição e atribui uma nota de aderência. Sem chave de LLM, o sistema
funciona apenas com as palavras-chave.

## Requisitos

- Node.js 20 ou superior (não há dependências externas).

## Instalação

```bash
cp .env.example .env
```

Edite o `.env` e preencha `LLM_API_KEY`. Para usar apenas as regras de palavras-chave,
deixe a chave em branco e rode com `--keywords-only` ou defina `FILTER_MODE="keywords"`.

## Preencher o interests.md

Cada seção é uma lista com um item por linha. Linhas de exemplo começando com `ex.:`
(em itálico) são ignoradas até você substituí-las. Seções vazias não entram no filtro.

- `## Cargos desejados` — vira as buscas no LinkedIn. É obrigatório ter ao menos um.
- `## Tecnologias e habilidades`, `## Senioridade`, `## Idiomas das vagas` — sinais de aderência.
- `## Localização e modalidade` — país, cidades e modalidade (Remoto/Híbrido/Presencial).
  Se nada for informado, o padrão é Brasil remoto.
- `## Tipo de contrato` — CLT, PJ etc. (usado pelo LLM).
- `## Faixa salarial` — mínimo, moeda e período. O filtro por salário só é aplicado
  quando a vaga informa um valor na mesma moeda.
- `## Palavras-chave que reforçam a aderência` — ex.: `fintech`, `produto`.
- `## Palavras-chave que excluem a vaga` — ex.: `estágio`, `vendas`.
- `## Empresas de interesse` / `## Empresas a evitar`.
- `## Sobre mim` e `## Observações` — contexto livre enviado ao LLM.

## Uso

```bash
npm start
```

O CSV padrão é `vagas.csv`, na raiz do projeto. Nas próximas execuções, vagas já
gravadas (mesmo link/ID) são ignoradas, então o arquivo só cresce com vagas novas.

Opções:

```bash
npm run dry -- --limit=10        # simula, mostra a tabela e não grava
npm start -- --keywords-only     # ignora o LLM nesta execução
npm start -- --pages=2           # duas páginas de resultados por cargo
npm start -- --limit=15          # avalia no máximo 15 vagas a fundo
npm start -- --interests=outro.md --csv=resultados.csv
npm start -- --help
```

## Como funciona

1. Lê o `interests.md` e monta uma busca por cargo no endpoint público de vagas do LinkedIn.
2. Aplica os filtros de modalidade e período (`SEARCH_DAYS_BACK`).
3. Remove vagas que já estão no CSV.
4. Abre cada vaga nova para obter descrição e faixa salarial.
5. Descarta empresas/palavras-chave excluídas e vagas abaixo do salário mínimo.
6. No modo híbrido, exige algum sinal positivo (cargo, skills, keywords ou empresa) e
   então pede ao LLM uma nota de 0 a 100 com justificativa.
7. Grava as aprovadas no CSV, extraindo o salário da página (ou do texto da vaga via LLM).
   Quando não há valor explícito, grava `Não informado`.

## Configuração (.env)

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `LLM_API_KEY` | — | Chave da API no formato OpenAI. |
| `LLM_BASE_URL` | `https://api.deepseek.com/v1` | Endpoint compatível com `/chat/completions`. |
| `LLM_MODEL` | `deepseek-v4-flash` | Modelo usado no filtro. |
| `FILTER_MODE` | `hybrid` | `hybrid`, `keywords` ou `llm`. |
| `MATCH_THRESHOLD` | `70` | Nota mínima para aceitar a vaga. |
| `SEARCH_DAYS_BACK` | `7` | Janela de recência da busca. |
| `PAGES_PER_QUERY` | `1` | Páginas por cargo (10 vagas por página). |
| `MAX_JOBS_PER_QUERY` | `0` | Limite de vagas por cargo; `0` = todas as páginas configuradas. |
| `MAX_JOBS_TOTAL` | `0` | Limite de vagas avaliadas a fundo; `0` = sem limite. |
| `REQUEST_DELAY_MS` | `1500` | Intervalo entre requisições ao LinkedIn. |
| `INTERESTS_FILE` | `interests.md` | Arquivo de perfil. |
| `OUTPUT_CSV` | `vagas.csv` | Arquivo de saída. |

## Agendamento

Exemplo de cron diário às 9h:

```cron
0 9 * * * cd /caminho/do/job-searcher && /usr/bin/env node index.js >> job-searcher.log 2>&1
```

## Aviso e limitações

- O sistema usa o endpoint **público** de vagas do LinkedIn, sem login. O LinkedIn não
  oferece uma API pública oficial para isso e pode bloquear/limitar requisições
  (HTTP 429/999). Use com moderação, para uso pessoal, e ciente dos Termos de Uso.
- A estrutura HTML do LinkedIn pode mudar. Se os resultados começarem a vir vazios,
  os parsers em [src/linkedin.js](src/linkedin.js) precisam de ajuste.
- Salários só aparecem quando a empresa os publica; muitas vagas ficarão como
  `Não informado`.
- O filtro por LLM envia título, empresa, local, salário e descrição para o provedor
  configurado. Não envie dados sensíveis no `interests.md`.

## Testes

```bash
npm test
```

Os testes cobrem o parser do `interests.md`, os parsers de HTML do LinkedIn, o filtro
por regras e a leitura/escrita/deduplicação do CSV. Nenhum teste acessa a rede.
