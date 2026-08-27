const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    include: ['test/**/*.test.cjs'],
    exclude: [
      'test/adsterra-earnings-merge.test.cjs',
      'test/content-card-rectangle-layout.test.cjs',
      'test/domain-routing.test.cjs',
      'test/earnings-vidmoly-balance-visibility.test.cjs',
      'test/facebook-share-button.test.cjs',
      'test/gemini-vercel-env-name.test.cjs',
      'test/general-content-labels.test.cjs',
      'test/post-publishing-workflow.test.cjs',
      'test/statistics-selection-details.test.cjs',
      'test/vidmoly-renewal-message.test.cjs',
    ],
    environment: 'node',
    globals: true,
  },
});
