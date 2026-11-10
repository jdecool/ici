// CI spreads the suite over runners. "rest" is defined by exclusion so a new
// slice is always mutated by some shard without touching this file.
const shards = {
  planning: ['src/features/planning/**/*.{ts,tsx}'],
  organization: ['src/features/organization/**/*.{ts,tsx}'],
  rest: [
    'src/**/*.{ts,tsx}',
    '!src/features/planning/**',
    '!src/features/organization/**',
  ],
};
const shard = process.env.MUTATION_SHARD;
if (shard && !Object.hasOwn(shards, shard)) {
  throw new Error(
    `Unknown MUTATION_SHARD "${shard}"; expected one of: ${Object.keys(shards).join(', ')}`,
  );
}

export default {
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.config.ts' },
  mutate: [
    ...(shard ? shards[shard] : ['src/**/*.{ts,tsx}']),
    '!src/**/*.test.{ts,tsx}',
    '!src/test/**',
    '!src/main.tsx',
    '!src/**/index.ts',
  ],
  reporters: ['clear-text', 'progress', 'html', 'json'],
  thresholds: { high: 100, low: 100, break: 100 },
  concurrency: 4,
  timeoutMS: 10000,
};
