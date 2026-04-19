# Data-Store

数据存储层模块集合，提供数据持久化与缓存能力。

---

## 📦 模块列表

| 模块 | 描述 | 实施计划 |
|------|------|----------|
| [[Data-Store/Dialog-Store/README\|Dialog-Store]] | 对话数据存储 | [[Data-Store/Dialog-Store/plan/README\|查看]] |

---

## 🔗 依赖关系

```
Data-Store
    └── Dialog-Store (对话存储)
        ├── PostgreSQL-Manager (数据库)
        └── 无业务依赖
```

---

## 设计原则

### 缓存同步机制

Dialog-Store 使用**引用共享 + 通知广播**机制实现缓存同步：

1. **Entity 持有 ref 引用**：指向缓存池中的对象
2. **set* 方法广播通知**：调用 `DBCache.proc` 通知缓存协调器
3. **协调器直接修改缓存对象**：所有 Entity 的 ref 自动更新

详见 [[Data-Store/Dialog-Store/README#⚡ 缓存同步机制（重要）|Dialog-Store 缓存同步机制]]

---

*最后更新: 2026-04-20*
