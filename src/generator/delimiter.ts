function randomToken(): string {
  const bytes = new Uint8Array(9);
  const cryptoObject = globalThis.crypto;
  if (cryptoObject?.getRandomValues) {
    cryptoObject.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function uniqueDelimiter(content: string, prefix = "__R2S__"): string {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const delimiter = `${prefix}${randomToken()}__`;
    if (!content.includes(delimiter)) return delimiter;
  }
  throw new Error("Could not find a safe heredoc delimiter");
}
