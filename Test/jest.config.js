const { pathsToModuleNameMapper } = require('ts-jest');
const { compilerOptions } = require('./tsconfig.json');


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

const defaultProjects =[
    {
        ...commonConfig,
        displayName: "db",
        testMatch: ["<rootDir>/src/DB/**/*.test.ts"],
        maxWorkers: 1, // 确保串行
    },
    {
        ...commonConfig,
        displayName: "unit",
        testMatch: ["<rootDir>/src/Unit/**/*.test.ts"],
    }
]

// 只要没有显式传入 WITH_API=true，下面这个项目就不存在于 Jest 的视野中
if (process.env.WITH_API === 'true') {
    defaultProjects.push({
        ...commonConfig,
        displayName: "real-api",
        testMatch: ["<rootDir>/src/RealApi/**/*.test.ts"],
    });
}

module.exports =  {
    // 根目录配置
    rootDir: './',
    projects: defaultProjects
};