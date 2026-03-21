# 模块创建指南

## 快速创建

### 1. 复制模板

```bash
cd LaMDA-Module
cp -r template <分类目录>/<新模块名>
```

**分类目录说明**：
| 分类 | 用途 | 命名示例 |
|------|------|----------|
| `Service-Manager/` | 服务管理器 | `LaM-Manager`、`PostgreSQL-Manager` |
| `Business-Domain/` | 业务领域 | `Dialog-Domain`、`CharProfile-Domain` |
| `Common-Utility/` | 通用工具 | `Text-Processor` |
| `CommPlatform-ProtoClient/` | 平台协议客户端 | `OneBot11-ProtoClient`、`KOOK-ProtoClient` |

### 2. 修改 package.json

编辑新模块的 `package.json`，修改以下字段：

```json
{
    "name": "@sosraciel-lamda/<模块名>",
    "description": "<模块描述>",
    "repository": "https://github.com/Sosarciel/LaMDA-<模块名>.git"
}
```

### 3. 注册模块

在以下三个位置添加模块配置：

**LaMDA-Module/package.json** (workspaces):
```json
{
    "workspaces": [
        "./<分类目录>/<模块名>",
        ...
    ]
}
```

**LaMDA-Module/.modulelinks**:
```ini
[submodule "<分类目录>/<模块名>"]
    path = <分类目录>/<模块名>
    url = https://github.com/Sosarciel/LaMDA-<模块名>.git
```

**LaMDA-Module/.git/info/exclude** (multrepo忽略子模块):
```
<分类目录>/<模块名>/
```

### 4. 安装依赖

```bash
cd LaMDA-Module
npm install
```

### 5. 编译验证

```bash
cd <分类目录>/<模块名>
tsc --noEmit
npm run compile
```

---

## 模块结构

复制模板后自动包含：

```
<模块名>/
├── scripts/          # 构建脚本
├── src/              # 源代码
│   └── index.ts      # 入口文件
├── .gitignore
├── package.json
├── tsconfig.json
└── tsconfig.compile.json
```

---

## 参考项目

| 类型 | 参考项目 |
|------|----------|
| Service-Manager | `Service-Manager/LaM-Manager` |
| Business-Domain | `Business-Domain/CharProfile-Domain` |
| Common-Utility | `Common-Utility/Text-Processor` |
| ProtoClient | `CommPlatform-ProtoClient/OneBot11-ProtoClient` |
| 模板 | `template/` |

开发时请参考对应类型的现有项目，了解代码模式和最佳实践。
