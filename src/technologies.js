'use strict';

const { normalizeText } = require('./util');

// Catálogo de linguagens, frameworks, bancos, clouds e ferramentas.
// A ordem aqui não importa: o resultado é ordenado pela posição em que a
// tecnologia aparece no texto da vaga. Padrões mais específicos vêm antes dos
// genéricos para evitar duplicatas (ex.: "Spring Boot" não gera "Spring").
const CATALOG = [
  // Linguagens
  { name: 'C#', patterns: [/(?<![a-z0-9_])c#(?![a-z0-9_])/i] },
  { name: 'C++', patterns: [/(?<![a-z0-9_])c\+\+(?![a-z0-9_])/i] },
  { name: 'C', patterns: [/(?<![A-Za-z0-9+#_-])C(?![A-Za-z0-9+#_-])/] },
  {
    name: 'Java',
    patterns: [/\bjava\b/i],
  },
  {
    name: 'JavaScript',
    patterns: [/\bjavascript\b/i, /(?<![.\w])js\b/i],
  },
  {
    name: 'TypeScript',
    patterns: [/\btypescript\b/i],
  },
  {
    name: 'Python',
    patterns: [/\bpython\b/i],
  },
  {
    name: 'Node.js',
    patterns: [/\bnode(?:\.?js)?\b/i],
  },
  {
    name: 'Go',
    patterns: [/\bgolang\b/i, /\bGo\b/, /\bGO\b/],
  },
  {
    name: 'Rust',
    patterns: [/\bRust\b/],
  },
  {
    name: 'Ruby',
    patterns: [/\bruby\b(?!\s+on\s+rails\b)/i],
  },
  {
    name: 'Ruby on Rails',
    patterns: [/\bruby\s+on\s+rails\b/i, /\brails\b/i],
  },
  {
    name: 'PHP',
    patterns: [/\bphp\b/i],
  },
  {
    name: 'Kotlin',
    patterns: [/\bkotlin\b/i],
  },
  {
    name: 'Swift',
    patterns: [/\bSwift\b/],
  },
  {
    name: 'Scala',
    patterns: [/\bscala\b/i],
  },
  {
    name: 'Objective-C',
    patterns: [/\bobjective\s*-?\s*c\b/i],
  },
  {
    name: 'Dart',
    patterns: [/\bDart\b/],
  },
  {
    name: 'Elixir',
    patterns: [/\belixir\b/i],
  },
  {
    name: 'Erlang',
    patterns: [/\berlang\b/i],
  },
  {
    name: 'Clojure',
    patterns: [/\bclojure\b/i],
  },
  {
    name: 'Haskell',
    patterns: [/\bhaskell\b/i],
  },
  {
    name: 'Lua',
    patterns: [/\bLua\b/],
  },
  {
    name: 'Perl',
    patterns: [/\bperl\b/i],
  },
  {
    name: 'Julia',
    patterns: [/\bJulia\b/],
  },
  {
    name: 'MATLAB',
    patterns: [/\bmatlab\b/i],
  },
  {
    name: 'Fortran',
    patterns: [/\bfortran\b/i],
  },
  {
    name: 'Groovy',
    patterns: [/\bgroovy\b/i],
  },
  {
    name: 'COBOL',
    patterns: [/\bcobol\b/i],
  },
  {
    name: 'Delphi',
    patterns: [/\bdelphi\b/i],
  },
  {
    name: 'Visual Basic',
    patterns: [/\bvisual\s+basic\b/i],
  },
  {
    name: 'VB.NET',
    patterns: [/\bvb\.net\b/i],
  },
  {
    name: 'F#',
    patterns: [/(?<![a-z0-9_])f#(?![a-z0-9_])/i],
  },
  {
    name: 'R',
    patterns: [/\brstudio\b/i, /\br\s+studio\b/i, /\blinguagem\s+r\b/i],
  },

  // Frameworks e bibliotecas
  {
    name: 'Spring Boot',
    patterns: [/\bspring\s*boot\b/i],
  },
  {
    name: 'Spring Cloud',
    patterns: [/\bspring\s+cloud\b/i],
  },
  {
    name: 'Spring Security',
    patterns: [/\bspring\s+security\b/i],
  },
  {
    name: 'Spring Data',
    patterns: [/\bspring\s+data\b/i],
  },
  {
    name: 'Spring Batch',
    patterns: [/\bspring\s+batch\b/i],
  },
  {
    name: 'Spring MVC',
    patterns: [/\bspring\s+mvc\b/i],
  },
  {
    name: 'Spring WebFlux',
    patterns: [/\bspring\s+web\s*flux\b/i],
  },
  {
    name: 'Spring',
    patterns: [
      /\bSpring\b(?!\s+(?:[Bb]oot|[Cc]loud|[Ss]ecurity|[Dd]ata|[Bb]atch|[Mm][Vv][Cc]|[Ww]eb\s*[Ff]lux|20\d{2})\b)/,
    ],
  },
  {
    name: 'Java EE',
    patterns: [/\bjava\s*ee\b/i],
  },
  {
    name: 'Jakarta EE',
    patterns: [/\bjakarta\s*ee\b/i],
  },
  {
    name: 'ASP.NET Core',
    patterns: [/\basp\.net\s*core\b/i],
  },
  {
    name: 'ASP.NET',
    patterns: [/\basp\.net\b(?!\s*core\b)/i],
  },
  {
    name: '.NET',
    patterns: [/(?<![a-z0-9_])\.net(?![a-z0-9_])/i, /\bdotnet\b/i],
  },
  {
    name: 'Django',
    patterns: [/\bdjango\b/i],
  },
  {
    name: 'Flask',
    patterns: [/\bflask\b/i],
  },
  {
    name: 'FastAPI',
    patterns: [/\bfastapi\b/i],
  },
  {
    name: 'Laravel',
    patterns: [/\blaravel\b/i],
  },
  {
    name: 'Symfony',
    patterns: [/\bsymfony\b/i],
  },
  {
    name: 'React Native',
    patterns: [/\breact\s+native\b/i],
  },
  {
    name: 'React',
    patterns: [/\breact\b(?!\s+native\b)/i],
  },
  {
    name: 'Angular',
    patterns: [/\bangular(?:\.?js)?\b/i],
  },
  {
    name: 'Vue.js',
    patterns: [/\bvue(?:\.?js)?\b/i],
  },
  {
    name: 'Next.js',
    patterns: [/\bnext\.?js\b/i],
  },
  {
    name: 'NestJS',
    patterns: [/\bnest\.?js\b/i],
  },
  {
    name: 'Nuxt',
    patterns: [/\bnuxt(?:\.?js)?\b/i],
  },
  {
    name: 'Svelte',
    patterns: [/\bsvelte(?:kit)?\b/i],
  },
  {
    name: 'Express',
    patterns: [/\bExpress(?:\.js)?\b/, /\bexpress\.js\b/i],
  },
  {
    name: 'jQuery',
    patterns: [/\bjquery\b/i],
  },
  {
    name: 'Bootstrap',
    patterns: [/\bBootstrap\b/, /\bbootstrap\.js\b/i],
  },
  {
    name: 'Tailwind CSS',
    patterns: [/\btailwind(?:\s*css)?\b/i],
  },
  {
    name: 'HTML',
    patterns: [/\bhtml5?\b/i],
  },
  {
    name: 'CSS',
    patterns: [/\bcss3?\b/i],
  },
  {
    name: 'Sass',
    patterns: [/\b(?:sass|scss)\b/i],
  },
  {
    name: 'Flutter',
    patterns: [/\bflutter\b/i],
  },
  {
    name: 'Quarkus',
    patterns: [/\bquarkus\b/i],
  },
  {
    name: 'Micronaut',
    patterns: [/\bmicronaut\b/i],
  },
  {
    name: 'Hibernate',
    patterns: [/\bhibernate\b/i],
  },
  {
    name: 'JPA',
    patterns: [/\bjpa\b/i],
  },
  {
    name: 'Entity Framework',
    patterns: [/\bentity\s+framework\b/i],
  },
  {
    name: 'LINQ',
    patterns: [/\blinq\b/i],
  },
  {
    name: 'Blazor',
    patterns: [/\bblazor\b/i],
  },
  {
    name: 'WPF',
    patterns: [/\bwpf\b/i],
  },
  {
    name: 'WinForms',
    patterns: [/\bwin\s*forms\b/i],
  },
  {
    name: 'Xamarin',
    patterns: [/\bxamarin\b/i],
  },
  {
    name: 'MAUI',
    patterns: [/\bmaui\b/i],
  },
  {
    name: 'Android',
    patterns: [/\bandroid\b/i],
  },
  {
    name: 'iOS',
    patterns: [/\bios\b/i],
  },

  // Bancos de dados
  {
    name: 'SQL',
    patterns: [/(?<!pl\/)(?<!t-)\bsql\b(?!\s*server\b)/i],
  },
  {
    name: 'PL/SQL',
    patterns: [/\bpl\s*\/\s*sql\b/i],
  },
  {
    name: 'T-SQL',
    patterns: [/\bt\s*-\s*sql\b/i],
  },
  {
    name: 'NoSQL',
    patterns: [/\bnosql\b/i],
  },
  {
    name: 'SQL Server',
    patterns: [/\bsql\s*server\b/i, /\bmssql\b/i],
  },
  {
    name: 'PostgreSQL',
    patterns: [/\bpostgres(?:ql)?\b/i],
  },
  {
    name: 'MySQL',
    patterns: [/\bmysql\b/i],
  },
  {
    name: 'MariaDB',
    patterns: [/\bmariadb\b/i],
  },
  {
    name: 'Oracle',
    patterns: [/\boracle\b/i],
  },
  {
    name: 'MongoDB',
    patterns: [/\bmongo(?:db)?\b/i],
  },
  {
    name: 'Cassandra',
    patterns: [/\bcassandra\b/i],
  },
  {
    name: 'DynamoDB',
    patterns: [/\bdynamo\s*db\b/i],
  },
  {
    name: 'Redis',
    patterns: [/\bredis\b/i],
  },
  {
    name: 'Elasticsearch',
    patterns: [/\belastic\s*search\b/i],
  },
  {
    name: 'OpenSearch',
    patterns: [/\bopen\s*search\b/i],
  },
  {
    name: 'SQLite',
    patterns: [/\bsqlite\b/i],
  },
  {
    name: 'Neo4j',
    patterns: [/\bneo4j\b/i],
  },
  {
    name: 'Firebase',
    patterns: [/\bfirebase\b/i],
  },
  {
    name: 'Supabase',
    patterns: [/\bsupabase\b/i],
  },

  // Cloud e DevOps
  {
    name: 'AWS',
    patterns: [/\baws\b/i, /\bamazon\s+web\s+services\b/i],
  },
  {
    name: 'AWS Lambda',
    patterns: [/\baws\s+lambda\b/i],
  },
  {
    name: 'Azure',
    patterns: [/\bazure\b/i, /\bmicrosoft\s+azure\b/i],
  },
  {
    name: 'GCP',
    patterns: [/\bgcp\b/i, /\bgoogle\s+cloud(?:\s+platform)?\b/i],
  },
  {
    name: 'Docker',
    patterns: [/\bdocker\b/i],
  },
  {
    name: 'Kubernetes',
    patterns: [/\bkubernetes\b/i, /\bk8s\b/i],
  },
  {
    name: 'Terraform',
    patterns: [/\bterraform\b/i],
  },
  {
    name: 'Ansible',
    patterns: [/\bansible\b/i],
  },
  {
    name: 'Jenkins',
    patterns: [/\bjenkins\b/i],
  },
  {
    name: 'GitLab CI',
    patterns: [/\bgitlab\s*ci\b/i],
  },
  {
    name: 'GitHub Actions',
    patterns: [/\bgithub\s*actions\b/i],
  },
  {
    name: 'Helm',
    patterns: [/\bhelm\b/i],
  },
  {
    name: 'OpenShift',
    patterns: [/\bopenshift\b/i],
  },
  {
    name: 'Linux',
    patterns: [/\blinux\b/i],
  },
  {
    name: 'Git',
    patterns: [/\bgit\b/i],
  },
  {
    name: 'Bash',
    patterns: [/\bbash\b/i, /\bshell\s+script\b/i],
  },
  {
    name: 'PowerShell',
    patterns: [/\bpowershell\b/i],
  },
  {
    name: 'Maven',
    patterns: [/\bmaven\b/i],
  },
  {
    name: 'Gradle',
    patterns: [/\bgradle\b/i],
  },
  {
    name: 'Nginx',
    patterns: [/\bnginx\b/i],
  },
  {
    name: 'Tomcat',
    patterns: [/\btomcat\b/i],
  },

  // Mensageria e integração
  {
    name: 'Kafka',
    patterns: [/\bkafka\b/i],
  },
  {
    name: 'RabbitMQ',
    patterns: [/\brabbitmq\b/i],
  },
  {
    name: 'ActiveMQ',
    patterns: [/\bactivemq\b/i],
  },
  {
    name: 'REST',
    patterns: [/\brestful\b/i, /\bREST\b/],
  },
  {
    name: 'GraphQL',
    patterns: [/\bgraphql\b/i],
  },
  {
    name: 'gRPC',
    patterns: [/\bgrpc\b/i],
  },
  {
    name: 'SOAP',
    patterns: [/\bsoap\b/i],
  },
  {
    name: 'Microsserviços',
    patterns: [/\bmicrosservi[cç]os?\b/i, /\bmicroservices?\b/i, /\bmicro-servi[cç]os?\b/i],
  },
  {
    name: 'CI/CD',
    patterns: [/\bci\s*\/\s*cd\b/i, /\bci\s+cd\b/i],
  },
  {
    name: 'DevOps',
    patterns: [/\bdevops\b/i],
  },
  {
    name: 'OAuth',
    patterns: [/\boauth\b/i],
  },
  {
    name: 'JWT',
    patterns: [/\bjwt\b/i],
  },
  {
    name: 'SAML',
    patterns: [/\bsaml\b/i],
  },
  {
    name: 'LDAP',
    patterns: [/\bldap\b/i],
  },

  // Testes
  {
    name: 'Jest',
    patterns: [/\bjest\b/i],
  },
  {
    name: 'Cypress',
    patterns: [/\bcypress\b/i],
  },
  {
    name: 'Selenium',
    patterns: [/\bselenium\b/i],
  },
  {
    name: 'Playwright',
    patterns: [/\bplaywright\b/i],
  },
  {
    name: 'JUnit',
    patterns: [/\bjunit\b/i],
  },
  {
    name: 'Pytest',
    patterns: [/\bpytest\b/i],
  },
  {
    name: 'Mockito',
    patterns: [/\bmockito\b/i],
  },

  // Dados, BI e plataformas
  {
    name: 'Spark',
    patterns: [/\bapache\s+spark\b/i, /\bSpark\b/],
  },
  {
    name: 'Hadoop',
    patterns: [/\bhadoop\b/i],
  },
  {
    name: 'Airflow',
    patterns: [/\bairflow\b/i],
  },
  {
    name: 'Databricks',
    patterns: [/\bdatabricks\b/i],
  },
  {
    name: 'Snowflake',
    patterns: [/\bsnowflake\b/i],
  },
  {
    name: 'Pandas',
    patterns: [/\bpandas\b/i],
  },
  {
    name: 'NumPy',
    patterns: [/\bnumpy\b/i],
  },
  {
    name: 'TensorFlow',
    patterns: [/\btensorflow\b/i],
  },
  {
    name: 'PyTorch',
    patterns: [/\bpytorch\b/i],
  },
  {
    name: 'Power BI',
    patterns: [/\bpower\s*bi\b/i],
  },
  {
    name: 'Tableau',
    patterns: [/\btableau\b/i],
  },
  {
    name: 'SAP',
    patterns: [/\bSAP\b/],
  },
  {
    name: 'Salesforce',
    patterns: [/\bsalesforce\b/i],
  },
  {
    name: 'ServiceNow',
    patterns: [/\bservicenow\b/i],
  },
  {
    name: 'Jira',
    patterns: [/\bjira\b/i],
  },

  // Observabilidade, infraestrutura como código e ferramentas corporativas
  {
    name: 'Splunk',
    patterns: [/\bsplunk\b/i],
  },
  {
    name: 'Grafana',
    patterns: [/\bgrafana\b/i],
  },
  {
    name: 'Prometheus',
    patterns: [/\bprometheus\b/i],
  },
  {
    name: 'Datadog',
    patterns: [/\bdatadog\b/i],
  },
  {
    name: 'New Relic',
    patterns: [/\bnew\s+relic\b/i],
  },
  {
    name: 'Dynatrace',
    patterns: [/\bdynatrace\b/i],
  },
  {
    name: 'Zabbix',
    patterns: [/\bzabbix\b/i],
  },
  {
    name: 'CloudWatch',
    patterns: [/\bcloud\s*watch\b/i],
  },
  {
    name: 'Kibana',
    patterns: [/\bkibana\b/i],
  },
  {
    name: 'Logstash',
    patterns: [/\blogstash\b/i],
  },
  {
    name: 'OpenTelemetry',
    patterns: [/\bopen\s*telemetry\b/i],
  },
  {
    name: 'Sentry',
    patterns: [/\bsentry\b/i],
  },
  {
    name: 'CloudFormation',
    patterns: [/\bcloud\s*formation\b/i],
  },
  {
    name: 'Pulumi',
    patterns: [/\bpulumi\b/i],
  },
  {
    name: 'CircleCI',
    patterns: [/\bcircle\s*ci\b/i],
  },
  {
    name: 'ABAP',
    patterns: [/\babap\b/i],
  },
  {
    name: 'Mulesoft',
    patterns: [/\bmulesoft\b/i],
  },
  {
    name: 'Camunda',
    patterns: [/\bcamunda\b/i],
  },

  // Metodologias ágeis (frequentemente listadas como requisito)
  {
    name: 'Scrum',
    patterns: [/\bscrum\b/i],
  },
  {
    name: 'Kanban',
    patterns: [/\bkanban\b/i],
  },
];

function firstMatchIndex(text, patterns) {
  let best = -1;
  for (const pattern of patterns) {
    const index = text.search(pattern);
    if (index !== -1 && (best === -1 || index < best)) best = index;
  }
  return best;
}

function technologyKey(value) {
  return normalizeText(value).replace(/[.\-_/]/g, '');
}

function cleanTechnology(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Extrai tecnologias explicitamente citadas em um texto, na ordem em que
 * aparecem. Retorna nomes canônicos (ex.: "nodejs" -> "Node.js").
 */
function extractTechnologies(text) {
  const source = String(text || '');
  if (!source.trim()) return [];

  const matches = [];
  for (const entry of CATALOG) {
    const index = firstMatchIndex(source, entry.patterns);
    if (index !== -1) matches.push({ name: entry.name, index });
  }

  matches.sort((a, b) => a.index - b.index);

  const seen = new Set();
  const result = [];
  for (const match of matches) {
    const key = technologyKey(match.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(match.name);
  }
  return result;
}

function asList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return value.split(/[;,]/);
  return [];
}

/**
 * Junta listas de tecnologias, canonicalizando o que o LLM devolveu e
 * removendo duplicatas. Itens desconhecidos do catálogo são preservados.
 */
function mergeTechnologies(...lists) {
  const seen = new Set();
  const result = [];

  for (const list of lists) {
    for (const raw of asList(list)) {
      const text = cleanTechnology(raw);
      if (!text) continue;

      const found = extractTechnologies(text);
      const values = found.length ? found : [text];

      for (const value of values) {
        const key = technologyKey(value);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        result.push(value);
      }
    }
  }

  return result;
}

function formatTechnologies(list) {
  return list && list.length ? list.join(', ') : 'Não informado';
}

/**
 * Tecnologias de uma vaga: extração determinística do título/descrição,
 * complementada pelo campo "tecnologias" do veredito do LLM quando existir.
 */
function technologiesForJob(job, verdict) {
  const source = [job && job.title, job && job.description].filter(Boolean).join('\n');
  return formatTechnologies(
    mergeTechnologies(extractTechnologies(source), verdict && verdict.tecnologias)
  );
}

module.exports = {
  CATALOG,
  extractTechnologies,
  mergeTechnologies,
  formatTechnologies,
  technologiesForJob,
};
