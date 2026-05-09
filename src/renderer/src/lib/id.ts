const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function newId(prefix = ""): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return prefix ? `${prefix}_${out}` : out;
}
