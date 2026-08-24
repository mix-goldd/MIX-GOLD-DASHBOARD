const { getSessionFromReq } = require('../lib/auth');
const { countUsers } = require('../lib/db');
const { isPublicSiteHost } = require('../lib/domainRouting');

export async function getServerSideProps({ req }) {
  if (isPublicSiteHost(req?.headers?.['x-forwarded-host'] || req?.headers?.host)) {
    return { redirect: { destination: '/site', permanent: false } };
  }

  const session = getSessionFromReq(req);
  if (session) {
    return { redirect: { destination: '/dashboard', permanent: false } };
  }

  try {
    const existing = await countUsers();
    if (existing === 0) {
      return { redirect: { destination: '/setup', permanent: false } };
    }
  } catch (err) {
    // If the database isn't reachable yet (e.g. env var not set),
    // fall through to the login page rather than crashing.
  }

  return { redirect: { destination: '/login', permanent: false } };
}

export default function Home() {
  return null;
}
