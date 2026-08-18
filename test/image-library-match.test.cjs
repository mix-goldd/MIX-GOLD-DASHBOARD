const { findMediaLibraryMatch, normalizeImageName } = require('../lib/mediaLibraryMatch');

describe('media library image matching', () => {
  it('normalizes spaces, punctuation, and file extensions', () => {
    expect(normalizeImageName('  هجوم العمالقة - الحلقة الأولى.JPG  ')).toBe('هجوم العمالقة الحلقة الأولى');
    const match = findMediaLibraryMatch('هجوم العمالقة الحلقة الأولى', [
      { id: 'img-1', name: 'هجوم العمالقة - الحلقة الأولى.JPG', url: 'https://images.example/attack.jpg' },
    ]);
    expect(match).toMatchObject({ id: 'img-1', image_url: 'https://images.example/attack.jpg' });
  });

  it('returns the strongest matching image and ignores unrelated names', () => {
    const match = findMediaLibraryMatch('One Piece 12', [
      { id: 'wrong', name: 'One Piece 1.png', url: 'https://images.example/1.png' },
      { id: 'right', name: 'One Piece 12.webp', url: 'https://images.example/12.webp' },
    ]);
    expect(match.id).toBe('right');
    expect(findMediaLibraryMatch('Naruto', [{ name: 'Bleach.jpg', url: 'https://images.example/b.jpg' }])).toBeNull();
  });

  it('supports display_url or thumb when the primary URL is absent', () => {
    expect(findMediaLibraryMatch('cover', [{ name: 'cover.png', display_url: 'https://images.example/display.png' }])).toMatchObject({
      image_url: 'https://images.example/display.png',
    });
    expect(findMediaLibraryMatch('thumb', [{ name: 'thumb.png', thumb: 'https://images.example/thumb.png' }])).toMatchObject({
      image_url: 'https://images.example/thumb.png',
    });
  });
});
