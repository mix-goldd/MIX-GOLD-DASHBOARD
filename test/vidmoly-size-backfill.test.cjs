const {
  MEBIBYTE,
  knownFiles,
  backfillKnownVidmolySizes,
} = require('../scripts/backfill-vidmoly-known-sizes.cjs');

describe('Vidmoly known-size backfill', () => {
  test('is auditable and writes the confirmed seven file sizes in bytes', async () => {
    const saveSize = vi.fn().mockResolvedValue(undefined);

    const totalMB = await backfillKnownVidmolySizes(saveSize);

    expect(knownFiles).toHaveLength(7);
    expect(totalMB).toBeCloseTo(1912.5);
    expect(saveSize).toHaveBeenCalledTimes(7);
    expect(saveSize).toHaveBeenCalledWith('iwsl5sate3yp', Math.round(70.32 * MEBIBYTE));
    expect(saveSize).toHaveBeenCalledWith('2qz3o1q11kpj', Math.round(689.77 * MEBIBYTE));
  });
});
