function cookiePairs(setCookies) {
  return setCookies
    .map((value) => value.split(';')[0])
    .filter(Boolean)
    .join('; ');
}

function safeMatch(value) {
  return value
    .replace(/[A-Za-z0-9_-]{20,}/g, '[REDACTED]')
    .replace(/[\w.+-]+@[\w.-]+/g, '[REDACTED_EMAIL]');
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function findApiCandidates(html) {
  const candidates = [];
  for (const match of html.matchAll(/(?:https?:\/\/vidmoly\.me)?\/api\/[A-Za-z0-9_./?=&-]+/g)) {
    candidates.push(match[0].replace(/https?:\/\/vidmoly\.me/, ''));
  }
  return unique(candidates).slice(0, 80).map(safeMatch);
}

function findScriptSources(html) {
  return unique([...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1]))
    .slice(0, 80)
    .map(safeMatch);
}

function findRelevantSnippets(text) {
  const terms = /(usage|request|limit|quota|api[_-]?key)/gi;
  return [...text.matchAll(terms)].slice(0, 40).map((match) => {
    const start = Math.max(0, match.index - 90);
    const end = Math.min(text.length, match.index + 190);
    return safeMatch(text.slice(start, end).replace(/\s+/g, ' '));
  });
}

function findPatternSnippets(text, pattern) {
  return [...text.matchAll(pattern)].slice(0, 30).map((match) => {
    const start = Math.max(0, match.index - 160);
    const end = Math.min(text.length, match.index + 260);
    return safeMatch(text.slice(start, end).replace(/\s+/g, ' '));
  });
}

async function inspect() {
  const login = process.env.VIDMOLY_PORTAL_LOGIN;
  const password = process.env.VIDMOLY_PORTAL_PASSWORD;
  if (!login || !password) throw new Error('Vidmoly portal credentials are not configured.');

  const loginResponse = await fetch('https://vidmoly.me/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ login, password }),
  });
  const loginPayload = await loginResponse.json().catch(() => ({}));
  const setCookies = typeof loginResponse.headers.getSetCookie === 'function'
    ? loginResponse.headers.getSetCookie()
    : [loginResponse.headers.get('set-cookie')].filter(Boolean);
  const token = typeof loginPayload.token === 'string' ? loginPayload.token : null;
  const headers = { accept: 'text/html,application/json' };
  const cookie = cookiePairs(setCookies);
  if (cookie) headers.cookie = cookie;
  if (token) headers.authorization = `Bearer ${token}`;

  const settingsResponse = await fetch('https://vidmoly.me/user/settings', { headers });
  const settingsText = await settingsResponse.text();
  const apiKeyResponse = await fetch('https://vidmoly.me/api/user/api-key', {
    headers: { ...headers, accept: 'application/json' },
  });
  const apiKeyPayload = await apiKeyResponse.json().catch(() => ({}));
  const configuredVidmolyKeys = [
    ['vidmoly-1', process.env.VIDMOLY_API_KEY],
    ['vidmoly-2', process.env.VIDMOLY_API_KEY_2],
    ['vidmoly-3', process.env.VIDMOLY_API_KEY_3],
    ['vidmoly-4', process.env.VIDMOLY_API_KEY_4],
    ['vidmoly-5', process.env.VIDMOLY_API_KEY_5],
  ];
  const matchedConfiguredAccount = configuredVidmolyKeys
    .find(([, value]) => value && value === apiKeyPayload?.apiKey)?.[0] ?? null;
  const scriptPaths = unique([...settingsText.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1]));
  const bundlePath = scriptPaths.find((path) => path.startsWith('/_nuxt/'));
  const bundleResponse = bundlePath
    ? await fetch(`https://vidmoly.me${bundlePath}`, { headers: { accept: 'application/javascript' } })
    : null;
  const bundleText = bundleResponse ? await bundleResponse.text() : '';
  const settingsBundlePaths = ['/_nuxt/DNNYPXWH.js', '/_nuxt/CoT0FnvB.js'];
  const settingsBundles = await Promise.all(settingsBundlePaths.map(async (path) => {
    const response = await fetch(`https://vidmoly.me${path}`, { headers: { accept: 'application/javascript' } });
    return { path, status: response.status, text: await response.text() };
  }));

  process.stdout.write(`${JSON.stringify({
    loginStatus: loginResponse.status,
    loginFields: Object.keys(loginPayload || {}).sort(),
    sessionCookieNames: setCookies.map((value) => value.split('=')[0]).filter(Boolean),
    hasToken: Boolean(token),
    settingsStatus: settingsResponse.status,
    settingsContentType: settingsResponse.headers.get('content-type'),
    settingsBytes: settingsText.length,
    apiUsageEndpoint: {
      status: apiKeyResponse.status,
      fields: Object.keys(apiKeyPayload || {}).filter((key) => !/apiKey/i.test(key)).sort(),
      hasApiKeyField: Object.prototype.hasOwnProperty.call(apiKeyPayload || {}, 'apiKey'),
      apiDailyLimit: Number.isFinite(apiKeyPayload?.apiDailyLimit) ? apiKeyPayload.apiDailyLimit : null,
      apiUsedToday: Number.isFinite(apiKeyPayload?.apiUsedToday) ? apiKeyPayload.apiUsedToday : null,
      apiRemainingToday: Number.isFinite(apiKeyPayload?.apiRemainingToday) ? apiKeyPayload.apiRemainingToday : null,
      apiUnlimited: apiKeyPayload?.apiUnlimited === true,
      matchedConfiguredAccount,
    },
    apiCandidates: findApiCandidates(settingsText),
    scriptSources: findScriptSources(settingsText),
    indicatorSnippets: findRelevantSnippets(settingsText),
    bundleStatus: bundleResponse?.status ?? null,
    bundleBytes: bundleText.length,
    bundleApiCandidates: findApiCandidates(bundleText),
    bundleRelevantSnippets: findRelevantSnippets(bundleText),
    settingsRouteSnippets: findPatternSnippets(bundleText, /user\/settings|settings[-_]api|api[-_]?settings/gi),
    usageRouteSnippets: findPatternSnippets(bundleText, /api[-_]?usage|usage[-_]?api|daily.{0,40}request|request.{0,40}daily/gi),
    settingsBundles: settingsBundles.map((bundle) => ({
      path: bundle.path,
      status: bundle.status,
      bytes: bundle.text.length,
      apiCandidates: findApiCandidates(bundle.text),
      usageSnippets: findPatternSnippets(bundle.text, /api\/[^"'`\\ ]+|usage|quota|daily.{0,40}request|request.{0,40}daily/gi),
    })),
  }, null, 2)}\n`);
}

inspect().catch((error) => {
  process.stderr.write(`Vidmoly settings inspection failed: ${error.message}\n`);
  process.exitCode = 1;
});
