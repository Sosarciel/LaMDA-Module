const { pathsToModuleNameMapper } = require('ts-jest');
const { compilerOptions } = require('./tsconfig.json');


// 通用基础配置
const commonConfig = {
    roots: ['<rootDir>/src'],
    // `backup/` 是归档区（指挥官定：把设计真实生图的测试集与 Conductor 丢去 backup，
    // 只保留自行拉起的测试）。`testMatch` 的 `**` 会递归匹配到归档文件，
    // 不排除的话它们仍会被当作测试执行 —— 归档就失去了意义。
    testPathIgnorePatterns: ['/node_modules/', '/backup/'],
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
    projects: defaultProjects,

    // ⚠️ **只在根级设置才生效** —— 写进 project 对象里的 maxWorkers 会被忽略。
    // 实测（2026-10-12）：写进 real-api 的 project 对象后，两个测试文件
    // 仍然真的并行（日志里同一秒出现两行「守护循环启动」）。
    //
    // 为什么必须串行：real-api 测试全都作用于**同一个远端实例**
    // （同一批远端端口 6006/6008）与**一批共享的本地端口**，
    // 并行时两个进程各起一个 AutoDLManager 去抢这些资源，
    // 表现为 `Address already in use`、`ECONNREFUSED` 等一堆假失败。
    // 这与 db 项目需要串行的原因是同一类。
    //
    // 命令行传 `--runInBand` 也能达到同样效果，但不能指望调用方每次都记得传。
    maxWorkers: 1,
};
