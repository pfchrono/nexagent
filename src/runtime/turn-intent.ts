export function formatTurnStartIntent(prompt: string): string {
  const compact = prompt
    .replace(/\s+/g, " ")
    .replace(/^\/skill\s+/i, "")
    .trim();
  if (!compact) {
    return "Attempting: work request";
  }
  return `Attempting: ${compact.length > 120 ? `${compact.slice(0, 117)}...` : compact}`;
}
