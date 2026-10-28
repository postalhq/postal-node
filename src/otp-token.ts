import { PostalError } from './errors.js'

const SHAPE = /^(https?):\/\/(\[[0-9a-f:]+\]|[a-z0-9.-]+)(?::([1-9][0-9]{0,4}))?$/
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1']

/**
 * Builds the value of the `OTP-Token` header (draft-goto-otp-token), which delivers the code of a verification email
 * in a machine-readable way, bound to an origin, so that the mail client offers it to the right page:
 * `"123456"; origin="https://example.com"`.
 *
 * The code must be printable ASCII (from space to `~`) and non-empty; the only RFC 9651 escapes (`\` and `"`)
 * are applied. The origin must be in canonical form: `https://host[:port]` in lowercase, no default port,
 * no path and no trailing slash (`http` is only valid for `localhost` and `127.0.0.1`). Throws `PostalError`
 * (`statusCode` 0, `name` `validation_error`) when something will not do, before the API refuses the send.
 *
 * @example
 * await postal.emails.send({
 *   from: 'you@yourdomain.com',
 *   to: 'jane@example.com',
 *   subject: 'Your code',
 *   html: '<p>Your code: 123456</p>',
 *   headers: { 'OTP-Token': otpTokenHeader('123456', 'https://example.com') },
 * })
 */
export function otpTokenHeader(code: string, origin: string): string {
  if (typeof code !== 'string' || !/^[\x20-\x7E]+$/.test(code)) {
    throw invalid('The OTP-Token code needs at least one character and only printable ASCII (from space to "~").')
  }

  if (typeof origin !== 'string' || !isCanonicalOrigin(origin)) {
    const canonical = typeof origin === 'string' ? canonicalOf(origin) : undefined
    const hint = canonical === undefined ? '' : ` Use "${canonical}".`

    throw invalid(
      `The OTP-Token origin must be the canonical https origin of whoever asks for the code, such as "https://example.com" (lowercase, no path, no trailing slash and no default port).${hint}`,
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

  // The URL serialization (WHATWG) checks numeric hosts, IPv6 and whatever else the rule above let through.
  try {
    return new URL(origin).origin === origin
  } catch {
    return false
  }
}

/** The canonical origin of the given address, if it has one that will do. */
function canonicalOf(value: string): string | undefined {
  try {
    const candidate = new URL(value).origin

    return isCanonicalOrigin(candidate) ? candidate : undefined
  } catch {
    return undefined
  }
}
