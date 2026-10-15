/**
 * Signed, stateless session tokens for the optional dashboard login.
 *
 * Token format: `<exp>.<nonce>.<signature>` where `exp` is the expiry in Unix
 * seconds, `nonce` is 16 random bytes (base64url) and `signature` is
 * base64url(HMAC-SHA256(secret, `${exp}.${nonce}`)).
 *
 * Only Web Crypto (`crypto.subtle`) and `btoa`/`atob` are used, so the same
 * module runs in the Next.js proxy and in Node route handlers. No imports.
 */

export const SESSION_COOKIE_NAME = "honcho_dashboard_session";

const encoder = new TextEncoder();
const B64URL = /^[A-Za-z0-9_-]+$/;
const DIGITS = /^[0-9]{1,15}$/;

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array | null {
  if (!B64URL.test(value)) return null;
  try {
    const bin = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function hmacKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

/**
 * Create a session token valid for `ttlSeconds` from `nowMs`.
 * `nonce` is injectable for tests; production callers omit it.
 */
export async function signSession(
  secret: string,
  ttlSeconds: number,
  nowMs: number = Date.now(),
  nonce?: string,
): Promise<string> {
  const exp = Math.floor(nowMs / 1000) + Math.floor(ttlSeconds);
  const n = nonce ?? toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  const payload = `${exp}.${n}`;
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), encoder.encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(sig))}`;
}

/**
 * True when `token` is well formed, signed with `secret`, and not expired at
 * `nowMs`. Never throws on bad input. The signature check is
 * `crypto.subtle.verify`, which compares in constant time.
 */
export async function verifySession(
  secret: string,
  token: string | null | undefined,
  nowMs: number = Date.now(),
): Promise<boolean> {
  if (!token || token.length > 512) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [exp, nonce, sig] = parts;
  if (!DIGITS.test(exp) || !B64URL.test(nonce)) return false;
  const sigBytes = fromBase64Url(sig);
  if (!sigBytes) return false;
  let valid: boolean;
  try {
    valid = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret, "verify"),
      sigBytes as BufferSource,
      encoder.encode(`${exp}.${nonce}`),
    );
  } catch {
    return false;
  }
  if (!valid) return false;
  return Number(exp) > Math.floor(nowMs / 1000);
}

/** Extract one cookie value from a `Cookie` request header. */
export function parseCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    let value = part.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    return value === "" ? null : value;
  }
  return null;
}

/**
 * Constant-time string equality. Both inputs are hashed first so the compare
 * always runs over 32 bytes and leaks neither the content nor the length.
 */
export async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/** `Set-Cookie` value that stores a session token. */
export function sessionCookie(token: string, ttlSeconds: number, secure: boolean): string {
  return [
    `${SESSION_COOKIE_NAME}=${token}`,
    "Path=/",
    `Max-Age=${Math.floor(ttlSeconds)}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

/** `Set-Cookie` value that removes the session cookie. */
export function clearedSessionCookie(secure: boolean): string {
  return [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

/** Whether the client connection was HTTPS (directly or via a reverse proxy). */
export function isSecureRequest(
  forwardedProto: string | null | undefined,
  urlProtocol: string,
): boolean {
  if (forwardedProto) {
    return forwardedProto.split(",")[0].trim().toLowerCase() === "https";
  }
  return urlProtocol === "https:";
}
