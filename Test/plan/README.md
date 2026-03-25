---
aliases: [Test 测试计划索引]
---
# Test 测试计划索引

> 本文档索引 Test 模块的所有测试计划

---

## 📋 进行中计划
```base
filters:
  and:
    - file.folder == "LaMDA-Module/Test/plan"
    - file.name != "README"
    - file.name != "TEST_ROADMAP"
views:
  - type: table
    name: 计划一览
    order:
      - file.name
      - aliases
      - file.mtime
    sort:
      - property: file.mtime
        direction: DESC

```

---

## 📁 已归档计划
```base
filters:
  and:
    - file.path.startsWith("LaMDA-Module/Test/plan/archive")
views:
  - type: table
    name: 归档一览
    order:
      - file.name
      - aliases
      - file.mtime
    sort:
      - property: file.mtime
        direction: DESC

```

---

## 🗺️ 测试路线图

### ⏳ 待完成测试

| 模块 | 状态 | 计划文件 |
|------|------|----------|
| TTS-Manager | ⏳ 计划中 | [tts-translation-manager-test-plan](./tts-translation-manager-test-plan.md) |
| Translation-Manager | ⏳ 计划中 | [tts-translation-manager-test-plan](./tts-translation-manager-test-plan.md) |
| RulePipe | ⏳ 计划中 | [rulepipe-test-plan](./rulepipe-test-plan.md) |
| PermissionManager | ⏳ 未开始 | [server-module-test-plan](./server-module-test-plan.md) |

### 📊 测试统计

| 模块 | 状态 | 测试文件数 |
|------|------|-----------|
| LaM-Manager | ✅ 完成 | 9 |
| Dialog-Domain | ✅ 完成 | 1 |
| PostgreSQL-Manager | ✅ 完成 | 2 |
| Text-Processor | ✅ 完成 | 3 |
| CharProfile-Domain | ✅ 完成 | 1 |
| TTS-Manager | ⏳ 计划中 | 0 |
| Translation-Manager | ⏳ 计划中 | 0 |
| RulePipe | ⏳ 计划中 | 0 |
| PermissionManager | ⏳ 未开始 | 0 |

### 📅 更新日志

- **2026-03-21**: 创建路线图文档，归档已完成的LaM-Manager测试计划

> 详细历史见 [archive/test-history](./archive/test-history.md)

---

*最后更新: 2026-03-25*
