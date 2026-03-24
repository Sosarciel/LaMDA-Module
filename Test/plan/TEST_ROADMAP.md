---
aliases: [LaMDA-Module 测试路线图]
---
# LaMDA-Module 测试路线图

## 概述

本文档记录 LaMDA-Module 测试计划的完成情况，归档已完成的计划，并追踪待完成的测试任务。

---

## 已完成的测试

### 1. LaM-Manager 测试 ✅

**完成日期**: 2026-03-21

**测试内容**:
- MockServer 简化重构
- Formatter 单元测试（按Task分类）
  - Chat: OpenAIChat, OpenAIText, DeepseekChat, DeepseekText, Gemini
  - Instruct: OpenAIText, DeepseekText, DeepseekPrefix
- 集成测试（index.test.ts）
- Mock工具函数提取（buildMockResponseText）

**关键改进**:
- 职责分离：MockServer只返回简单响应，Formatter测试单独验证
- 测试目录按Task分类：`Formatter/Chat/` 和 `Formatter/Instruct/`
- 强断言：使用 `buildMockResponseText` 确保响应可预测

**测试文件**:
- `Test/src/LaM-Manager/index.test.ts`
- `Test/src/LaM-Manager/Formatter/Chat/*.test.ts`
- `Test/src/LaM-Manager/Formatter/Instruct/*.test.ts`

---

### 2. Dialog-Domain 测试 ✅

**测试内容**:
- DialogStore 数据库访问操作
- ConversationLog 对话记录管理
- MessageLog 消息记录管理
- 缓存机制验证
- 事务操作

**测试文件**:
- `Test/src/Dialog-Domain/dialog-domain.test.ts`

---

### 3. PostgreSQL-Manager 测试 ✅

**测试内容**:
- DBManager 连接管理
- Client SQL执行
- CacheCoordinator 缓存协调
- Mock 模块测试

**测试文件**:
- `Test/src/PostgresSQL-Manager/mock-table.test.ts`
- `Test/src/PostgresSQL-Manager/index.test.ts`

---

### 4. Text-Processor 测试 ✅

**测试内容**:
- fixMarkdown 文本格式化
- text-clipper 文本截断
- cmd-parser 命令解析

**测试文件**:
- `Test/src/Text-Processor/fixMarkdown.test.ts`
- `Test/src/Text-Processor/text-clipper.test.ts`
- `Test/src/Text-Processor/cmd-parser.test.ts`

---

### 5. CharProfile-Domain 测试 ✅

**测试内容**:
- 角色存在性检查
- CharAccesser 实例创建
- 角色配置加载
- 各类信息获取

**测试文件**:
- `Test/src/CharProfile-Domain/charprofile-domain.test.ts`

---

## 待完成的测试

### 1. TTS-Translation-Manager 测试

**状态**: 计划已完成，待实施

**待办事项**:
- [ ] 实现 MockTTS
- [ ] 实现 MockTranslation
- [ ] TTSManager 单元测试
- [ ] TranslationManager 单元测试
- [ ] 百度翻译签名测试

**计划文件**: `Test/plan/tts-translation-manager-test-plan.md`

---

### 2. RulePipe 测试

**状态**: 计划已完成，待实施

**待办事项**:
- [ ] 单规则单元测试
- [ ] 规则组测试
- [ ] 调试测试
- [ ] 回归快照测试

**计划文件**: `Test/plan/rulepipe-test-plan.md`

---

### 3. PermissionManager 测试

**状态**: 未开始

**待办事项**:
- [ ] 权限节点匹配测试
- [ ] 权重计算测试
- [ ] 权限继承测试
- [ ] 循环继承检测测试

---

### 4. Server 模块测试

**状态**: 部分完成

**已完成**:
- CharProfile-Domain ✅
- LaM-Manager ✅
- Text-Processor ✅

**待完成**:
- PermissionManager
- 其他可剥离模块

---

## 测试统计

| 模块 | 状态 | 测试文件数 | 测试用例数 |
|------|------|-----------|-----------|
| LaM-Manager | ✅ 完成 | 9 | 209+ |
| Dialog-Domain | ✅ 完成 | 1 | 多个 |
| PostgreSQL-Manager | ✅ 完成 | 2 | 多个 |
| Text-Processor | ✅ 完成 | 3 | 多个 |
| CharProfile-Domain | ✅ 完成 | 1 | 多个 |
| TTS-Manager | ⏳ 计划中 | 0 | 0 |
| Translation-Manager | ⏳ 计划中 | 0 | 0 |
| RulePipe | ⏳ 计划中 | 0 | 0 |
| PermissionManager | ⏳ 未开始 | 0 | 0 |

---

## 测试规范

### 测试标记规范

测试文件应遵循以下命名和标记规范：

```typescript
describe("模块名 功能分类", () => {
    describe("1. 功能分类1", () => {
        it("1.1 应正确处理xxx", () => {
            // 测试代码
        });
    });
});
```

### Mock工具使用

使用 `@sosraciel-lamda/lam-manager/mock` 提供的工具：

```typescript
import { LaMManagerMockTool, MockResponseFactory, MockOptionFactory } from "@sosraciel-lamda/lam-manager/mock";

// 获取Mock响应文本
const responseText = LaMManagerMockTool.buildMockResponseText(modelId);

// 创建Mock响应
const mockResp = MockResponseFactory.createOpenAIChatResponse();

// 创建测试选项
const option = MockOptionFactory.createChatTaskOption();
```

---

## 更新日志

- **2026-03-21**: 创建路线图文档，归档已完成的LaM-Manager测试计划
