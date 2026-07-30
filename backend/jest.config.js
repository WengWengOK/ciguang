module.exports = {
    testEnvironment: 'node',
    testMatch: ['**/tests/**/*.test.js'],
    collectCoverageFrom: [
        'routes/**/*.js',
        'middleware/**/*.js',
        'agent/**/*.js',
        'services/**/*.js',
        'tools/**/*.js'
    ],
    coverageDirectory: 'coverage',
    setupFilesAfterEnv: ['<rootDir>/tests/setup.js']
};
