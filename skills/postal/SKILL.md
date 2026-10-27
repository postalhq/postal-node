---
name: postal
description: Integra o Postal (postal.so) num app: instala o SDK, guarda a chave de API em variável de ambiente, envia e-mails transacionais, manda eventos de cadastro e pagamento, sincroniza contatos com external_id e verifica webhooks. Use quando o pedido citar Postal, e-mail transacional, boas-vindas, recibo, redefinição de senha ou eventos de produto para automações de e-mail.
---

# Postal: integração num app

O Postal é uma plataforma de e-mail (transacional e marketing). A API fica em `https://api.postal.so`, com autenticação `Authorization: Bearer ps_...`. Documentação completa: <https://postal.so/docs>. Lista de páginas para agentes: <https://postal.so/llms.txt>.

## Antes de escrever código

1. Veja qual linguagem o projeto usa. Node/TypeScript: pacote `postal-so`. PHP/Laravel: `postal-so/postal-php`. Outras: chame a API por HTTP.
2. O domínio do remetente precisa estar **verificado** no Postal (<https://postal.so/docs/dominios-e-dns>). Sem isso, o envio falha com `403 validation_error`. Se o usuário ainda não tem domínio, diga isso em vez de inventar um remetente.
3. Pergunte (ou procure no `.env.example`) onde ficam as variáveis de ambiente do projeto.

## 1. Instalar o SDK

```bash
npm install postal-so          # Node 18+, ESM, sem dependências
composer require postal-so/postal-php   # PHP 8.2+
```

## 2. Chave de API

- Crie em **Chaves de API**, no painel. Ela começa com `ps_` e aparece uma única vez.
- Guarde em `POSTAL_API_KEY` (`.env`, cofre de segredos do deploy). **Nunca** no código, no repositório, no navegador ou em app mobile: chame o Postal só pelo servidor.
- Para um sistema que só envia e-mails e eventos, use uma chave **só de envio** (`sending_access`), que pode ser restrita a um domínio. Ela cobre `POST /emails`, `POST /emails/batch` e `POST /events`; o resto da API exige acesso total.
- Acrescente `POSTAL_API_KEY=` ao `.env.example`, sem valor.

## 3. Enviar um e-mail

```ts
import { Postal } from 'postal-so'

const postal = new Postal() // lê POSTAL_API_KEY

await postal.emails.send(
  {
    from: 'Minha empresa <voce@seudominio.com.br>',
    to: 'fulano@exemplo.com',
    subject: 'Redefinição de senha',
    html: '<p>Use o link abaixo para criar uma nova senha.</p>',
    text: 'Use o link para criar uma nova senha.',
  },
  { idempotencyKey: `password-reset-${resetId}` },
)
```

- `to` é uma string ou uma lista de até 50. Mande sempre `text` junto com `html`.
- Para e-mails que o produto dispara várias vezes (recibo, boas-vindas), passe `idempotencyKey` com o *motivo* do envio (`order-10482-receipt`), nunca um valor novo a cada tentativa.
- Com template publicado: `template: { id: 'boas-vindas', variables: { NOME: 'Fulano' } }` no lugar de `html`/`text`.
- E-mail com código de verificação digitado numa página: acrescente `headers: { 'OTP-Token': otpTokenHeader('123456', 'https://seu-app.com') }` (`import { otpTokenHeader } from 'postal-so'`) para o cliente de e-mail preencher o código sozinho; a origem é a do site que pede o código, em minúsculas e sem caminho.
- Envie em segundo plano (fila/job) quando o e-mail não precisa bloquear a resposta ao usuário.

## 4. Eventos de cadastro e pagamento

Eventos iniciam as automações (série de boas-vindas, recuperação de pagamento...) e funcionam com chave só de envio. Envie quando o fato acontece, a partir do servidor:

```ts
// Cadastro
await postal.events.send(
  { name: 'signup', contact: user.email, properties: { plan: 'free', source: 'site' } },
  { idempotencyKey: `signup-${user.id}` },
)

// Pagamento aprovado
await postal.events.send(
  {
    name: 'payment.succeeded',
    contact: `external_id:${user.id}`,
    properties: { amount: 199.9, currency: 'BRL', plan: 'pro' },
    contact_properties: { plan: 'pro' },
  },
  { idempotencyKey: `payment-${payment.id}` },
)
```

- `name`: letras, números, `.`, `_`, `:` e `-`, até 100 caracteres. Use nomes estáveis e em inglês (`signup`, `payment.succeeded`, `payment.failed`, `trial.started`).
- `contact` aceita e-mail, ID do contato, `external_id:<id>` ou um objeto `{ email, external_id, first_name }`. Um e-mail novo cria o contato.
- `properties` (até 16 KB) ficam disponíveis nas automações e nos e-mails. `contact_properties` atualiza o contato antes das automações; a propriedade precisa existir antes (cadastre no painel ou em `/contact-properties`).
- Eventos sem `contact` são registrados, mas não iniciam automações.

## 5. Contatos com `external_id`

O `external_id` é o ID do usuário no sistema do cliente. Faça `upsert` no cadastro e quando os dados mudarem:

```ts
await postal.contacts.upsert({
  external_id: String(user.id),
  email: user.email,        // obrigatório para criar
  first_name: user.name,
  properties: { plan: user.plan },
})
```

`upsert` procura por `id`, depois `external_id`, depois `email`, e repetir é seguro. Para parar de enviar marketing, use `unsubscribed: true`, não apague o contato. Quem se descadastrou só é reinscrito com `resubscribe: { consented_at, proof }`; nunca reinscreva sem consentimento.

## 6. Webhooks

Cadastre a URL (HTTPS pública) no painel ou com `postal.webhooks.create({ endpoint, events })` e guarde o `signing_secret` (`whsec_...`) em `POSTAL_WEBHOOK_SECRET`.

```ts
import { verifyWebhook } from 'postal-so'

// corpo CRU, antes de qualquer JSON.parse
const event = verifyWebhook(rawBody, request.headers, process.env.POSTAL_WEBHOOK_SECRET!)

switch (event.type) {
  case 'email.bounced':
  case 'email.complained':
    // pare de enviar para event.data.to
    break
}
```

- Em Express use `express.raw({ type: 'application/json' })`; em rotas `Request` use `await request.text()`. Se o framework já fez o parse do JSON, a assinatura não bate.
- Responda `2xx` rápido e processe em fila. Descarte duplicatas pelo cabeçalho `webhook-id`.
- Em PHP: `Postal\Webhook::verify($payload, $headers, $secret)`.
- Tipos de evento: `email.sent`, `email.delivered`, `email.bounced`, `email.complained`, `email.opened`, `email.clicked`, `email.failed`, `contact.created`, `contact.updated`, `domain.updated`, entre outros: <https://postal.so/docs/webhooks>.

## 7. Erros e limites

- Erros chegam como `PostalError` com `statusCode`, `name` (código estável, como `validation_error`) e `message`. Trate pelo `name`.
- `429 rate_limit_exceeded`: o SDK já repete respeitando `Retry-After`. `daily_quota_exceeded` e `monthly_quota_exceeded` não se resolvem repetindo.
- Em requisição web síncrona, use `timeout: 10_000` e `maxRetries: 1`; o `connectTimeout` (padrão 5 s) já limita o bloqueio quando a API está inalcançável. `postal.rateLimit` mostra o limite de requisições da última resposta, mesmo com chave só de envio.
- Não repita sem corrigir em 400, 401, 403, 404 e 422.
- Códigos: <https://postal.so/docs/erros>.

## O que não fazer

- Não coloque a chave em código do navegador, app mobile ou repositório.
- Não use endereços reais de pessoas em testes: use `fulano@exemplo.com`.
- Não envie marketing para quem não consentiu; use eventos e automações para e-mail de ciclo de vida e tópicos/segmentos para campanhas.
- Não gere uma `idempotencyKey` aleatória a cada tentativa: isso anula a proteção.

## Verificar a integração

```bash
npx postal-so login                # guarda a chave (ou use POSTAL_API_KEY)
npx postal-so whoami
npx postal-so emails send --from "Minha empresa <voce@seudominio.com.br>" --to fulano@exemplo.com --subject "Teste" --text "Funcionou"
npx postal-so events send --email fulano@exemplo.com --name signup --props '{"plan":"free"}'
```

## Links

- Início rápido: <https://postal.so/docs/primeiros-passos>
- Autenticação: <https://postal.so/docs/autenticacao>
- Enviar e-mails: <https://postal.so/docs/api/emails>
- Eventos: <https://postal.so/docs/api/eventos>
- Contatos: <https://postal.so/docs/api/contatos>
- Webhooks: <https://postal.so/docs/webhooks>
- Idempotência: <https://postal.so/docs/idempotencia>
- SDKs: <https://postal.so/docs/sdks> · CLI: <https://postal.so/docs/cli>
