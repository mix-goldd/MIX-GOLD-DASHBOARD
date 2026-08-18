const { createClient } = require('@supabase/supabase-js');

let client;
function getClient() {
  if (!client) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
      throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY are not set.');
    }
    client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  }
  return client;
}

async function getUserByUsername(username) {
  const { data, error } = await getClient()
    .from('users')
    .select('*')
    .eq('username', username)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getUserById(id) {
  const { data, error } = await getClient()
    .from('users')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function createUser(username, passwordHash, role = 'member') {
  const { data, error } = await getClient()
    .from('users')
    .insert({ username, password_hash: passwordHash, role })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function listUsers() {
  const { data, error } = await getClient()
    .from('users')
    .select('id, username, role, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

async function updateUserRole(id, role) {
  const { data, error } = await getClient()
    .from('users')
    .update({ role })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteUser(id) {
  const { error } = await getClient().from('users').delete().eq('id', id);
  if (error) throw error;
}

async function countUsers() {
  const { count, error } = await getClient()
    .from('users')
    .select('*', { count: 'exact', head: true });
  if (error) throw error;
  return count || 0;
}

// Compares the Vidmoly files returned on this request against the
// last-known set (`known_files`). Anything that dropped out of the
// listing has either been deleted or expired on Vidmoly's side —
// either way it's gone, so we log a notification for it and drop it
// from known_files. Anything new gets recorded so future runs can
// detect it disappearing. Returns the list of files that were found
// to be removed on this run.
async function syncKnownFiles(currentFiles) {
  const client = getClient();
  const { data: known, error: knownErr } = await client.from('known_files').select('file_code, title, thumb');
  if (knownErr) throw knownErr;

  const currentMap = new Map(currentFiles.map((f) => [f.file_code, { title: f.title, thumb: f.thumb || null }]));
  const knownMap = new Map((known || []).map((f) => [f.file_code, { title: f.title, thumb: f.thumb || null }]));

  const removedCodes = [...knownMap.keys()].filter((code) => !currentMap.has(code));
  const newCodes = [...currentMap.keys()].filter((code) => !knownMap.has(code));
  const renamedCodes = [...currentMap.keys()].filter(
    (code) => knownMap.has(code) && knownMap.get(code).title !== currentMap.get(code).title
  );

  if (removedCodes.length) {
    const notifications = removedCodes.map((code) => ({
      file_code: code,
      title: knownMap.get(code)?.title || code,
      thumb: knownMap.get(code)?.thumb || null,
      type: 'removed',
    }));
    const { error: notifyErr } = await client.from('file_notifications').insert(notifications);
    if (notifyErr) throw notifyErr;
    const { error: deleteErr } = await client.from('known_files').delete().in('file_code', removedCodes);
    if (deleteErr) throw deleteErr;
  }

  if (newCodes.length) {
    const inserts = newCodes.map((code) => ({ file_code: code, title: currentMap.get(code).title, thumb: currentMap.get(code).thumb }));
    const { error: upsertErr } = await client.from('known_files').upsert(inserts, { onConflict: 'file_code' });
    if (upsertErr) throw upsertErr;
  }

  if (renamedCodes.length) {
    await Promise.all(
      renamedCodes.map((code) =>
        client
          .from('known_files')
          .update({ title: currentMap.get(code).title, thumb: currentMap.get(code).thumb, last_seen_at: new Date().toISOString() })
          .eq('file_code', code)
      )
    );
  }

  return removedCodes.map((code) => ({ file_code: code, title: knownMap.get(code)?.title || code, thumb: knownMap.get(code)?.thumb || null }));
}

// Called directly from the delete API routes the moment a team member
// removes a video from the dashboard, so the notification (and its
// thumbnail) exists immediately instead of waiting for the next library
// load to notice the file is gone via syncKnownFiles. Best-effort: a
// failure here should never block the delete itself.
async function notifyFileRemoved({ file_code, title, thumb }) {
  const client = getClient();
  const { error } = await client.from('file_notifications').insert({
    file_code,
    title: title || file_code,
    thumb: thumb || null,
    type: 'removed',
  });
  if (error) throw error;
  // Keep known_files in sync so a later background sync doesn't log a
  // second, duplicate "removed" notification for the same file.
  await client.from('known_files').delete().eq('file_code', file_code);
}

async function listNotifications(limit = 30) {
  const { data, error } = await getClient()
    .from('file_notifications')
    .select('id, file_code, title, thumb, type, created_at, is_read')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

async function countUnreadNotifications() {
  const { count, error } = await getClient()
    .from('file_notifications')
    .select('*', { count: 'exact', head: true })
    .eq('is_read', false);
  if (error) throw error;
  return count || 0;
}

async function markAllNotificationsRead() {
  const { error } = await getClient().from('file_notifications').update({ is_read: true }).eq('is_read', false);
  if (error) throw error;
}

async function deleteNotification(id) {
  const { error } = await getClient().from('file_notifications').delete().eq('id', id);
  if (error) throw error;
}

async function deleteAllNotifications() {
  // Supabase requires a filter on delete — this matches every row without
  // relying on a specific column value staying valid over time.
  const { error } = await getClient().from('file_notifications').delete().gte('id', 0);
  if (error) throw error;
}

// Per-file thumbnail/views/length/etc. — confirmed to only be available
// via a separate /file/info call per file (see library.js), which adds
// up fast against Vidmoly's daily request quota as the library grows.
// These two functions turn known_files into a real cache for that data
// so a normal page load only re-fetches what's actually stale.
async function getCachedFileDetails(fileCodes) {
  if (!fileCodes.length) return new Map();
  const { data, error } = await getClient()
    .from('known_files')
    .select('file_code, thumb, views, length_seconds, uploaded_date, fld_id, size_bytes, cached_at')
    .in('file_code', fileCodes);
  if (error) throw error;
  return new Map((data || []).map((row) => [row.file_code, row]));
}

async function cacheFileDetails(entries) {
  if (!entries.length) return;
  const rows = entries.map((e) => ({
    file_code: e.file_code,
    title: e.title,
    thumb: e.thumb || null,
    views: e.views ?? null,
    length_seconds: e.length ?? null,
    uploaded_date: e.uploaded || null,
    fld_id: e.fld_id ? String(e.fld_id) : null,
    cached_at: new Date().toISOString(),
  }));
  const { error } = await getClient().from('known_files').upsert(rows, { onConflict: 'file_code' });
  if (error) throw error;
}

// Vidmoly's API doesn't expose file size anywhere (confirmed — see
// library.js's history), so this is captured ourselves at upload time
// instead: the browser's own File object for local uploads, or the
// source URL's Content-Length header for remote ones (see upload-local.js
// / upload-url.js). Deliberately touches only file_code + size_bytes —
// omitting every other column (rather than passing them as null) means
// Supabase's upsert leaves them alone, so this can't accidentally wipe
// out thumb/views/length that cacheFileDetails already has, and doesn't
// count as a "detail refresh" for cacheFileDetails' own cached_at TTL.
async function cacheFileSize(fileCode, sizeBytes) {
  if (!fileCode || !sizeBytes) return;
  const { error } = await getClient()
    .from('known_files')
    .upsert([{ file_code: fileCode, size_bytes: sizeBytes }], { onConflict: 'file_code' });
  if (error) throw error;
}

// Generic key-value settings for the dashboard's own UI (sidebar nav
// labels, etc. — see /dashboard/settings) — separate from the site's own
// getSetting/saveSetting in lib/siteDb.js, which is a different Supabase
// project entirely.
async function getDashboardSetting(key) {
  const { data, error } = await getClient().from('dashboard_settings').select('value').eq('key', key).maybeSingle();
  if (error) throw error;
  return data?.value ?? null;
}

async function saveDashboardSetting(key, value) {
  const { error } = await getClient()
    .from('dashboard_settings')
    .upsert([{ key, value, updated_at: new Date().toISOString() }], { onConflict: 'key' });
  if (error) throw error;
}

module.exports = {
  getUserByUsername,
  getUserById,
  createUser,
  listUsers,
  updateUserRole,
  deleteUser,
  countUsers,
  syncKnownFiles,
  notifyFileRemoved,
  listNotifications,
  countUnreadNotifications,
  markAllNotificationsRead,
  deleteNotification,
  deleteAllNotifications,
  getCachedFileDetails,
  cacheFileDetails,
  cacheFileSize,
  getDashboardSetting,
  saveDashboardSetting,
};
