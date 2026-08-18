/*
 * Source: sizes transcribed from the Vidmoly account views supplied by the
 * project owner on 2026-08-15. Vidmoly's authenticated list, list2, and
 * file/info endpoints did not return a reliable byte-size field for these
 * existing files, so this idempotent backfill preserves the confirmed sizes.
 *
 * Run manually only when needed:
 *   CONFIRM_VIDMOLY_SIZE_BACKFILL=1 node scripts/backfill-vidmoly-known-sizes.cjs
 */
const { cacheFileSize } = require('../lib/db');

const MEBIBYTE = 1024 ** 2;
const knownFiles = Object.freeze([
  { fileCode: 'iwsl5sate3yp', sizeMB: 70.32 },
  { fileCode: 'myhzsxlziiie', sizeMB: 166.0 },
  { fileCode: '9gohhzvqluoc', sizeMB: 222.23 },
  { fileCode: 'na33feylsxw5', sizeMB: 224.56 },
  { fileCode: '68yois691b2d', sizeMB: 204.96 },
  { fileCode: 'zwp3hqbxlu5p', sizeMB: 334.66 },
  { fileCode: '2qz3o1q11kpj', sizeMB: 689.77 },
]);

async function backfillKnownVidmolySizes(saveSize = cacheFileSize) {
  await Promise.all(knownFiles.map(({ fileCode, sizeMB }) => (
    saveSize(fileCode, Math.round(sizeMB * MEBIBYTE))
  )));
  return knownFiles.reduce((sum, file) => sum + file.sizeMB, 0);
}

if (require.main === module) {
  if (process.env.CONFIRM_VIDMOLY_SIZE_BACKFILL !== '1') {
    console.error('Refusing to write. Run with CONFIRM_VIDMOLY_SIZE_BACKFILL=1 after reviewing the source note.');
    process.exitCode = 1;
  } else {
    backfillKnownVidmolySizes()
      .then((totalMB) => console.log(JSON.stringify({ cachedFiles: knownFiles.length, totalMB })))
      .catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
      });
  }
}

module.exports = { MEBIBYTE, knownFiles, backfillKnownVidmolySizes };
