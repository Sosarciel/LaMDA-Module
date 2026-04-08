# Business-Domain

业务域模块集合，包含对话和角色相关的业务逻辑。

---

## 📦 模块列表

- [[Business-Domain/Dialog-Domain/README|Dialog-Domain]] — 对话域 → [[Business-Domain/Dialog-Domain/plan/README|实施计划]]
- [[Business-Domain/CharProfile-Domain/README|CharProfile-Domain]] — 角色档案域 → [[Business-Domain/CharProfile-Domain/plan/README|实施计划]]
- [[Business-Domain/User-Domain/README|User-Domain]] — 用户域 → [[Business-Domain/User-Domain/plan/README|实施计划]]

---

## 🔗 依赖关系

```
Business-Domain
    ├── Dialog-Domain (对话管理)
    │   └── 依赖: Dialog-Store, CharProfile-Domain
    ├── CharProfile-Domain (角色档案)
    │   └── 依赖: 无
    └── User-Domain (用户管理)
        └── 依赖: 无
```

---

*最后更新: 2026-04-09*
