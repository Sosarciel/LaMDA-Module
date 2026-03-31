---
aliases: [LaM-Manager 真实API测试计划]
---
# LaM-Manager 真实API测试计划

## 问题分析

### 现有测试结构的局限性

当前 LaM-Manager 模块的测试分为两部分：

| 测试类型 | 文件位置 | 测试内容 | 局限性 |
|---------|---------|---------|--------|
| **Mock Server 测试** | `Unit/LaM-Manager/index.test.ts` | 验证请求发送和响应接收 | 响应是 `buildMockResponseText` 生成的固定内容，无法验证真实API响应格式 |
| **Formatter 测试** | `Unit/LaM-Manager/Formatter/**/*.test.ts` | 验证格式化逻辑 | 使用 `MockResponseFactory` 创建的假响应，无法验证真实API响应兼容性 |

### 核心问题

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   真实 API      │ ──► │   响应数据      │ ──► │   Formatter     │
│   (不确定输出)   │     │   (格式未知)    │     │   (期望特定格式) │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                      │                       │
         ▼                      ▼                       ▼
    需要验证:              需要验证:               需要验证:
    - 连接成功             - 结构完整性            - 能否正确解析
    - 认证有效             - 类型匹配              - 输出格式正确
```

**问题**: 没有可靠的方式验证真实API响应是否符合Formatter的预期格式。

---

## 测试策略

### 测试目标

1. **结构验证**: 验证真实API响应的结构是否符合类型定义
2. **Formatter兼容性**: 验证Formatter能否正确解析真实响应
3. **端到端验证**: 验证从请求到解析的完整流程

### 测试方法

#### 方法一: 结构验证测试

验证真实API响应的结构完整性，不验证具体内容：

```typescript
describe("OpenAI Chat API 结构验证", () => {
    it("响应应包含必要的字段", async () => {
        const response = await realApi.chat({ ... });
        
        // 验证结构，不验证内容
        expect(response).toMatchObject({
            id: expect.stringMatching(/^chatcmpl-/),
            object: "chat.completion",
            created: expect.any(Number),
            model: expect.any(String),
            choices: expect.arrayContaining([
                expect.objectContaining({
                    message: expect.objectContaining({
                        role: "assistant",
                        content: expect.any(String),
                    }),
                    finish_reason: expect.stringMatching(/^(stop|length|content_filter)$/),
                }),
            ]),
            usage: expect.objectContaining({
                prompt_tokens: expect.any(Number),
                completion_tokens: expect.any(Number),
                total_tokens: expect.any(Number),
            }),
        });
    });
});
```

#### 方法二: Formatter兼容性测试

将真实API响应传递给Formatter，验证解析结果：

```typescript
describe("Formatter 兼容性测试", () => {
    it("Formatter应能正确解析真实OpenAI响应", async () => {
        const realResponse = await realApi.chat({ ... });
        const parsed = OpenAIConversationChatTaskFormatter.formatResp(realResponse);
        
        // 验证解析结果
        expect(parsed.vaild).toBe(true);
        expect(parsed.choices.length).toBeGreaterThan(0);
        expect(parsed.choices[0].content).toBeDefined();
        expect(typeof parsed.choices[0].content).toBe("string");
    });
});
```

#### 方法三: 端到端验证测试

验证完整流程的输出格式：

```typescript
describe("端到端验证测试", () => {
    it("完整流程应返回有效结果", async () => {
        const result = await LaMManager.chat.execute("RealAPI_GPT35Chat", {
            target: "assistant",
            messages: [{ type: 'chat', senderName: 'user', content: '你好' }],
            max_tokens: 50,
        });
        
        // 验证最终输出格式
        expect(result.completed).toBeDefined();
        expect(result.completed?.vaild).toBe(true);
        expect(result.completed?.choices[0].content).toBeDefined();
        expect(typeof result.completed?.choices[0].content).toBe("string");
    });
});
```

---

## 测试用例设计

### 1. Chat 任务测试

#### 1.1 OpenAI Chat 格式验证

| 测试ID | 测试名称 | 验证内容 |
|--------|---------|---------|
| CHAT-001 | 响应结构验证 | 验证响应包含 id, object, choices, usage 等必要字段 |
| CHAT-002 | Formatter兼容性 | 验证 `formatResp` 能正确解析真实响应 |
| CHAT-003 | 端到端验证 | 验证 `LaMManager.chat.execute` 返回有效结果 |
| CHAT-004 | 多轮对话 | 验证多轮对话的消息格式正确 |

#### 1.2 Deepseek Chat 格式验证

| 测试ID | 测试名称 | 验证内容 |
|--------|---------|---------|
| CHAT-101 | 响应结构验证 | 验证Deepseek特有字段 (如 reasoning_content) |
| CHAT-102 | Formatter兼容性 | 验证 DeepseekChatTaskFormatter 兼容性 |
| CHAT-103 | 端到端验证 | 验证完整流程 |

#### 1.3 Gemini Chat 格式验证

| 测试ID | 测试名称 | 验证内容 |
|--------|---------|---------|
| CHAT-201 | 响应结构验证 | 验证Gemini特有字段 (candidates, parts) |
| CHAT-202 | Formatter兼容性 | 验证 GeminiChatTaskFormatter 兼容性 |
| CHAT-203 | 思考模式验证 | 验证 thought 字段的正确处理 |
| CHAT-204 | 端到端验证 | 验证完整流程 |

### 2. Instruct 任务测试

#### 2.1 OpenAI Text 格式验证

| 测试ID | 测试名称 | 验证内容 |
|--------|---------|---------|
| INST-001 | 响应结构验证 | 验证 text_completion 格式 |
| INST-002 | Formatter兼容性 | 验证 OpenAITextInstructTaskFormatter 兼容性 |
| INST-003 | 端到端验证 | 验证完整流程 |

#### 2.2 Deepseek Text/Prefix 格式验证

| 测试ID | 测试名称 | 验证内容 |
|--------|---------|---------|
| INST-101 | Text格式验证 | 验证 completions 格式 |
| INST-102 | Prefix格式验证 | 验证前缀续写格式 |
| INST-103 | Formatter兼容性 | 验证 DeepseekPrefixInstructTaskFormatter 兼容性 |

---

## 测试文件结构

```
Test/
  src/
    RealApi/
      LaM-Manager/
        chat/
          openai-chat.realapi.test.ts      # OpenAI Chat 真实API测试
          deepseek-chat.realapi.test.ts    # Deepseek Chat 真实API测试
          gemini-chat.realapi.test.ts      # Gemini Chat 真实API测试
        instruct/
          openai-text.realapi.test.ts      # OpenAI Text 真实API测试
          deepseek-text.realapi.test.ts    # Deepseek Text 真实API测试
          deepseek-prefix.realapi.test.ts  # Deepseek Prefix 真实API测试
        common/
          test-utils.ts                    # 测试工具函数
          validators.ts                    # 结构验证器
```

---

## 环境变量配置

测试需要以下环境变量：

```bash
# OpenAI API
OPENAI_API_KEY="sk-..."
OPENAI_BASE_URL="https://api.openai.com/v1"  # 可选

# Deepseek API
DEEPSEEK_API_KEY="sk-..."
DEEPSEEK_BASE_URL="https://api.deepseek.com/v1"  # 可选

# Gemini API
GEMINI_API_KEY="..."
GEMINI_BASE_URL="https://generativelanguage.googleapis.com/v1beta"  # 可选
```

---

## 验证器设计

### 通用响应验证器

```typescript
// common/validators.ts

/** 验证 OpenAI Chat 响应结构 */
export const validateOpenAIChatResponse = (response: unknown) => {
    expect(response).toMatchObject({
        id: expect.stringMatching(/^chatcmpl-/),
        object: "chat.completion",
        created: expect.any(Number),
        model: expect.any(String),
        choices: expect.arrayContaining([
            expect.objectContaining({
                message: expect.objectContaining({
                    role: "assistant",
                }),
                finish_reason: expect.any(String),
                index: expect.any(Number),
            }),
        ]),
        usage: expect.objectContaining({
            prompt_tokens: expect.any(Number),
            completion_tokens: expect.any(Number),
            total_tokens: expect.any(Number),
        }),
    });
};

/** 验证 Gemini 响应结构 */
export const validateGeminiResponse = (response: unknown) => {
    expect(response).toMatchObject({
        candidates: expect.arrayContaining([
            expect.objectContaining({
                content: expect.objectContaining({
                    parts: expect.arrayContaining([
                        expect.objectContaining({
                            text: expect.any(String),
                        }),
                    ]),
                    role: "model",
                }),
                finishReason: expect.any(String),
            }),
        ]),
    });
};

/** 验证 Formatter 解析结果 */
export const validateFormatterResult = (result: unknown) => {
    expect(result).toMatchObject({
        vaild: expect.any(Boolean),
        choices: expect.arrayContaining([
            expect.objectContaining({
                content: expect.any(String),
            }),
        ]),
    });
};
```

---

## 测试模板

### Chat 任务测试模板

```typescript
/** OpenAI Chat 真实API测试
 * 运行前需设置环境变量: OPENAI_API_KEY
 */

import { LaMManager, CredManager } from "@sosraciel-lamda/lam-manager";
import { OpenAIConversationChatTaskFormatter } from "@sosraciel-lamda/lam-manager";
import { UtilFT } from "@zwa73/utils";
import path from "pathe";
import { CACHE_PATH } from "@/src/Constant";
import { validateOpenAIChatResponse, validateFormatterResult } from "../common/validators";

const API_KEY = process.env.OPENAI_API_KEY || "";
const checkApiKey = () => {
    if (!API_KEY) {
        console.warn("警告: 未设置 OPENAI_API_KEY 环境变量，测试将被跳过");
        return false;
    }
    return true;
};

describe("OpenAI Chat 真实API测试", () => {
    beforeAll(async () => {
        if (!checkApiKey()) return;
        
        // 初始化服务配置...
    });

    describe("1. 响应结构验证", () => {
        it("1.1 响应应包含必要字段", async () => {
            if (!checkApiKey()) return;
            
            const response = await LaMManager.chat.execute("RealAPI_GPT35Chat", {
                target: "assistant",
                messages: [{ type: 'chat', senderName: 'user', content: '你好' }],
                max_tokens: 50,
            });
            
            // 验证结构
            expect(response.completed).toBeDefined();
        });
    });

    describe("2. Formatter兼容性验证", () => {
        it("2.1 Formatter应能正确解析响应", async () => {
            if (!checkApiKey()) return;
            
            // 获取原始响应并验证Formatter解析
            // ...
        });
    });

    describe("3. 端到端验证", () => {
        it("3.1 完整流程应返回有效结果", async () => {
            if (!checkApiKey()) return;
            
            const result = await LaMManager.chat.execute("RealAPI_GPT35Chat", {
                target: "assistant",
                messages: [{ type: 'chat', senderName: 'user', content: '你好' }],
                max_tokens: 50,
            });
            
            expect(result.completed?.vaild).toBe(true);
            expect(result.completed?.choices[0].content).toBeDefined();
        });
    });
});
```

---

## 执行计划

### 阶段一: 基础设施 (预计 1 天)

- [ ] 创建 `RealApi/LaM-Manager` 目录结构
- [ ] 编写通用验证器 `validators.ts`
- [ ] 编写测试工具函数 `test-utils.ts`

### 阶段二: Chat 任务测试 (预计 2 天)

- [ ] OpenAI Chat 真实API测试
- [ ] Deepseek Chat 真实API测试
- [ ] Gemini Chat 真实API测试

### 阶段三: Instruct 任务测试 (预计 1 天)

- [ ] OpenAI Text 真实API测试
- [ ] Deepseek Text/Prefix 真实API测试

### 阶段四: 集成与文档 (预计 0.5 天)

- [ ] 集成测试验证
- [ ] 更新测试文档

---

## 注意事项

1. **API 费用控制**: 真实API测试会产生费用，建议使用 `max_tokens` 限制输出
2. **测试隔离**: 每个测试应独立运行，不依赖其他测试的状态
3. **环境变量**: 未设置环境变量时测试应自动跳过
4. **超时设置**: 真实API可能较慢，需要设置合理的超时时间
5. **并发控制**: 避免同时发起大量请求导致限流
