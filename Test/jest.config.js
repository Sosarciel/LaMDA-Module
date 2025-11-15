



module.exports = {
    roots: ['./src'],
    transform: {
        '^.+\\.tsx?$': 'ts-jest',
    },
    moduleNameMapper: {
        '^@/src/(.*)$': '<rootDir>/dist/$1',
        '^@/(.*)$': '<rootDir>/$1',
        '^@$': '<rootDir>/dist/index'
    },
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
    setupFilesAfterEnv: ["<rootDir>/dist/setup.js"],
};
