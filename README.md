# Job Searcher

Busca vagas públicas no LinkedIn, filtra as que combinam com o perfil descrito em
[interests.md](interests.md) e grava os resultados em um CSV com as colunas:

```csv
Empresa,Título_Vaga,Salário,Tecnologias_Pedidas,Link_da_vaga
```

O filtro é híbrido: palavras-chave descartam o óbvio e um LLM (compatível com a API
OpenAI) lê a descrição e atribui uma nota de aderência. Sem chave de LLM, o sistema
funciona apenas com as palavras-chave.

O LLM trata versões específicas e frameworks do mesmo ecossistema como relacionados: se
a vaga pede “Java 17+” e o perfil tem Java, ou pede “Spring Boot” e o perfil tem
Java/Spring, isso conta como aderência. As tecnologias pedidas pela vaga também são
extraídas para a coluna `Tecnologias_Pedidas`, por uma lista de linguagens, frameworks,
bancos, clouds e ferramentas que lê o título e a descrição do anúncio. A extração
funciona em qualquer modo de filtro e é complementada pelo campo `tecnologias` do LLM
quando ele está disponível.

## Requisitos

- Node.js 22 ou superior. A extração de texto de PDF usa o pacote `unpdf`.

## Instalação

```bash
npm install
cp .env.example .env
```

Edite o `.env` e preencha `LLM_API_KEY`. Para usar apenas as regras de palavras-chave,
deixe a chave em branco e rode com `--keywords-only` ou defina `FILTER_MODE="keywords"`.

## Preencher o interests.md

Cada seção é uma lista com um item por linha. Linhas de exemplo começando com `ex.:`
(em itálico) são ignoradas até você substituí-las. Você pode manter o itálico ao
preencher os valores reais; o parser remove a formatação. Seções vazias não entram no
filtro.

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

## Prompt do sistema (editável)

O comportamento do LLM é definido em [system-prompt.md](system-prompt.md), não no código.
Edite o arquivo livremente; o conteúdo inteiro (já sem espaços nas pontas) é enviado como
mensagem de sistema a cada avaliação. O arquivo é lido no início de cada execução.

Para usar outro arquivo, defina `SYSTEM_PROMPT_FILE` no `.env` ou passe
`--system-prompt=PATH`. O arquivo não pode ficar vazio. Escreva apenas o prompt desejado,
sem comentários ou cabeçalhos: tudo o que estiver no arquivo será enviado ao LLM.

## Currículo em PDF (opcional)

Aponte `RESUME_PATH` para um arquivo PDF ou para um diretório com um ou mais PDFs:

```bash
RESUME_PATH="/caminho/para/curriculos"
```

O texto extraído é enviado ao LLM junto com o `interests.md`, melhorando a avaliação de
aderência. Se houver vários PDFs no diretório, eles são concatenados em ordem alfabética
e o total é limitado por `RESUME_MAX_CHARS` (padrão 8000 caracteres). O mesmo caminho
pode ser passado pela linha de comando com `--resume=PATH`.

No modo `keywords` o currículo não é usado, porque não há LLM. PDFs escaneados (somente
imagem) não têm texto extraível e geram um aviso; nesse caso o sistema segue sem o
currículo.

## Uso

```bash
npm start
```

O CSV padrão é `vagas.csv`, na raiz do projeto. Cada vaga aceita é gravada
imediatamente, então uma interrupção no meio da execução não perde o que já foi
aprovado. Nas próximas execuções, vagas já gravadas (mesmo link/ID) são ignoradas, então
o arquivo só cresce com vagas novas. CSVs antigos com as quatro colunas originais são
migrados automaticamente na próxima gravação; as linhas antigas recebem `Não informado`
em `Tecnologias_Pedidas` e podem ser preenchidas com o backfill descrito abaixo.

Opções:

```bash
npm run dry -- --limit=10        # simula, mostra a tabela e não grava
npm start -- --keywords-only     # ignora o LLM nesta execução
npm start -- --pages=2           # duas páginas novas por cargo nesta execução
npm start -- --reset-pages       # volta todas as buscas para a página 1
npm start -- --limit=15          # avalia no máximo 15 vagas a fundo
npm start -- --interests=outro.md --csv=resultados.csv
npm start -- --system-prompt=meu-prompt.md
npm start -- --state=progresso.json
npm start -- --resume=/caminho/do/curriculo.pdf
npm start -- --help
```

## Paginação entre execuções

O LinkedIn devolve 10 vagas por página. O sistema guarda, para cada combinação de cargo,
local, modalidade e janela de dias, a próxima página a buscar em
`.job-searcher-state.json` (`SEARCH_STATE_FILE`). Assim, com o padrão
`PAGES_PER_QUERY=1`, a primeira execução lê a página 1, a seguinte continua na página 2,
e assim por diante — sem repetir as mesmas vagas a cada rodada.

- `--pages=N` define quantas páginas novas cada execução consome por cargo.
- Ao chegar ao fim dos resultados (página com menos de 10 vagas), o cursor volta para a
  página 1 na execução seguinte, para capturar vagas novas.
- `--reset-pages` (ou apagar `.job-searcher-state.json`) recomeça tudo da página 1.
- `--dry-run` não altera o cursor, então simulações repetidas mostram as mesmas páginas.
- O progresso é local e não é versionado no git.

## Tecnologias pedidas e backfill

A coluna `Tecnologias_Pedidas` não depende do LLM: o sistema procura no título e na
descrição da vaga nomes conhecidos de linguagens, frameworks, bancos, clouds e
ferramentas (Java, .NET, Spring Boot, Node.js, PostgreSQL, AWS, Docker etc.). Versões
são normalizadas — “Java 17” vira `Java` e “.NET 8” vira `.NET` — e nomes repetidos são
removidos. Quando o LLM está ativo, o que ele devolve em `tecnologias` complementa a
lista com itens que não estão no catálogo. Se nada for encontrado, a célula recebe
`Não informado`.

O catálogo fica em [src/technologies.js](src/technologies.js). Para reconhecer uma
tecnologia nova, acrescente uma entrada com o nome canônico e as expressões regulares
que a identificam. Os testes ficam em [test/technologies.test.js](test/technologies.test.js).

Para preencher as linhas antigas do CSV que ainda estão como `Não informado`, use o
backfill. Ele abre cada vaga no LinkedIn, lê a descrição, extrai as tecnologias e salva
o CSV após cada linha atualizada:

```bash
npm run backfill-tech -- --dry-run --limit=20   # simula em 20 linhas, sem gravar
npm run backfill-tech                          # preenche todas as linhas pendentes
```

O backfill ignora linhas que já têm tecnologias e vagas sem link válido. Se o LinkedIn
limitar as requisições, ele para após cinco falhas seguidas; o que já foi atualizado
fica salvo. Use `--delay=MS` para aumentar o intervalo e `--csv=PATH` para outro arquivo.

## Como funciona

1. Lê o prompt do sistema, o `interests.md` e, se `RESUME_PATH` estiver configurado,
   extrai o texto dos PDFs.
2. Monta uma busca por cargo no endpoint público de vagas do LinkedIn.
3. Aplica os filtros de modalidade e período (`SEARCH_DAYS_BACK`) e começa da página
   salva para aquela busca.
4. Remove vagas que já estão no CSV.
5. Abre cada vaga nova para obter descrição e faixa salarial.
6. Descarta empresas/palavras-chave excluídas e vagas abaixo do salário mínimo.
7. No modo híbrido, exige algum sinal positivo (cargo, skills, keywords ou empresa) e
   então pede ao LLM uma nota de 0 a 100 com justificativa, considerando o perfil e o
   currículo. O prompt orienta a considerar versões e frameworks do mesmo ecossistema
   como relacionados.
8. Grava cada vaga aprovada imediatamente no CSV, extraindo o salário da página (ou do
   texto da vaga via LLM) e as tecnologias pedidas pela vaga. A coluna
   `Tecnologias_Pedidas` é montada a partir do título/descrição em qualquer modo de
   filtro e recebe os itens extras que o LLM devolver. Quando não há valor explícito,
   grava `Não informado`.

## Configuração (.env)

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `LLM_API_KEY` | — | Chave da API no formato OpenAI. |
| `LLM_BASE_URL` | `https://api.deepseek.com/v1` | Endpoint compatível com `/chat/completions`. |
| `LLM_MODEL` | `deepseek-v4-flash` | Modelo usado no filtro. |
| `SYSTEM_PROMPT_FILE` | `system-prompt.md` | Arquivo com o prompt do sistema. |
| `RESUME_PATH` | — | Arquivo PDF ou diretório com currículos (opcional). |
| `RESUME_MAX_CHARS` | `8000` | Limite de caracteres do currículo no prompt. |
| `FILTER_MODE` | `hybrid` | `hybrid`, `keywords` ou `llm`. |
| `MATCH_THRESHOLD` | `70` | Nota mínima para aceitar a vaga. |
| `SEARCH_DAYS_BACK` | `7` | Janela de recência da busca. |
| `PAGES_PER_QUERY` | `1` | Páginas novas por cargo em cada execução. |
| `MAX_JOBS_PER_QUERY` | `0` | Limite de vagas por cargo; `0` = todas as páginas configuradas. |
| `MAX_JOBS_TOTAL` | `0` | Limite de vagas avaliadas a fundo; `0` = sem limite. |
| `REQUEST_DELAY_MS` | `1500` | Intervalo entre requisições ao LinkedIn. |
| `INTERESTS_FILE` | `interests.md` | Arquivo de perfil. |
| `OUTPUT_CSV` | `vagas.csv` | Arquivo de saída. |
| `SEARCH_STATE_FILE` | `.job-searcher-state.json` | Progresso da paginação entre execuções. |

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
- A paginação depende da ordenação do LinkedIn: vagas novas podem deslocar resultados
  entre execuções, causando pequenas repetições ou saltos. Vagas já aceitas no CSV são
  sempre ignoradas por ID.
- O filtro por LLM envia título, empresa, local, salário, descrição, o texto do
  currículo e o conteúdo do `system-prompt.md` para o provedor configurado. Não use o
  recurso se não quiser compartilhar esses dados; não coloque informações sensíveis no
  `interests.md` nem no prompt do sistema.

## Testes

```bash
npm test
```

Os testes cobrem o parser do `interests.md`, os parsers de HTML do LinkedIn, a paginação
e o cursor entre execuções, o filtro por regras, o carregamento do prompt do sistema, a
extração de currículo em PDF, a extração determinística de tecnologias, o backfill do
CSV e a leitura/escrita/deduplicação do CSV. Nenhum teste acessa a rede.
