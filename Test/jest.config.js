const { pathsToModuleNameMapper } = require('ts-jest');
const { compilerOptions } = require('./tsconfig.json');

const dbTestSet = [
    "<rootDir>/src/PostgresSQL-Manager/**/*.test.ts",
    "<rootDir>/src/CharProfile-Domain/**/*.test.ts",
    "<rootDir>/src/Dialog-Domain/**/*.test.ts",
];

// 通用基础配置
const commonConfig = {
    roots: ['<rootDir>/src'],
    transform: {
        '^.+\\.tsx?$': 'ts-jest',
    },
    moduleNameMapper: pathsToModuleNameMapper(compilerOptions.paths, { prefix: '<rootDir>/' }),
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
    setupFilesAfterEnv: ["<rootDir>/src/setup.ts"],
};

module.exports = {
    // 根目录配置
    rootDir: './',
    projects: [
        {
            ...commonConfig,
            displayName: "db",
            testMatch: dbTestSet,
            maxWorkers: 1, // 确保串行
        },
        {
            ...commonConfig,
            displayName: "unit",
            testMatch: ["<rootDir>/src/**/*.test.ts"],
            // 排除 DB 目录：直接使用简单的文件夹关键字正则通常更有效
            testPathIgnorePatterns: [
                "/PostgresSQL-Manager/",
                "/CharProfile-Domain/",
                "/Dialog-Domain/",
            ],
        }
    ]
};