type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

export function asRecord(value: unknown): JsonRecord | null {
  return isRecord(value) ? value : null;
}

export function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

export function readEmbeddedPayload(document: Document): JsonRecord | null {
  const scripts = document.querySelectorAll(
    'script[type="application/json"][data-target="react-app.embeddedData"]'
  );

  for (const script of Array.from(scripts)) {
    const text = script.textContent?.trim();
    if (!text) continue;
    try {
      const parsed: unknown = JSON.parse(text);
      const root = asRecord(parsed);
      const payload = root ? asRecord(root.payload) : null;
      if (payload) return payload;
    } catch {
      // GitHub can include several JSON payloads; a malformed optional one
      // should not prevent the adapter from trying the next source.
    }
  }

  return null;
}

export function getEmbeddedRoute(
  payload: JsonRecord | null,
  key: string
): JsonRecord | null {
  return payload ? asRecord(payload[key]) : null;
}
