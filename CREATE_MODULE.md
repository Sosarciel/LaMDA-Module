# 模块创建指南

## 快速开始

### 1. 复制模板

从 `template` 目录复制基础模板：

```bash
cd LaMDA-Module
cp -r template <分类目录>/<新模块名>
```

示例：
```bash
cp -r template Service-Manager/NewService-Manager
cp -r template Business-Domain/NewDomain-Domain
```

---

## 目录结构

创建的模块应包含以下结构：

```
<模块名>/
├── scripts/
│   ├── compile.ps1      # 编译脚本
│   ├── watch.ps1        # 监听编译
│   ├── build-schema.ps1 # JSON Schema 生成
│   ├── expand-macro.ps1 # 宏展开
│   ├── pack.ps1         # 打包
│   └── release.ps1      # 发布
├── src/
│   ├── index.ts         # 入口文件
│   └── *.ts             # 源代码
├── data/                # 数据文件（可选）
│   └── mock/            # Mock 数据
├── schema/              # JSON Schema（自动生成）
├── .gitignore
├── package.json
├── tsconfig.json
└── tsconfig.compile.json
```

---

## 配置文件

### package.json

```json
{
    "name": "@sosraciel-lamda/<模块名>",
    "version": "1.0.0",
    "exports": {
        ".": {
            "require": "./dist/index.js",
            "types": "./dist/index.d.ts"
        },
        "./mock": {
            "require": "./dist/mock/index.js",
            "types": "./dist/mock/index.d.ts"
        }
    },
    "scripts": {
        "test": "jest",
        "compile": "powershell scripts/compile",
        "watch": "powershell scripts/watch",
        "build-schema": "powershell scripts/build-schema",
        "expand-macro": "powershell scripts/expand-macro",
        "build": "powershell scripts/pack",
        "release": "powershell scripts/release"
    },
    "repository": "https://github.com/Sosarciel/LaMDA-<模块名>.git",
    "author": "zwa73",
    "license": "ISC",
    "description": "<模块描述>",
    "files": [
        "dist",
        "data",
        "schema"
    ],
    "dependencies": {
        "@zwa73/utils": "^1.0.287"
    },
    "devDependencies": {
        "@types/node": "^22.0.0"
    }
}
```

### tsconfig.json

```json
{
    "compilerOptions": {
        "target": "ES2022",
        "module": "CommonJS",
        "moduleResolution": "Node",
        "declaration": true,
        "outDir": "./dist",
        "rootDir": "./src",
        "strict": true,
        "esModuleInterop": true,
        "skipLibCheck": true,
        "forceConsistentCasingInFileNames": true,
        "resolveJsonModule": true
    },
    "include": ["src/**/*"],
    "exclude": ["node_modules", "dist"]
}
```

### tsconfig.compile.json

```json
{
    "extends": "./tsconfig.json",
    "compilerOptions": {
        "declaration": false
    }
}
```

### .gitignore

```
node_modules/
dist/
*.log
.DS_Store
```

---

## 代码规范

### 入口文件 (src/index.ts)

```typescript
// 导出公共接口
export * from "./ModuleClass";
export * from "./types";
```

### Manager 模式

Service-Manager 类型的模块应使用 `UtilFunc.createInjectable` 模式：

```typescript
import { UtilFunc } from "@zwa73/utils";

/**管理器选项 */
export type ManagerOption = {
    configPath: string;
};

/**服务管理器 */
export const ServiceManager = UtilFunc.createInjectable({
    initInject: (opt: ManagerOption) => {
        const { configPath } = opt;
        
        // 私有状态
        const serviceTable: Record<string, any> = {};
        
        return {
            /**获取服务实例 */
            getService: async (id: string) => {
                if (serviceTable[id] == null) {
                    // 初始化服务
                    serviceTable[id] = await createService(id);
                }
                return serviceTable[id];
            },
            
            /**重载配置 */
            reloadConfig: async () => {
                // 重载逻辑
            }
        };
    }
});
```

### Domain 模式

Business-Domain 类型的模块应包含数据模型和业务逻辑：

```typescript
/**领域模型 */
export class DomainModel {
    private constructor(private data: DataType) {}
    
    static async create(id: string): Promise<DomainModel> {
        const data = await loadData(id);
        return new DomainModel(data);
    }
    
    getData(): DataType {
        return this.data;
    }
}
```

### Mock 工具

提供测试用的 Mock 数据和工具：

```typescript
// src/mock/index.ts
export * from "./MockTool";

// src/mock/MockTool.ts
import path from "pathe";

/**Mock 数据路径 */
const MOCK_DATA_PATH = path.join(__dirname, "../../data/mock");

/**Mock 工具 */
export const MockTool = {
    MOCK_IDS: ["Mock1", "Mock2"],
    
    getMockPath: (id: string) => 
        path.join(MOCK_DATA_PATH, id),
    
    getMockConfigPath: (id: string) => 
        path.join(MOCK_DATA_PATH, id, "config.json"),
};
```

---

## 注册到 Workspace

### 1. 更新 LaMDA-Module/package.json

在 `workspaces` 数组中添加新模块路径：

```json
{
    "workspaces": [
        "Service-Manager/LaM-Manager",
        "Service-Manager/TTS-Manager",
        "Service-Manager/NewService-Manager",  // 新增
        "Business-Domain/CharProfile-Domain",
        "Business-Domain/NewDomain-Domain",    // 新增
        "CommPlatform-ProtoClient/*",
        "GenericSchema",
        "Test",
        "template"
    ]
}
```

### 2. 更新 .gitignore

在 `LaMDA-Module/.gitignore` 中添加：

```
# 新模块目录（如果需要）
Service-Manager/NewService-Manager/
Business-Domain/NewDomain-Domain/
```

### 3. 更新 .modulelinks

```ini
[submodule "Service-Manager/NewService-Manager"]
	path = Service-Manager/NewService-Manager
	url = https://github.com/Sosarciel/LaMDA-NewService-Manager.git
```

---

## 编译验证

### 1. 类型检查
```bash
tsc --noEmit
```

### 2. 编译
```bash
npm run compile
```

### 3. 安装依赖
```bash
cd LaMDA-Module
npm install
```

---

## 测试

### 在 Test 项目中创建测试

```
LaMDA-Module/Test/
└── src/
    └── NewModule/
        └── newmodule.test.ts
```

测试文件模板：

```typescript
import { ServiceManager } from "@sosraciel-lamda/new-module";

describe("NewModule 测试", () => {
    beforeAll(async () => {
        ServiceManager.initInject({ configPath: TEST_CONFIG_PATH });
    }, 30000);

    test("1. 应正确初始化", async () => {
        const service = await ServiceManager.getService("test");
        expect(service).toBeDefined();
    });
});
```

---

## 完整创建流程

```bash
# 1. 复制模板
cd LaMDA-Module
cp -r template Service-Manager/NewService-Manager

# 2. 修改配置
cd Service-Manager/NewService-Manager
# 编辑 package.json, tsconfig.json

# 3. 编写代码
# 编辑 src/*.ts

# 4. 类型检查
tsc --noEmit

# 5. 编译
npm run compile

# 6. 注册到 workspace
# 编辑 LaMDA-Module/package.json

# 7. 安装依赖
cd LaMDA-Module
npm install

# 8. 创建 Git 仓库
cd Service-Manager/NewService-Manager
git init
git branch -M main
git remote add origin https://github.com/Sosarciel/LaMDA-NewService-Manager.git

# 9. 推送代码
git add .
git commit -m "Initial commit"
git push -u origin main

# 10. 更新 .modulelinks
# 编辑 LaMDA-Module/.modulelinks
```

---

## 参考项目

| 类型 | 参考项目 |
|------|----------|
| Service-Manager | `Service-Manager/LaM-Manager` |
| Business-Domain | `Business-Domain/CharProfile-Domain` |
| ProtoClient | `CommPlatform-ProtoClient/OneBot11-ProtoClient` |
| 模板 | `template/` |
