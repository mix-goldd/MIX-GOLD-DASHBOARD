// Matches slugFromKey() in the S-E site's HTML file exactly (same djb2-style
// hash of the post's thumbnail_url). Posts are keyed throughout the site by
// that same thumbnail url, so re-using it here means a post's real subpage
// (/watch/<slug>) and its in-app "?post=<slug>" link always agree — no new
// slug column, no migration.
function slugFromKey(key) {
  const str = String(key || '');
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) + hash + str.charCodeAt(i);
    hash |= 0;
  }
  return (hash >>> 0).toString(36);
}

module.exports = { slugFromKey };
