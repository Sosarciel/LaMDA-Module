# LaM-Manager 测试改进实施计划

## 核心问题分析

当前测试架构存在以下问题：

1. **职责不清**：所有压力都在MockServer上，导致输入/输出结果难以预测
2. **路径复杂**：`/chat/xxx` 和 `/instruct/xxx` 的区分增加了MockServer复杂度
3. **格式耦合**：MockServer需要处理不同Formatter产生的不同请求格式

## 改进方案

### 核心思路

**职责分离**：
- MockServer：只负责接收请求并返回简单响应，不关心具体格式
- Formatter测试：单独验证每个Formatter的请求格式化和响应解析

### 改进后的架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Formatter单元测试                          │
│  • 验证请求格式化 (formatOption)                               │
│  • 验证响应解析 (formatResp)                                   │
│  • 验证消息转换 (buildMessage)                                 │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    简化的MockServer                           │
│  • 接受所有POST请求                                           │
│  • 从请求中提取modelId                                        │
│  • 返回简单响应: "对 {modelId} 反馈"                           │
│  • 不区分chat/instruct路径                                    │
└─────────────────────────────────────────────────────────────┘
```

## 实施步骤

### 阶段1：简化MockServer

**目标**：创建一个通用的MockServer，不区分任务类型

**改动**：
1. 移除 `/chat/` 和 `/instruct/` 路径前缀区分
2. 统一处理所有POST请求
3. 从请求body中提取model字段作为modelId
4. 返回简单响应格式

**新的MockServer代码**：
```typescript
export class LaMManagerMockServer {
    server: Server | undefined;

    constructor(private port: number) {}

    async start() {
        const server = createServer((req, res) => {
            res.setHeader("Content-Type", "application/json");
            if (req.method === "GET") return res.end();

            let body = "";
            req.on("data", chunk => (body += chunk));
            req.on("end", async () => {
                const data = JSON.parse(body || "{}");
                const modelId = this.extractModelId(req.url || '', data);

                const response = this.buildResponse(modelId);
                res.writeHead(200);
                res.end(JSON.stringify(response));
            });
        });

        return new Promise((resolve) => server.listen(this.port, () => {
            console.log(`MockServer running on http://localhost:${this.port}`);
            this.server = server;
            resolve(server);
        }));
    }

    /**从请求中提取modelId */
    private extractModelId(path: string, data: any): string {
        // 从请求body中提取model字段
        if (data.model) return data.model;
        // 从Gemini路径中提取
        const geminiMatch = path.match(/models\/([^/:]+)/);
        if (geminiMatch) return geminiMatch[1];
        return "unknown";
    }

    /**构建简单响应 */
    private buildResponse(modelId: string): any {
        // OpenAI格式响应
        if (modelId.includes('gpt') || modelId.includes('deepseek')) {
            return {
                id: `chatcmpl-${Date.now()}`,
                object: "chat.completion",
                created: Math.floor(Date.now() / 1000),
                model: modelId,
                choices: [{
                    index: 0,
                    message: { role: "assistant", content: `对 ${modelId} 反馈` },
                    finish_reason: "stop"
                }],
                usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
            };
        }
        // Gemini格式响应
        return {
            candidates: [{
                content: {
                    parts: [{ text: `对 ${modelId} 反馈` }],
                    role: "model"
                },
                finishReason: "STOP"
            }],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 }
        };
    }

    async stop() {
        if (this.server == undefined) return;
        return new Promise((resolve) => this.server?.close(() => {
            console.log(`MockServer stopped`);
            resolve(this.server);
        }));
    }
}
```

### 阶段2：更新服务配置

**目标**：移除配置中的路径前缀

**改动**：
```typescript
// 改动前
endpoint: "/chat/v1/chat/completions"

// 改动后
endpoint: "/v1/chat/completions"
```

**新的MOCK_LAM_SERVICE_TABLE**：
```typescript
export const MOCK_LAM_SERVICE_TABLE = {
    instance_table: {
        Chat_GPT35Chat: {
            name: "Chat_GPT35Chat",
            type: "HttpAPIModel",
            data: {
                config: {
                    endpoint: "/v1/chat/completions",  // 移除 /chat 前缀
                    chat_formater: "openai_chat",
                    tokensizer: "cl100k_base",
                    interactor: "openai",
                    id: "gpt-3.5-turbo",
                    alias: "Chat_GPT35Chat",
                },
                default_option: { max_hist: 6000 },
            },
        },
        // ... 其他模型配置同样移除路径前缀
    },
};
```

### 阶段3：创建Formatter单元测试

**目标**：为每个Formatter创建独立的单元测试

**测试文件结构**：
```
Test/src/LaM-Manager/
├── Formatter/
│   ├── OpenAIChat.test.ts
│   ├── OpenAIText.test.ts
│   ├── DeepseekChat.test.ts
│   ├── DeepseekText.test.ts
│   ├── DeepseekPrefix.test.ts
│   └── Gemini.test.ts
└── index.test.ts  # 集成测试
```

**OpenAIChat测试示例**：
```typescript
import { OpenAIConversationChatTaskFormatter } from "@sosraciel-lamda/lam-manager";

describe("OpenAIChat Formatter", () => {
    describe("buildMessage", () => {
        it("应正确转换聊天消息", () => {
            const messages: LaMChatMessages = [
                { type: 'chat', senderName: 'user', content: '你好' },
                { type: 'chat', senderName: 'assistant', content: '你好！' },
            ];
            const result = OpenAIConversationChatTaskFormatter.buildMessage({
                target: 'assistant',
                messages,
            });

            expect(result).toEqual([
                { role: 'system', content: 'user:' },
                { role: 'user', content: '你好' },
                { role: 'system', content: 'assistant:' },
                { role: 'assistant', content: '你好！' },
            ]);
        });
    });

    describe("formatResp", () => {
        it("应正确解析OpenAI响应", () => {
            const mockResp = {
                choices: [{
                    index: 0,
                    message: { role: 'assistant', content: '测试响应' },
                    finish_reason: 'stop',
                }],
            };

            const result = OpenAIConversationChatTaskFormatter.formatResp(mockResp);

            expect(result.vaild).toBe(true);
            expect(result.choices).toEqual([{ content: '测试响应' }]);
        });
    });
});
```

### 阶段4：更新集成测试

**目标**：简化集成测试，只验证流程正确性

**改动**：
```typescript
describe("LaM-Manager", () => {
    describe("ChatTask", () => {
        const chatFn = async (instanceName: string, message: string) => {
            return LaMManager.chat.execute(instanceName, {
                target: LaMManagerMockTool.MOCK_CHAR,
                messages: [{
                    content: message,
                    type: 'chat',
                    senderName: LaMManagerMockTool.MOCK_USER,
                }],
                log_level: "debug",
                n: 1,
                max_tokens: 100,
            });
        };

        it("GPT35Chat应成功完成对话", async () => {
            const result = await chatFn("Chat_GPT35Chat", "你好");
            expect(result.completed?.choices?.[0].content).toContain("gpt-3.5-turbo");
        });

        it("DeepseekChat应成功完成对话", async () => {
            const result = await chatFn("Chat_DeepseekChat", "你好");
            expect(result.completed?.choices?.[0].content).toContain("deepseek-chat");
        });

        it("Gemini3Pro应成功完成对话", async () => {
            const result = await chatFn("Chat_Gemini3Pro", "你好");
            expect(result.completed?.choices?.[0].content).toContain("gemini");
        });
    });

    describe("InstructTask", () => {
        const instructFn = async (instanceName: string, prompt: string) => {
            return LaMManager.instruct.execute(instanceName, {
                prompt: prompt,
                max_tokens: 100,
                log_level: "debug",
            });
        };

        it("GPT35Text应成功完成指令", async () => {
            const result = await instructFn("Instruct_GPT35Text", "续写");
            expect(result.completed?.choices?.[0].content).toBeDefined();
        });

        it("DeepseekText应成功完成指令", async () => {
            const result = await instructFn("Instruct_DeepseekText", "续写");
            expect(result.completed?.choices?.[0].content).toBeDefined();
        });
    });
});
```

## 文件改动清单

### 需要修改的文件

| 文件 | 改动内容 |
|------|---------|
| `LaM-Manager/src/Mock/Server/MockServer.ts` | 简化为通用MockServer |
| `LaM-Manager/src/Mock/Utils.ts` | 更新MOCK_LAM_SERVICE_TABLE |
| `Test/src/LaM-Manager/index.test.ts` | 简化测试断言 |

### 需要创建的文件

| 文件 | 内容 |
|------|------|
| `Test/src/LaM-Manager/Formatter/OpenAIChat.test.ts` | OpenAIChat Formatter单元测试 |
| `Test/src/LaM-Manager/Formatter/OpenAIText.test.ts` | OpenAIText Formatter单元测试 |
| `Test/src/LaM-Manager/Formatter/DeepseekChat.test.ts` | DeepseekChat Formatter单元测试 |
| `Test/src/LaM-Manager/Formatter/DeepseekText.test.ts` | DeepseekText Formatter单元测试 |
| `Test/src/LaM-Manager/Formatter/DeepseekPrefix.test.ts` | DeepseekPrefix Formatter单元测试 |
| `Test/src/LaM-Manager/Formatter/Gemini.test.ts` | Gemini Formatter单元测试 |

## 验收标准

- [ ] MockServer简化完成，不再区分chat/instruct路径
- [ ] MOCK_LAM_SERVICE_TABLE更新完成，移除路径前缀
- [ ] 所有Formatter单元测试创建完成
- [ ] 集成测试更新完成
- [ ] 所有测试通过
- [ ] TypeScript类型检查通过
