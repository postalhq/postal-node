import { PostalError } from './errors.js'

const SHAPE = /^(https?):\/\/(\[[0-9a-f:]+\]|[a-z0-9.-]+)(?::([1-9][0-9]{0,4}))?$/
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1']

/**
 * Monta o valor do cabeçalho `OTP-Token` (draft-goto-otp-token), que entrega o código de um e-mail de verificação
 * de forma legível por máquina e presa a uma origem, para que o cliente de e-mail o ofereça à página certa:
 * `"123456"; origin="https://exemplo.com"`.
 *
 * O código precisa ser ASCII imprimível (de espaço a `~`) e não vazio; os únicos escapes do RFC 9651 (`\` e `"`)
 * são aplicados. A origem precisa estar na forma canônica: `https://host[:porta]` em minúsculas, sem porta padrão,
 * sem caminho nem barra no fim (`http` só vale para `localhost` e `127.0.0.1`). Lança `PostalError`
 * (`statusCode` 0, `name` `validation_error`) quando algo não serve, antes de a API recusar o envio.
 *
 * @example
 * await postal.emails.send({
 *   from: 'voce@seudominio.com.br',
 *   to: 'fulano@exemplo.com',
 *   subject: 'Seu código',
 *   html: '<p>Seu código: 123456</p>',
 *   headers: { 'OTP-Token': otpTokenHeader('123456', 'https://exemplo.com') },
 * })
 */
export function otpTokenHeader(code: string, origin: string): string {
  if (typeof code !== 'string' || !/^[\x20-\x7E]+$/.test(code)) {
    throw invalid('O código do OTP-Token precisa ter ao menos um caractere e só ASCII imprimível (de espaço a "~").')
  }

  if (typeof origin !== 'string' || !isCanonicalOrigin(origin)) {
    const canonical = typeof origin === 'string' ? canonicalOf(origin) : undefined
    const hint = canonical === undefined ? '' : ` Use "${canonical}".`

    throw invalid(
      `A origem do OTP-Token precisa ser a origem https canônica de quem pede o código, como "https://exemplo.com" (minúsculas, sem caminho, sem barra no fim e sem porta padrão).${hint}`,
    )
  }

  return `${quote(code)}; origin=${quote(origin)}`
}

function quote(text: string): string {
  return `"${text.replace(/[\\"]/g, '\\$&')}"`
}

function invalid(message: string): PostalError {
  return new PostalError(0, 'validation_error', message)
}

function isCanonicalOrigin(origin: string): boolean {
  const match = SHAPE.exec(origin)

  if (match === null) {
    return false
  }

  const [, scheme, host = '', port] = match

  if (port !== undefined && (Number(port) > 65535 || port === (scheme === 'https' ? '443' : '80'))) {
    return false
  }

  if (scheme === 'http' && !LOOPBACK_HOSTS.includes(host)) {
    return false
  }

  if (!host.startsWith('[') && !host.split('.').every((label) => LABEL.test(label))) {
    return false
  }

  // A serialização do URL (WHATWG) confere hosts numéricos, IPv6 e o que mais a regra acima deixou passar.
  try {
    return new URL(origin).origin === origin
  } catch {
    return false
  }
}

/** A origem canônica do endereço dado, se ele tiver uma que sirva. */
function canonicalOf(value: string): string | undefined {
  try {
    const candidate = new URL(value).origin

    return isCanonicalOrigin(candidate) ? candidate : undefined
  } catch {
    return undefined
  }
}
