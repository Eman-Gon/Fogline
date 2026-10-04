export function codeFromScan(raw: string): string | null {
  const text = raw.trim();
  let candidate = '';
  try {
    const url = new URL(text);
    const fromHash = /(?:^#|[?&])pair=([A-Za-z2-9-]{6,11})(?:&|$)/.exec(url.hash)?.[1] ?? '';
    const fromPath = url.pathname.match(/\/pair\/([A-Za-z2-9-]{6,11})\/?$/)?.[1] ?? '';
    candidate = url.searchParams.get('pair') || fromHash || fromPath;
  } catch {
    candidate = text;
  }
  const compact = candidate.replace(/-/g, '').toUpperCase();
  return /^[A-Z2-9]{6}$/.test(compact) ? compact : null;
}

export function pairLink(code: string) {
  return `${location.origin}${location.pathname}?pair=${code}`;
}
