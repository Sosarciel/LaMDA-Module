# Server 主程序测试计划

## 测试目标

测试 `server` 主程序的胶水功能，通过**剥离可独立测试的模块**进行自动化测试，避免在真实生产环境中进行测试。

## 测试策略

由于server是半生产环境，链接真实数据库做小规模实际使用测试，不适合跑自动化测试。因此，本测试计划采用以下策略：

1. **模块剥离测试**：将可独立测试的模块剥离出来，在Test项目中创建对应的测试文件
2. **Mock依赖**：对于依赖外部服务的模块，使用Mock对象替代真实服务
3. **单元测试**：对纯函数和工具类进行单元测试
4. **集成测试**：对模块间的协作进行集成测试（使用Mock数据）

## 已完成测试

### 1. CharProfile（角色档案） ✅

**可测试性**：高 - 已拆分为独立模块

**测试文件**: `Test/src/CharProfile-Domain/charprofile-domain.test.ts`

**测试内容**：
- [x] 角色存在性检查
- [x] CharAccesser 实例创建
- [x] 角色配置加载
- [x] 角色基本信息获取
- [x] LaM实例名获取
- [x] 语音功能判断
- [x] TTS配置获取
- [x] 状态回复获取
- [x] 术语替换
- [x] 翻译后替换
- [x] logit bias获取
- [x] 场景获取
- [x] 定义场景获取
- [x] CharProfile初始化与角色助手获取
- [x] 角色重载
- [x] 常量定义验证

---

### 2. LaM-Manager 测试 ✅

**测试文件**: `Test/src/LaM-Manager/index.test.ts`

**测试内容**：
- [x] ChatTask - GPT35Chat 对话
- [x] ChatTask - GPT35Text 对话
- [x] ChatTask - DeepseekChat 对话
- [x] ChatTask - Gemini3Pro 对话
- [x] InstructTask - GPT35Text 文本生成
- [x] InstructTask - DeepseekText 代码补全
- [x] InstructTask - DeepseekPrefixCompletion 前缀续写

---

### 3. Regexp (fixMarkdown) 测试 ✅

**测试文件**: `Test/src/Regexp/fixMarkdown.test.ts`

**测试内容**：
- [x] 动作换行处理
- [x] 引号处理
- [x] 星号修复
- [x] 括号处理
- [x] think块移除
- [x] ASSISTANT前缀移除
- [x] Gemini末尾总结移除
- [x] 转义星号处理
- [x] 边界情况处理

---

## 待完成测试

### 4. PermissionManager（权限管理器）

**可测试性**：高 - 纯逻辑，无外部依赖

**测试内容**：
- [ ] 权限节点匹配（patternToRegex, testPattern）
- [ ] 权重计算（calcWeight）
- [ ] 权限继承（flatData）
- [ ] 循环继承检测
- [ ] 权重冲突解决
- [ ] 角色集过滤（filterRoleSet）

**测试方法**：
```typescript
// 创建测试用的权限配置
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

// 测试权限检查
const hasPermission = await pm.check({ roleset: "superadmin", node: "admin.delete" });
```

---

### 5. CmdParser（命令解析器）

**可测试性**：高 - 纯函数，无外部依赖

**测试内容**：
- [ ] 命令前缀识别
- [ ] 命令后缀识别
- [ ] 命令分割（splitCmd）
- [ ] 参数解析（parseOption）
- [ ] 主参数提取（getMainArg）
- [ ] 完整命令解析（parseCmd）

**测试方法**：
```typescript
// 测试命令解析
const cmdObj = CmdParser.parseCmd("cmd:test arg1 arg2;;");
expect(cmdObj.command).toBe("test");
expect(cmdObj.args).toEqual(["test", "arg1", "arg2"]);
```

---

## 测试文件结构

```
Test/
  src/
    CharProfile-Domain/
      charprofile-domain.test.ts  # 角色档案测试 ✅
    LaM-Manager/
      index.test.ts               # LaM管理器测试 ✅
    Regexp/
      fixMarkdown.test.ts         # 文本处理测试 ✅
    Server/
      permission-manager.test.ts  # 权限管理器测试 (待创建)
      cmd-parser.test.ts          # 命令解析器测试 (待创建)
```

## 测试优先级

1. **高优先级**：PermissionManager、CmdParser（纯逻辑，无外部依赖）
2. **中优先级**：其他可剥离模块

## 测试工具

- **Jest**：测试框架
- **Mock函数**：模拟外部依赖
- **TypeScript**：类型安全

## 预期结果

- 所有可剥离模块的自动化测试通过
- 测试覆盖率达到80%以上
- 发现并修复潜在的bug
- 为后续开发提供回归测试保障

## 注意事项

1. **不要在真实环境测试**：所有测试都应在Test项目中进行，避免影响生产环境
2. **使用Mock对象**：对于依赖外部服务的模块，使用Mock对象替代
3. **测试边界情况**：不仅要测试正常流程，还要测试异常情况
4. **保持测试独立性**：每个测试用例应该独立，不依赖其他测试用例
