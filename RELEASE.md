# 模块发布指南

## 模块分类

LaMDA 项目模块按功能分为以下几类：

### 1. Service-Manager（服务管理模块）
负责特定服务的配置和管理，如语言模型、TTS、翻译等。

| 模块名 | npm包名 | 仓库 |
|--------|---------|------|
| LaM-Manager | `@sosraciel-lamda/lam-manager` | LaMDA-LaM-Manager |
| TTS-Manager | `@sosraciel-lamda/tts-manager` | LaMDA-TTS-Manager |
| Translation-Manager | `@sosraciel-lamda/translation-manager` | LaMDA-Translation-Manager |
| PostgreSQL-Manager | `@sosraciel-lamda/postgresql-manager` | LaMDA-PostgreSQL-Manager |
| CommApi-Manager | `@sosraciel-lamda/commapi-manager` | LaMDA-CommApi-Manager |

### 2. Business-Domain（业务领域模块）
包含核心业务逻辑和数据模型。

| 模块名 | npm包名 | 仓库 |
|--------|---------|------|
| CharProfile-Domain | `@sosraciel-lamda/charprofile-domain` | LaMDA-CharProfile-Domain |

### 3. CommPlatform-ProtoClient（通讯平台协议客户端）
实现不同通讯平台的协议客户端。

| 模块名 | npm包名 | 仓库 |
|--------|---------|------|
| OneBot11-ProtoClient | `@sosraciel-lamda/onebot11-protoclient` | LaMDA-OneBot11-ProtoClient |
| KOOK-ProtoClient | `@sosraciel-lamda/kook-protoclient` | LaMDA-KOOK-ProtoClient |

---

## 命名规则

### npm 包命名
- **格式**: `@sosraciel-lamda/<模块名>`
- **作用域**: `@sosraciel-lamda`
- **模块名**: 小写，用连字符分隔
- **后缀规则**:
  - Service-Manager: 无后缀或 `-manager`
  - Business-Domain: `-domain` 后缀
  - ProtoClient: `-protoclient` 后缀

```
@sosraciel-lamda/lam-manager          # Service-Manager
@sosraciel-lamda/charprofile-domain   # Business-Domain
@sosraciel-lamda/onebot11-protoclient # ProtoClient
```

### Git 仓库命名
- **格式**: `LaMDA-<模块名>`
- **命名风格**: PascalCase
- **后缀规则**: 与 npm 包相同

```
LaMDA-LaM-Manager          # Service-Manager
LaMDA-CharProfile-Domain   # Business-Domain
LaMDA-OneBot11-ProtoClient # ProtoClient
```

### 目录命名
- **格式**: `<分类目录>/<模块名>`
- **模块名**: PascalCase

```
Service-Manager/LaM-Manager
Business-Domain/CharProfile-Domain
CommPlatform-ProtoClient/OneBot11-ProtoClient
```

---

## Git 仓库配置

### 发布组织
所有模块发布到 **Sosarciel** 组织下：
```
https://github.com/Sosarciel/<仓库名>
```

### 主分支
- **主分支名**: `main`
- 不要使用 `master` 或其他名称

### 仓库 URL 格式
```
https://github.com/Sosarciel/LaMDA-<模块名>.git
```

---

## .modulelinks 配置

在 `LaMDA-Module/.modulelinks` 中添加模块引用：

```ini
[submodule "Service-Manager/<模块名>"]
	path = Service-Manager/<模块名>
	url = https://github.com/Sosarciel/LaMDA-<模块名>.git
```

示例：
```ini
[submodule "Service-Manager/TTS-Manager"]
	path = Service-Manager/TTS-Manager
	url = https://github.com/Sosarciel/LaMDA-TTS-Manager.git
```

---

## package.json 配置

### 必要字段

```json
{
    "name": "@sosraciel-lamda/<模块名>",
    "version": "1.0.0",
    "repository": "https://github.com/Sosarciel/LaMDA-<模块名>.git",
    "author": "zwa73",
    "license": "ISC",
    "description": "<模块描述>",
    "files": ["dist", "data", "schema"],
    "exports": {
        ".": {
            "require": "./dist/index.js",
            "types": "./dist/index.d.ts"
        },
        "./mock": {
            "require": "./dist/mock/index.js",
            "types": "./dist/mock/index.d.ts"
        }
    }
}
```

### scripts 配置

```json
{
    "scripts": {
        "test": "jest",
        "compile": "powershell scripts/compile",
        "watch": "powershell scripts/watch",
        "build-schema": "powershell scripts/build-schema",
        "expand-macro": "powershell scripts/expand-macro",
        "build": "powershell scripts/pack",
        "release": "powershell scripts/release"
    }
}
```

---

## 参考项目

### Service-Manager 参考
- [LaMDA-LaM-Manager](https://github.com/Sosarciel/LaMDA-LaM-Manager) - 语言模型服务管理
- [LaMDA-TTS-Manager](https://github.com/Sosarciel/LaMDA-TTS-Manager) - TTS服务管理

### Business-Domain 参考
- [LaMDA-CharProfile-Domain](https://github.com/Sosarciel/LaMDA-CharProfile-Domain) - 角色档案领域

### ProtoClient 参考
- [LaMDA-OneBot11-ProtoClient](https://github.com/Sosarciel/LaMDA-OneBot11-ProtoClient) - OneBot11协议客户端

---

## 发布流程

### 1. 创建 GitHub 仓库
```bash
# 在 GitHub 上创建仓库
# 组织: Sosarciel
# 仓库名: LaMDA-<模块名>
# 主分支: main
```

### 2. 初始化本地仓库
```bash
cd LaMDA-Module/<分类目录>/<模块名>
git init
git branch -M main
git remote add origin https://github.com/Sosarciel/LaMDA-<模块名>.git
```

### 3. 推送代码
```bash
git add .
git commit -m "Initial commit"
git push -u origin main
```

### 4. 更新 .modulelinks
在 `LaMDA-Module/.modulelinks` 添加新模块配置

### 5. 更新 workspace 配置
在 `LaMDA-Module/package.json` 的 workspaces 中添加新模块路径
