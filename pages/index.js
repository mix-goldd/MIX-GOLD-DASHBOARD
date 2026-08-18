const { getSessionFromReq } = require('../lib/auth');
const { countUsers } = require('../lib/db');

export async function getServerSideProps({ req }) {
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
