/** Turns a raw User-Agent into a short label such as "Edge 130 / Windows 10/11". */

function browserOf(ua: string): string | null {
  // Order matters: Edge and Opera also contain "Chrome", Chrome also contains "Safari".
  const rules: [RegExp, string][] = [
    [/\bEdg(?:e|A|iOS)?\/(\d+)/, 'Edge'],
    [/\bOPR\/(\d+)/, 'Opera'],
    [/\b(?:Firefox|FxiOS)\/(\d+)/, 'Firefox'],
    [/\b(?:Chrome|CriOS)\/(\d+)/, 'Chrome'],
    [/\bVersion\/(\d+)[\d.]*.*\bSafari\//, 'Safari'],
  ];
  for (const [re, name] of rules) {
    const m = re.exec(ua);
    if (m) return `${name} ${m[1]}`;
  }
  return null;
}

function osOf(ua: string): string | null {
  // iOS user agents contain "like Mac OS X": test them before macOS.
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
  if (/Android/.test(ua)) return 'Android';
  const win = /Windows NT (\d+\.\d+)/.exec(ua);
  if (win) {
    // Windows 11 still announces "NT 10.0": the two cannot be told apart from the UA.
    return win[1] === '10.0' ? 'Windows 10/11' : `Windows NT ${win[1]}`;
  }
  if (/Mac OS X/.test(ua)) return 'macOS';
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Linux/.test(ua)) return 'Linux';
  return null;
}

export function describeUserAgent(ua: string): string {
  const browser = browserOf(ua);
  const os = osOf(ua);
  if (browser && os) return `${browser} / ${os}`;
  if (browser) return browser;
  // Unknown agent: keep the raw string rather than hiding information.
  return ua;
}
