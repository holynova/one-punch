export function utf8ToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, bytes.length);
    let chunk = "";
    for (let index = offset; index < end; index += 1) {
      chunk += String.fromCharCode(bytes[index] ?? 0);
    }
    binary += chunk;
  }

  if (typeof btoa !== "function") {
    throw new Error("This browser does not provide btoa for exact file encoding");
  }
  return btoa(binary);
}

export function wrapBase64(value: string, width = 76): string {
  if (value.length === 0) return "";
  const lines: string[] = [];
  for (let offset = 0; offset < value.length; offset += width) {
    lines.push(value.slice(offset, offset + width));
  }
  return lines.join("\n");
}
