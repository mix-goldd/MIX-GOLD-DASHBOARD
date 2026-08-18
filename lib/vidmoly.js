// Thin wrapper around the Vidmoly HTTP API — mirrors the shape of the old
// lib/doodstream.js on purpose (same method names, same params) so every
// file that called it only needed its import repointed here, not its
// logic rewritten. This file only ever runs on the server, so the API
// key never reaches a team member's browser.
//
// Base URL and the endpoints below marked "confirmed" come straight from
// a screenshot of Vidmoly's own API docs (وثائق API), not a guess:
//   account/info, account/stats(last,date1,date2), upload/url(url),
//   upload/server, upload/sub(file_code,sub_lang), file/info(file_code),
//   file/info2(file_real), file/rename(file_code,title), file/edit(file_code),
//   file/clone(file_code), file/set_folder(file_code,fld_id), file/list,
//   file/list2, file/deleted, folder/list, folder/rename(fld_id,name),
//   folder/create(name). Response envelope is always
//   { status, msg, result, server_time }.
//
// Still UNVERIFIED (didn't appear anywhere in the docs screenshots seen
// so far — the "الرفع" upload category shows exactly 3 endpoints total,
// with no separate status/list/slots endpoint, so these four almost
// certainly don't exist on Vidmoly as named): remoteUploadList,
// remoteUploadStatus, remoteUploadSlots, remoteUploadActions. Also
// unconfirmed: fileStatus (/file/check), searchFiles (/search/videos),
// and deleteFile (/file/delete) — the docs showed /file/deleted, which
// reads like it *lists* trashed files rather than deleting one, so the
// real delete endpoint's name is still unknown.
const API_BASE = 'https://vidmoly.me/api';
const {
  getNextApiKey,
  getApiKeyById,
  recordApiOutcome,
  queueProviderRequest,
} = require('./apiKeyManager');

async function callApi(endpoint, params = {}, opts = {}) {
  return queueProviderRequest('vidmoly', async () => {
    const credential = opts.keyId
      ? await getApiKeyById('vidmoly', opts.keyId)
      : await getNextApiKey('vidmoly');
    const query = new URLSearchParams({ key: credential.value, ...params });
    const url = `${API_BASE}${endpoint}?${query.toString()}`;
    let res;
    try {
      // A plain 401 "Forbidden" (no JSON body) — which is what the first
      // live attempt against the old, wrong base URL got — is a common
      // sign of a bot/WAF layer rejecting requests with no User-Agent, so
      // one is set here defensively even though the docs don't mention it.
      res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DashboardBot/1.0)' } });
    } catch (err) {
      throw new Error(`Vidmoly API request to ${url.replace(/key=[^&]+/, 'key=***')} failed to connect: ${err.message}`);
    }
    const bodyText = await res.text();
    let payload;
    try {
      payload = JSON.parse(bodyText);
    } catch (err) {
      await recordApiOutcome({ provider: 'vidmoly', keyId: credential.id, httpStatus: res.status });
      throw new Error(`Vidmoly API returned non-JSON for ${endpoint}: ${bodyText.slice(0, 500)}`);
    }
    await recordApiOutcome({ provider: 'vidmoly', keyId: credential.id, httpStatus: res.status, providerPayload: payload });
    if (!res.ok) {
      throw new Error(`Vidmoly API request failed (${res.status}): ${bodyText.slice(0, 500)}`);
    }
    return payload;
  });
}

const vidmoly = {
  accountInfo: () => callApi('/account/info'), // confirmed

  accountStats: (opts = {}) => callApi('/account/stats', opts), // confirmed (last, date1, date2)

  getUploadServer: () => callApi('/upload/server'), // confirmed

  uploadSubtitle: (fileCode, subLang, opts = {}) =>
    callApi('/upload/sub', { file_code: fileCode, sub_lang: subLang, ...opts }), // confirmed

  cloneFile: (fileCode, fldId) =>
    callApi('/file/clone', { file_code: fileCode, ...(fldId ? { fld_id: fldId } : {}) }), // confirmed

  addRemoteUpload: (url, opts = {}) => callApi('/upload/url', { url, ...opts }), // confirmed

  // Unconfirmed — see the file header. Kept as-is (rather than removed)
  // so the calling code in upload-url.js / upload-url/[code].js still has
  // something to call while we figure out Vidmoly's actual equivalent;
  // expect these to fail until then.
  remoteUploadList: () => callApi('/urlupload/list'),
  remoteUploadStatus: (fileCode) => callApi('/urlupload/status', { file_code: fileCode }),
  remoteUploadSlots: () => callApi('/urlupload/slots'),
  remoteUploadActions: (opts = {}) => callApi('/urlupload/actions', opts),

  createFolder: (name, parentId) =>
    callApi('/folder/create', { name, ...(parentId ? { parent_id: parentId } : {}) }), // confirmed (parent_id not seen in docs but harmless if unsupported)

  renameFolder: (fldId, name) => callApi('/folder/rename', { fld_id: fldId, name }), // confirmed

  listFolder: (fldId, onlyFolders) =>
    callApi('/folder/list', {
      fld_id: fldId ?? 0,
      ...(onlyFolders ? { only_folders: 1 } : {}),
    }), // confirmed (only_folders param not seen in docs but harmless if unsupported)

  listFiles: (opts = {}) => callApi('/file/list', opts), // confirmed

  // Used only by the unified dashboard library. The key is selected by its
  // safe server-side id, so the resulting rows can be labelled by account
  // without exposing (or returning) the credential itself.
  listFilesForAccount: (keyId, opts = {}) => callApi('/file/list', opts, { keyId }),

  listFoldersForAccount: (keyId, fldId = 0, onlyFolders) =>
    callApi('/folder/list', { fld_id: fldId, ...(onlyFolders ? { only_folders: 1 } : {}) }, { keyId }),

  fileStatus: (fileCode) => callApi('/file/check', { file_code: fileCode }), // unconfirmed

  fileInfo: (fileCode) => callApi('/file/info', { file_code: fileCode }), // confirmed

  fileInfoForAccount: (keyId, fileCode) => callApi('/file/info', { file_code: fileCode }, { keyId }), // confirmed

  fileInfo2: (fileReal) => callApi('/file/info2', { file_real: fileReal }), // confirmed

  fileImage: (fileCode) => callApi('/file/image', { file_code: fileCode }), // unconfirmed

  renameFile: (fileCode, title) => callApi('/file/rename', { file_code: fileCode, title }), // confirmed

  renameFileForAccount: (keyId, fileCode, title) => callApi('/file/rename', { file_code: fileCode, title }, { keyId }), // confirmed

  editFile: (fileCode, opts = {}) => callApi('/file/edit', { file_code: fileCode, ...opts }), // confirmed

  deleteFile: (fileCode) => callApi('/file/delete', { file_code: fileCode }), // unconfirmed — see file header

  deleteFileForAccount: (keyId, fileCode) => callApi('/file/delete', { file_code: fileCode }, { keyId }), // unconfirmed — see file header

  deleteFolder: (fldId) => callApi('/folder/delete', { fld_id: fldId }), // unconfirmed

  moveFile: (fileCode, fldId) => callApi('/file/set_folder', { file_code: fileCode, fld_id: fldId }), // confirmed — Vidmoly names this differently from DoodStream's /file/move

  moveFileForAccount: (keyId, fileCode, fldId) => callApi('/file/set_folder', { file_code: fileCode, fld_id: fldId }, { keyId }), // confirmed

  searchFiles: (searchTerm) => callApi('/search/videos', { search_term: searchTerm }), // unconfirmed
};

module.exports = vidmoly;
