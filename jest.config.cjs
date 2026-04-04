module.exports = {
  preset: 'ts-jest/presets/default-esm',
  roots: [
    '<rootDir>/packages/shared/test',
    '<rootDir>/packages/review-aggregator/test',
  ],
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: '<rootDir>/tsconfig.base.json',
      },
    ],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@workspace/shared$': '<rootDir>/packages/shared/src/index.ts',
  },
  collectCoverageFrom: [
    'packages/shared/src/**/*.ts',
    'packages/review-aggregator/src/**/*.ts',
  ],
};
