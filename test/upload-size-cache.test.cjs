const { cacheKnownUploadSize } = require('../lib/uploadSizeCache');

describe('Upload size cache', () => {
  test('stores the exact size from a local upload once Vidmoly returns a file code', async () => {
    const saveSize = vi.fn().mockResolvedValue(undefined);

    await expect(cacheKnownUploadSize(saveSize, 'local-file', 1048576)).resolves.toBe(true);
    expect(saveSize).toHaveBeenCalledWith('local-file', 1048576);
  });

  test('stores a source Content-Length from a URL upload and rejects unknown values', async () => {
    const saveSize = vi.fn().mockResolvedValue(undefined);

    await expect(cacheKnownUploadSize(saveSize, 'remote-file', '2097152')).resolves.toBe(true);
    await expect(cacheKnownUploadSize(saveSize, 'remote-file', null)).resolves.toBe(false);
    expect(saveSize).toHaveBeenCalledTimes(1);
    expect(saveSize).toHaveBeenCalledWith('remote-file', 2097152);
  });
});
