const { getMeasuredSizeFromResponse, mergeMeasuredSize } = require('../lib/vidmolySizeMeasurement');

describe('Vidmoly size measurement', () => {
  it('extracts a byte size from a nested file info response', () => {
    expect(getMeasuredSizeFromResponse({ status: 200, result: { file: { size_bytes: '12 MB' } } })).toBe(12 * 1024 * 1024);
  });

  it('extracts a content length without treating unrelated numbers as a size', () => {
    expect(getMeasuredSizeFromResponse({ result: { content_length: 987654 } })).toBe(987654);
  });

  it('returns null when Vidmoly omits size metadata', () => {
    expect(getMeasuredSizeFromResponse({ status: 200, result: { file_code: 'abc', views: 4, length: 120 } })).toBeNull();
  });

  it('updates only the measured file row', () => {
    const files = [{ file_code: 'a', size: null }, { file_code: 'b', size: null }];
    expect(mergeMeasuredSize(files, 'b', 2048)).toEqual([{ file_code: 'a', size: null }, { file_code: 'b', size: 2048 }]);
  });
});
