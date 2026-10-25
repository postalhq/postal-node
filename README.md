# postal-so

SDK e CLI oficiais do [Postal](https://postal.so) para Node.js: envie e-mails, mantenha contatos, dispare eventos de produto e confira webhooks, sem dependências de runtime.

- Node 18 ou mais novo, ESM, com tipos TypeScript.
- Usa o `fetch` do Node. Nenhuma dependência instalada junto.
- Erros tipados, chave de idempotência e retentativa automática em 429 e 5xx.
- CLI `postal` no mesmo pacote.

Documentação da API: <https://postal.so/docs>. Guia deste SDK: <https://postal.so/docs/sdks>.

## Instalação

```bash
npm install postal-so
```

## Primeiro envio

Crie uma chave de API em **Chaves de API**, no painel (ela começa com `ps_`), guarde-a numa variável de ambiente e verifique o domínio de onde você envia.

```bash
export POSTAL_API_KEY=ps_xxx
```

```ts
import { Postal } from 'postal-so'

const postal = new Postal() // lê POSTAL_API_KEY; ou new Postal('ps_xxx')

const { id } = await postal.emails.send({
  from: 'Minha empresa <voce@seudominio.com.br>',
  to: 'fulano@exemplo.com',
  subject: 'Bem-vindo!',
  html: '<p>Que bom ter você por aqui.</p>',
  text: 'Que bom ter você por aqui.',
})
```

Não use a chave no navegador nem em apps: chame o Postal a partir do seu servidor. Para sistemas que só disparam e-mails e eventos, crie uma chave **só de envio**.

Os campos têm os mesmos nomes da API (`reply_to`, `scheduled_at`, `external_id`...), então a documentação em <https://postal.so/docs/api> vale direto para o SDK. As opções da chamada (como `idempotencyKey`) usam camelCase.

### Opções do cliente

```ts
const postal = new Postal('ps_xxx', {
  baseUrl: 'https://api.postal.so', // padrão
  maxRetries: 2, // tentativas extras em 429 e 5xx; 0 desliga
  timeout: 30_000, // milissegundos por tentativa
})
```

## E-mails

```ts
// Com template publicado: from, subject e reply_to vêm do template
await postal.emails.send({
  to: 'fulano@exemplo.com',
  template: { id: 'boas-vindas', variables: { NOME: 'Fulano' } },
})

// Agendado (até 30 dias), com anexo e etiqueta
const { id } = await postal.emails.send({
  from: 'voce@seudominio.com.br',
  to: ['fulano@exemplo.com'],
  subject: 'Sua nota fiscal',
  html: '<p>Segue em anexo.</p>',
  attachments: [{ filename: 'nota.pdf', content: pdfEmBase64 }],
  tags: [{ name: 'categoria', value: 'fiscal' }],
  scheduled_at: new Date(Date.now() + 3600_000),
})

await postal.emails.update(id, { scheduled_at: '2026-10-26T09:00:00-03:00' }) // reagenda
await postal.emails.cancel(id) // cancela

// Até 100 e-mails numa requisição: ou todos entram na fila, ou nenhum
await postal.emails.batch([
  { from: 'voce@seudominio.com.br', to: 'ana@exemplo.com', subject: 'Seu cupom', html: '<p>BEMVINDA</p>' },
  { from: 'voce@seudominio.com.br', to: 'bia@exemplo.com', subject: 'Seu cupom', html: '<p>BEMVINDA</p>' },
])

const email = await postal.emails.get(id) // status em email.last_event e histórico em email.events
const page = await postal.emails.list({ status: ['bounced', 'complained'], limit: 50 })
```

`emails.list`, `get` e os demais métodos de leitura exigem uma chave de acesso total.

### Idempotência

Para repetir um envio sem mandar o e-mail duas vezes, passe uma chave que identifique o *motivo* do envio (não a tentativa):

```ts
await postal.emails.send(params, { idempotencyKey: 'pedido-10482-enviado' })
```

Sem chave, o SDK gera uma para cada chamada de `emails.send`, `emails.batch` e `events.send` e a reaproveita nas retentativas, então um timeout ou um 5xx não duplica o envio. Veja [Idempotência](https://postal.so/docs/idempotencia).

## Contatos

O `external_id` é o ID da pessoa no seu sistema. `upsert` cria ou atualiza o contato procurando por `id`, depois `external_id`, depois `email`, e repetir a chamada é seguro.

```ts
const result = await postal.contacts.upsert({
  external_id: 'user_42',
  email: 'fulano@exemplo.com', // obrigatório para criar um contato novo
  first_name: 'Fulano',
  properties: { plan: 'pro' }, // a propriedade precisa existir antes
})
console.log(result.status) // 'created' | 'updated' | 'unchanged'

const contact = await postal.contacts.getByExternalId('user_42')
await postal.contacts.update('fulano@exemplo.com', { unsubscribed: true })
await postal.contacts.delete(contact.id)

for await (const c of postal.contacts.iterate({ search: 'ana' })) {
  console.log(c.email) // percorre todas as páginas
}
```

Quem se descadastrou só volta a receber se você informar `resubscribe: { consented_at, proof }` com a prova do novo consentimento. `contacts.batch([...])` faz o mesmo para muitos contatos de uma vez.

## Eventos

Eventos contam ao Postal o que acontece no seu produto e iniciam as automações com aquele gatilho. Funcionam com chave só de envio.

```ts
await postal.events.send({
  name: 'signup',
  contact: 'fulano@exemplo.com', // um e-mail novo cria o contato
  properties: { plan: 'free', source: 'site' },
})

await postal.events.send(
  {
    name: 'order.paid',
    contact: 'external_id:user_42',
    properties: { total: 199.9, currency: 'BRL' },
    contact_properties: { plan: 'pro' }, // atualiza o contato antes das automações
  },
  { idempotencyKey: 'order-10482-paid' },
)
```

## Segmentos, tópicos e domínios

```ts
const { id: segmentId } = await postal.segments.create({ name: 'Clientes ativos' })
await postal.contacts.addToSegment('fulano@exemplo.com', segmentId)

await postal.topics.create({ name: 'Novidades', default_subscription: 'opt_in', visibility: 'public' })

const domains = await postal.domains.list()
await postal.domains.verify(domains.data[0].id) // confere o DNS agora
const domain = await postal.domains.get(domains.data[0].id) // registros e status de cada um
```

## Webhooks

Cadastre o endpoint no painel ou com `postal.webhooks.create({ endpoint, events })` e guarde o `signing_secret` (`whsec_...`). `verifyWebhook(payload, headers, secret)` confere a assinatura (Standard Webhooks: HMAC-SHA256 de `{webhook-id}.{webhook-timestamp}.{corpo}`), recusa mensagens com mais de 5 minutos de diferença e devolve o evento. Use o corpo **cru**, exatamente como chegou.

```ts
import express from 'express'
import { verifyWebhook, PostalWebhookVerificationError } from 'postal-so'

const app = express()

app.post('/webhooks/postal', express.raw({ type: 'application/json' }), (req, res) => {
  try {
    const event = verifyWebhook(req.body, req.headers, process.env.POSTAL_WEBHOOK_SECRET!)

    if (event.type === 'email.bounced') {
      // descarte o endereço
    }

    res.sendStatus(200)
  } catch (error) {
    if (error instanceof PostalWebhookVerificationError) {
      return res.sendStatus(400)
    }
    throw error
  }
})
```

Em rotas no estilo `Request` (Next.js, Hono...):

```ts
export async function POST(request: Request) {
  const body = await request.text() // cru, antes de qualquer JSON.parse
  const event = verifyWebhook(body, request.headers, process.env.POSTAL_WEBHOOK_SECRET!)
  return new Response('ok')
}
```

Use o cabeçalho `webhook-id` para descartar entregas repetidas. Veja [Webhooks](https://postal.so/docs/webhooks).

## Erros

Toda resposta de erro do Postal vira um `PostalError` com o `statusCode`, o `name` (código estável em inglês, como `validation_error`) e a `message` do Postal. Trate pelo `name`, não pela mensagem.

```ts
import { PostalError } from 'postal-so'

try {
  await postal.emails.send(params)
} catch (error) {
  if (error instanceof PostalError) {
    console.error(error.statusCode, error.name, error.message)

    if (error.name === 'daily_quota_exceeded') {
      // a cota diária acabou; volta às 00:00 UTC
    }
  }
  throw error
}
```

Falhas de rede e tempo esgotado viram `PostalNetworkError` (`statusCode` 0; `name` `network_error` ou `timeout`). Os códigos estão em <https://postal.so/docs/erros>.

### Retentativas

- `429 rate_limit_exceeded` é repetido sempre, esperando o `Retry-After`. Cota esgotada (`daily_quota_exceeded`, `monthly_quota_exceeded`) não é repetida.
- `5xx`, `409 concurrent_idempotent_requests` e falhas de rede são repetidos em `GET`, `DELETE`, nos envios com chave de idempotência (a automática inclusa) e em `contacts.upsert`. Num `POST` sem chave, como `contacts.create`, não: repetir poderia duplicar o efeito.
- A espera começa em 500 ms e dobra a cada tentativa (máximo de 30 s).

## CLI

O pacote instala o comando `postal`:

```bash
npx postal-so --help   # ou: npm install -g postal-so
postal login           # pede a chave e guarda em ~/.config/postal/config.json (modo 0600)
postal whoami
```

`POSTAL_API_KEY` tem precedência sobre a chave guardada. Em CI, use só a variável.

```bash
postal emails send --from "Minha empresa <voce@seudominio.com.br>" \
  --to fulano@exemplo.com --subject "Olá" --html "<p>Bem-vindo!</p>"

postal emails send --to fulano@exemplo.com --template boas-vindas --var NOME=Fulano

postal events send --email fulano@exemplo.com --name signup --props '{"plan":"free"}'

postal contacts upsert --external-id user_42 --email fulano@exemplo.com --props '{"plan":"pro"}'

postal domains list
```

Acrescente `--json` para saída de máquina (o erro também sai em JSON, no stderr). Códigos de saída: `0` deu certo, `1` erro da API ou de rede, `2` uso incorreto. `postal <comando> --help` mostra as opções, em português.

## Skill para agentes de IA

O pacote traz uma skill (`skills/postal/SKILL.md`) que ensina Claude Code, Codex e Cursor a integrar o Postal no seu app. Copie a pasta `skills/postal` para `.claude/skills/` (ou para a pasta de skills da sua ferramenta).

## Desenvolvimento

```bash
npm install
npm test   # compila e roda node --test com um servidor HTTP falso local
```

## Licença

MIT
