export function parseJsonConfig(raw: string): unknown {
  return JSON.parse(stripJsonConfigCommentsAndTrailingCommas(raw));
}

function stripJsonConfigCommentsAndTrailingCommas(raw: string): string {
  let output = "";
  let inString = false;
  let quote: "\"" | "'" | null = null;
  let escaped = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index] ?? "";
    const next = raw[index + 1] ?? "";

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        inString = false;
        quote = null;
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      inString = true;
      quote = char;
      output += char;
      continue;
    }

    if (char === "/" && next === "/") {
      index += 1;
      while (index + 1 < raw.length && raw[index + 1] !== "\n" && raw[index + 1] !== "\r") {
        index += 1;
      }
      continue;
    }

    if (char === "/" && next === "*") {
      index += 1;
      while (index + 1 < raw.length && !(raw[index] === "*" && raw[index + 1] === "/")) {
        index += 1;
      }
      index += 1;
      continue;
    }

    if (char === ",") {
      const nextToken = findNextJsonConfigToken(raw, index + 1);
      if (nextToken === "}" || nextToken === "]") {
        continue;
      }
    }

    output += char;
  }

  return output;
}

function findNextJsonConfigToken(raw: string, startIndex: number): string | null {
  for (let index = startIndex; index < raw.length; index += 1) {
    const char = raw[index] ?? "";
    const next = raw[index + 1] ?? "";

    if (/\s/.test(char)) {
      continue;
    }

    if (char === "/" && next === "/") {
      index += 1;
      while (index + 1 < raw.length && raw[index + 1] !== "\n" && raw[index + 1] !== "\r") {
        index += 1;
      }
      continue;
    }

    if (char === "/" && next === "*") {
      index += 1;
      while (index + 1 < raw.length && !(raw[index] === "*" && raw[index + 1] === "/")) {
        index += 1;
      }
      index += 1;
      continue;
    }

    return char;
  }

  return null;
}
