export interface Session {
  token: string;
  expiresAt: number;
}
export function createSession(token: string): Session {
  return { token, expiresAt: Date.now() + 3600000 };
}
export function verifyToken(token: string): boolean {
  return token.length > 16;
}
export function rotateKey(previous: string): string {
  return `${previous}-rotated`;
}
export const supportedAlgorithms = ["HS256"] as const;
