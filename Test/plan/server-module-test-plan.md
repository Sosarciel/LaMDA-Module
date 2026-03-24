---
aliases: [Server 模块测试计划]
---
# Server 模块测试计划

## 已完成测试

### CharProfile-Domain ✅
- 测试文件: `Test/src/CharProfile-Domain/charprofile-domain.test.ts`
- 内容: 角色档案管理功能测试

### LaM-Manager ✅
- 测试文件: `Test/src/LaM-Manager/index.test.ts`, `Test/src/LaM-Manager/Formatter/**/*.test.ts`
- 内容: LaM管理器集成测试和Formatter单元测试

### Text-Processor ✅
- 测试文件: `Test/src/Text-Processor/*.test.ts`
- 内容: fixMarkdown, text-clipper, cmd-parser 测试

---

## 待完成测试

### PermissionManager

**测试用例**:
- [ ] 权限节点匹配测试
- [ ] 权重计算测试
- [ ] 权限继承测试
- [ ] 循环继承检测测试
- [ ] 角色集过滤测试

**测试方法**:
```typescript
const testTable = {
    define: {
        admin: { segment: [{ node: "admin.*", weight: 10 }] },
        user: { segment: [{ node: "user.*", weight: 5 }] }
    },
    role: {
        superadmin: { inherit: ["admin"], segment: [{ node: "*", weight: 100 }] },
        normaluser: { inherit: ["user"] }
    },
    rule: []
};

const pm = _PermissionManager.create({ table: testTable });
const hasPermission = await pm.check({ roleset: "superadmin", node: "admin.delete" });
```

---

## 测试文件结构

```
Test/
  src/
    CharProfile-Domain/
      charprofile-domain.test.ts  ✅
    LaM-Manager/
      index.test.ts               ✅
      Formatter/**/*.test.ts      ✅
    Text-Processor/
      fixMarkdown.test.ts         ✅
      text-clipper.test.ts        ✅
      cmd-parser.test.ts          ✅
    Server/
      permission-manager.test.ts  (待创建)
```

## 注意事项

1. **不要在真实环境测试**：所有测试都应在Test项目中进行
2. **使用Mock对象**：对于依赖外部服务的模块，使用Mock对象替代
3. **测试边界情况**：不仅要测试正常流程，还要测试异常情况
