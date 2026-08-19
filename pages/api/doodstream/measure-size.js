import { getSessionFromReq } from '../../../lib/auth';
const vidmoly = require('../../../lib/vidmoly');
const { cacheFileSize, getDashboardSetting, saveDashboardSetting } = require('../../../lib/db');
const { patchVidmolyLibraryFile } = require('../../../lib/vidmolyDashboardCache');
const { getMeasuredSizeFromResponse } = require('../../../lib/vidmolySizeMeasurement');

const MEASUREMENT_KEY = 'vidmoly_size_measurements_v1';
const inFlight = new Set();

function auth(req, res) {
  const session = getSessionFromReq(req);
  if (!session) {
    res.status(401).json({ error: 'Authentication required.' });
    return null;
  }
  return session;
}

async function readMeasurements() {
  const value = await getDashboardSetting(MEASUREMENT_KEY);
  return value && typeof value === 'object' ? value : {};
}

export default async function handler(req, res) {
  if (!auth(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

  const { fileCode, sourceAccountId } = req.body || {};
  if (!fileCode || !sourceAccountId) {
    return res.status(400).json({ error: 'fileCode and sourceAccountId are required.' });
  }
  if (inFlight.has(fileCode)) {
    return res.status(202).json({ status: 'pending', fileCode });
  }

  let measurements;
  try {
    measurements = await readMeasurements();
    const prior = measurements[fileCode];
    if (prior?.attemptedAt) {
      return res.status(200).json({
        status: prior.sizeBytes !== null && prior.sizeBytes !== undefined ? 'measured' : 'unavailable',
        fileCode,
        sizeBytes: prior.sizeBytes ?? null,
        attemptedAt: prior.attemptedAt,
        message: prior.message || null,
      });
    }

    const attemptedAt = new Date().toISOString();
    measurements[fileCode] = { attemptedAt, sizeBytes: null, status: 'pending' };
    await saveDashboardSetting(MEASUREMENT_KEY, measurements);
    inFlight.add(fileCode);

    // The account-specific call disables failover, so this operation consumes
    // at most one Vidmoly request for this file.
    const response = await vidmoly.fileInfoForAccount(sourceAccountId, fileCode);
    const sizeBytes = getMeasuredSizeFromResponse(response);
    const result = {
      attemptedAt,
      sizeBytes: sizeBytes === null ? null : sizeBytes,
      status: sizeBytes === null ? 'unavailable' : 'measured',
      message: sizeBytes === null ? 'Vidmoly did not return a file size.' : null,
    };
    measurements[fileCode] = result;
    await saveDashboardSetting(MEASUREMENT_KEY, measurements);
    if (sizeBytes !== null) {
      await cacheFileSize(fileCode, sizeBytes);
      await patchVidmolyLibraryFile(fileCode, { size: sizeBytes });
    }
    return res.status(200).json({ ...result, fileCode });
  } catch (error) {
    // Keep the attempted marker: automatic refreshes must not retry endlessly.
    try {
      measurements = measurements || await readMeasurements();
      measurements[fileCode] = {
        attemptedAt: measurements[fileCode]?.attemptedAt || new Date().toISOString(),
        sizeBytes: null,
        status: 'unavailable',
        message: error.message,
      };
      await saveDashboardSetting(MEASUREMENT_KEY, measurements);
    } catch (persistError) {
      console.error('Could not persist Vidmoly size measurement state:', persistError.message);
    }
    return res.status(502).json({ error: error.message, fileCode, sizeBytes: null });
  } finally {
    inFlight.delete(fileCode);
  }
}
