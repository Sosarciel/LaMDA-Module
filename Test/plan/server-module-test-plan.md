# Server 模块测试计划

## 测试目标

基于 `server/plan/module-split-plan.md` 的模块拆分计划，制定详细的测试策略，确保拆分前后功能正确性。

## 测试策略

### 总体策略
1. **拆分前测试**：在拆分前编写测试，确保现有功能正确
2. **拆分中测试**：拆分过程中持续测试，确保功能不变
3. **拆分后测试**：拆分后验证模块独立性

### 测试优先级
1. **高优先级**：即将拆分的模块（PermissionManager、CmdParser）
2. **中优先级**：后续拆分的模块（TTSManager、TranslationManager）
3. **低优先级**：不拆分的模块

## 已完成测试

### 1. CharProfile-Domain 测试 ✅

**测试文件**: `Test/src/CharProfile-Domain/charprofile-domain.test.ts`

**测试内容**:
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

**测试内容**:
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

**测试内容**:
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

### 4. PermissionManager 测试

**测试文件**: `Test/src/Server/permission-manager.test.ts` (待创建)

**测试用例**:
- [ ] 权限节点匹配测试
- [ ] 权重计算测试
- [ ] 权限继承测试
- [ ] 循环继承检测测试
- [ ] 角色集过滤测试

---

### 5. CmdParser 测试

**测试文件**: `Test/src/Server/cmd-parser.test.ts` (待创建)

**测试用例**:
- [ ] 命令前缀识别测试
- [ ] 命令后缀识别测试
- [ ] 命令分割测试
- [ ] 参数解析测试
- [ ] 主参数提取测试
- [ ] 完整命令解析测试

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

## 测试工具

- **Jest**: 测试框架
- **Mock 函数**: 模拟外部依赖
- **TypeScript**: 类型安全

## 测试执行

```bash
# 运行所有测试
npm run test

# 运行特定模块测试
npx jest src/CharProfile-Domain/charprofile-domain.test.ts
npx jest src/LaM-Manager/index.test.ts
npx jest src/Regexp/fixMarkdown.test.ts
```

## 测试覆盖率目标

- CharProfile-Domain: ✅ 已完成
- LaM-Manager: ✅ 已完成
- Regexp: ✅ 已完成
- PermissionManager: 待测试
- CmdParser: 待测试

## 注意事项

1. **Mock 外部依赖**：所有测试应 Mock 外部依赖，确保测试独立性
2. **测试边界情况**：不仅要测试正常流程，还要测试异常情况
3. **保持测试简单**：每个测试用例应只测试一个功能点
4. **及时更新测试**：代码修改后应及时更新相关测试
