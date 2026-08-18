const { getPublicApiKeyStatus } = require('../lib/apiKeyManager');
const { getVidmolyPortalSyncStatus } = require('../lib/vidmolyPortalSync');

async function main() {
  const [keys, sync] = await Promise.all([
    getPublicApiKeyStatus(Date.now()),
    getVidmolyPortalSyncStatus(),
  ]);
  const accounts = keys
    .filter((key) => key.provider === 'vidmoly' && key.configured)
    .map((key) => ({ id: key.id, usedToday: key.dailyRequests, dailyLimit: key.dailyLimit, usageSource: key.usageSource }));
  console.log(JSON.stringify({ accounts, sync }, null, 2));
}

main().catch((error) => {
  console.error(error?.message || 'Unable to read Vidmoly sync state.');
  process.exitCode = 1;
});
