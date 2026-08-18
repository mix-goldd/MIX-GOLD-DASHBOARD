const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    include: ['test/**/*.test.cjs'],
    environment: 'node',
    globals: true,
  },
});
