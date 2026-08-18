const fs = require('fs');
const path = require('path');

describe('content post cards', () => {
  const source = fs.readFileSync(path.join(__dirname, '../pages/dashboard/content.js'), 'utf8');

  it('does not render the description inside the card list', () => {
    expect(source).not.toContain('item.description ? <div className="helper-text"');
  });

  it('keeps the story summary field available in the editor', () => {
    expect(source).toContain('ملخص القصة / الوصف');
    expect(source).toContain('value={form.description}');
  });
});
