# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 提供在 Test 模块中工作时的指导规范。

## 模块概述

Test 模块是 Sosarciel-LaMDA 系统的测试模块，专门用于验证 LaM-Manager 的功能和集成测试。模块采用 Jest 作为测试框架，支持单元测试和集成测试，并使用 Mock 服务器进行无依赖的测试环境搭建。

**核心功能**：
- **集成测试测试**: 测试 LaM-Manager 与各模型服务的交互
- **Mock 服务器**: 提供模拟的模型 API 响应
- **测试数据管理**: 自动生成和管理测试所需的模拟数据
- **多模型测试**: 支持 GPT、Deepseek、Gemini 等多种模型的测试验证

## 开发命令

模块使用 npm workspaces 管理，以下是可用的脚本命令：

```bash
# 编译 TypeScript
npm run compile           # 全量编译 (使用 PowerShell 脚本 scripts/compile.ps1)
npm run watch             # 监听模式编译 (scripts/watch.ps1)
npm run expand-macro      # 编译前展开宏 (scripts/expand-macro.ps1)

# 构建与发布
npm run build-schema      # 从 TypeScript 类型生成 JSON Schema (scripts/build-schema.ps1)
npm run build             # 打包模块为 .tgz 文件 (scripts/pack.ps1)

# 测试
npm run test              # 运行 Jest 测试
```

**注意**：所有编译脚本均使用 PowerShell 编写，位于 `scripts/` 目录下。

## 架构说明

### 目录结构

```
src/                       # 源代码
├── setup.ts                # 测试环境设置（Mock 服务器）
├── Constant.ts             # 测试常量定义
├── LaM-Manager/            # LaM-Manager 测试
│   └── index.test.ts       # 核心功能集成测试
└── Regexp/                 # 正则表达式测试
    ├── Regexp.ts           # 正则表达式工具
    └── fixMarkdown.test.ts # Markdown 修复测试

scripts/                    # PowerShell 构建脚本
├── compile.ps1            # 编译脚本
├── watch.ps1               # 监听模式脚本
├── expand-macro.ps1       # 宏展开脚本
├── build-schema.ps1       # Schema 生成脚本
└── pack.ps1               # 打包脚本

jest/                      # Jest 配置和测试工具
├── setup.ts               # 全局测试设置
└── test-setup.ts          # 测试环境初始化

data/                      # 测试数据
└── cache/                 # 缓存文件
    ├── LaMManager.json    # 模拟服务配置
    ├── CredManager.json   # 模拟凭证配置
    └── CredCategory.json  # 模拟凭证分类

dist/                      # 编译输出
build/                     # 构建输出
release/                   # 发布文件
```

### 核心组件

1. **测试环境设置 (setup.ts)**
   - 启动 Mock 服务器（端口 3000）
   - 提供测试前后的生命周期管理
   - 自动清理测试环境

2. **Mock 工具 (LaMManagerMockTool)**
   - 提供模拟的模型服务配置
   - 构建模型响应数据
   - 支持多种模型类型的模拟

3. **集成测试 (index.test.ts)**
   - 测试 LaM-Manager 的核心功能
   - 验证不同模型的对话能力
   - 模拟真实的使用场景

4. **正则表达式测试 (Regexp/)**
   - 验证文本处理功能
   - 测试 Markdown 修复逻辑
   - 提供文本格式化测试

### 测试数据流

```bash
测试初始化 → Mock 服务器启动 → 生成模拟数据 → 加载服务配置 → 运行测试 → 清理环境
    ↓            ↓             ↓           ↓            ↓           ↓
  setup.ts   LaMManagerMockServer  Mock工具    配置文件    Jest测试   清理脚本
```

## 配置管理

### 测试配置

- 测试数据通过 `data/cache/` 下的 JSON 文件管理
- 使用 Mock 工具生成初始测试数据
- 路径常量定义在 `src/Constant.ts` 中

### 路径别名

TypeScript 配置中定义了以下路径别名（见 `tsconfig.json`）：

- `@`: `./src/index`
- `@/src/*`: `./src/*`

## 代码质量与标准

### Jest

- 测试框架：Jest
- 测试类型：单元测试 + 集成测试
- 测试数据：使用 Mock 生成，避免真实 API 调用
- 断言：使用 Jest 的 expect 语法

### TypeScript

- 启用严格模式 (`strict: true`)
- 目标版本：ES2022
- 模块系统：Node16
- 生成声明文件 (`declaration: true`)

### 导入规范

- 使用路径别名代替相对路径
- 禁止跨模块的直接导入
- 测试工具单独管理

## 开发工作流

### 1. 本地开发

```bash
# 进入模块目录
cd F:\Sosarciel\Sosarciel-LaMDA\LaMDA-Module\Test

# 监听模式编译
npm run watch

# 在另一个终端运行测试
npm run test
```

### 2. 添加新测试

1. 在 `src/` 下创建测试文件（如 `new-feature.test.ts`）
2. 使用 Jest 测试结构：describe/it/expect
3. 导入必要的 Mock 工具和常量
4. 在测试文件中配置模拟数据
5. 运行测试验证功能

### 3. 集成测试指南

```typescript
// 示例：集成测试结构
beforeAll(async () => {
    // 设置测试环境
    await UtilFT.writeJSONFile(LaMServiceTablePath, mockData);
    LaMManager.initInject({ serviceTable: LaMServiceTablePath });
});

describe("测试组", () => {
    it("具体测试用例", async () => {
        // 执行测试
        const result = await LaMManager.chat.execute(instanceName, options);
        expect(result).toBeDefined();
    });
});
```

### 4. Mock 使用指南

```typescript
// 使用 Mock 工具
import { LaMManagerMockTool } from "@sosraciel-lamda/lam-manager/mock";

// 获取模拟数据
const mockTable = LaMManagerMockTool.MOCK_LAM_SERVICE_TABLE;
const mockResponse = LaMManagerMockTool.buildResp('ModelName', 'response');
```

## Claude Code 注意事项

- **模块独立性**: Test 模块是一个独立的测试模块，专门用于验证 LaM-Manager 的功能
- **Mock 驱动**: 所有测试使用 Mock 数据，不需要真实的 API 密钥
- **自动化设置**: 测试环境自动初始化和清理，无需手动干预
- **TypeScript 严格模式**: 代码必须通过严格类型检查
- **工作目录限制**: 如无必要，应仅在此目录（Test 模块）下工作，避免扫描父目录或其他模块
- **构建产物规避**: 如无必要，应避免扫描 `backup/`、`build/`、`dist/`、`schema/` 等目录，这些是代码构建/生成/备份的产物，不应作为主要工作对象
- **始终使用中文回复用户提问**

## 常见任务

### 添加新测试用例

1. 在 `src/` 下创建新的测试文件（遵循 `[feature].test.ts` 命名）
2. 使用 Jest 的测试结构：describe → it → expect
3. 导入必要的 Mock 工具和测试数据
4. 配置测试环境（如需要）
5. 编写具体的测试逻辑和断言

### 修改测试配置

1. 更新 `src/Constant.ts` 中的路径常量
2. 修改模拟数据文件（`data/cache/`）
3. 更新 Mock 工具的配置参数
4. 运行 `npm run build-schema` 生成新的 Schema

### 调试测试问题

1. 启用详细的日志输出（Jest 配置）
2. 检查 Mock 服务器的启动状态
3. 验证测试数据的正确性
4. 使用 `console.log` 或调试器跟踪执行流程

### 扩展测试覆盖

1. **模型测试扩展**: 为新的模型类型添加测试用例
2. **错误处理测试**: 添加异常情况的测试覆盖
3. **性能测试**: 添加性能基准测试
4. **边界测试**: 测试极端条件和边界值

### 测试最佳实践

1. **隔离性**: 每个测试用例应该独立运行
2. **可重复性**: 使用固定的随机种子或 Mock 数据
3. **清理**: 确保测试后清理资源
4. **文档**: 为复杂测试添加注释说明

---

*最后更新：2026-03-11*