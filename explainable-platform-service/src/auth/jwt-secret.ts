/**
 * The key that signs and verifies login tokens. It has to come from the
 * environment: a key written in the source would let anyone who reads the
 * repository mint a token the API accepts.
 */
export function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not set. Add it to .env (see .env.example).');
  }
  return secret;
}
