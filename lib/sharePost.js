export function buildShareText({ title = '', description = '', url = '' } = {}) {
  return [title, description, url].filter((value) => value !== '').join('\n\n');
}
