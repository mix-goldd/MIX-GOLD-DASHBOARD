// Talks to the SAME Supabase project the S-E website uses.
// Anything written here (via the service role key, server-side only)
// is immediately visible to every visitor of the site — this is the
// "publish" step. The site reads these same tables with its public
// anon key (read-only, enforced by RLS policies already on the project).
const { createClient } = require('@supabase/supabase-js');

let client;
function getClient() {
  if (!client) {
    if (!process.env.SITE_SUPABASE_URL || !process.env.SITE_SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error(
        'SITE_SUPABASE_URL / SITE_SUPABASE_SERVICE_ROLE_KEY are not set. See .env.example.'
      );
    }
    client = createClient(process.env.SITE_SUPABASE_URL, process.env.SITE_SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  }
  return client;
}

// ---- site_settings (key/value: video_categories, sidebar_items, homepage_sections) ----
async function getSetting(key, fallback) {
  const { data, error } = await getClient()
    .from('site_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  if (error) throw error;
  return data ? data.value : fallback;
}

async function saveSetting(key, value) {
  const { error } = await getClient()
    .from('site_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
}

// ---- posts (video / image / manga / model content) ----
async function listPosts() {
  const { data, error } = await getClient()
    .from('posts')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

async function createPost(post) {
  const { data, error } = await getClient().from('posts').insert(post).select().single();
  if (error) throw error;
  return data;
}

async function updatePost(id, patch) {
  const { data, error } = await getClient().from('posts').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

async function deletePost(id) {
  const { error } = await getClient().from('posts').delete().eq('id', id);
  if (error) throw error;
}

// ---- post_views (one row per watch, written by the public site) ----
// The site keys every view by `post_id` = the post's thumbnail_url — the
// same natural key it already uses everywhere (see lib/slug.js) — not
// posts.id. A row here with no matching post.thumbnail_url is normal: it
// just means that post was later deleted/renamed, or the site logged a
// demo/test view. Returns raw rows so the caller can bucket them by
// whatever time range the user has selected.
async function listPostViews(limit = 5000) {
  const { data, error } = await getClient()
    .from('post_views')
    .select('post_id, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

// ---- post_comments (joined with posts for title/thumbnail and profiles
// for the commenter's name/avatar). profiles is joined via Supabase's
// FK-based embedding (post_comments.user_id -> profiles.id is a real
// foreign key, confirmed). posts is NOT — there's no foreign key from
// post_comments.post_id to posts.id in this schema (checked directly),
// so that embedding syntax would fail; matched up manually here instead. ----
async function listComments(limit = 200) {
  const { data, error } = await getClient()
    .from('post_comments')
    .select('id, content, created_at, post_id, parent_comment_id, profiles(username, avatar_url)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;

  const postIds = [...new Set(data.map((c) => c.post_id).filter(Boolean))];
  let postsById = {};
  if (postIds.length) {
    const { data: posts, error: postsErr } = await getClient()
      .from('posts')
      .select('id, title, thumbnail_url')
      .in('id', postIds);
    if (postsErr) throw postsErr;
    postsById = Object.fromEntries(posts.map((p) => [p.id, p]));
  }

  return data.map((c) => ({ ...c, post: postsById[c.post_id] || null }));
}

async function deleteComment(id) {
  const { error } = await getClient().from('post_comments').delete().eq('id', id);
  if (error) throw error;
}

// ---- site_visits (one row per NEW session, written by the public site — see
// trackSiteVisit() client-side; unlike post_views this is not one row per
// pageview, so its count is real site traffic, not content-view volume) ----
async function listSiteVisits(limit = 5000) {
  const { data, error } = await getClient()
    .from('site_visits')
    .select('session_id, ip, country, country_code, region, city, os, browser, referrer, language, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

// ---- models (the character roster shown in the site's "Models" section) ----
// Separate table from `posts` — a post with type:'model' would never show up
// on the site, because the site's Models grid reads from this table only.
async function listModels() {
  const { data, error } = await getClient()
    .from('models')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

async function createModel(model) {
  const { data, error } = await getClient().from('models').insert(model).select().single();
  if (error) throw error;
  return data;
}

async function updateModel(id, patch) {
  const { data, error } = await getClient().from('models').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

async function deleteModel(id) {
  const { error } = await getClient().from('models').delete().eq('id', id);
  if (error) throw error;
}

// ---- media library (log of images uploaded through the dashboard to imgbb) ----
// Kept as one JSON row in site_settings (key: 'media_library') rather than a
// new table — it's just a browsable history of upload links, nothing the
// site itself reads.
const MEDIA_LIBRARY_KEY = 'media_library';

async function listMediaItems() {
  const items = await getSetting(MEDIA_LIBRARY_KEY, []);
  return Array.isArray(items) ? items : [];
}

async function addMediaItem(item) {
  const items = await listMediaItems();
  const next = [item, ...items].slice(0, 500); // keep the log from growing forever
  await saveSetting(MEDIA_LIBRARY_KEY, next);
  return next;
}

async function deleteMediaItem(id) {
  const items = await listMediaItems();
  const next = items.filter((i) => i.id !== id);
  await saveSetting(MEDIA_LIBRARY_KEY, next);
  return next;
}

async function renameMediaItem(id, name) {
  const items = await listMediaItems();
  const next = items.map((i) => (i.id === id ? { ...i, name } : i));
  await saveSetting(MEDIA_LIBRARY_KEY, next);
  return next;
}

module.exports = {
  getSetting,
  saveSetting,
  listPosts,
  createPost,
  updatePost,
  deletePost,
  listPostViews,
  listSiteVisits,
  listComments,
  deleteComment,
  listModels,
  createModel,
  updateModel,
  deleteModel,
  listMediaItems,
  addMediaItem,
  deleteMediaItem,
  renameMediaItem,
};
