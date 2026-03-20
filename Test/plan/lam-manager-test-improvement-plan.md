# LaM-Manager 测试流程改进计划

## 背景与问题

### 当前架构痛点

1. **Mock服务器过于硬编码**
   - 每个模型需要单独的处理器文件（GPT35Chat.ts, DeepseekChat.ts等）
   - 处理器逻辑高度相似，仅响应格式略有不同
   - 添加新模型需要创建多个文件

2. **分发逻辑硬编码**
   - `OpenAIRequester/index.ts` 中通过model字段匹配分发
   - 违反开闭原则，扩展性差
   - 添加新模型需要修改分发逻辑

3. **测试与Mock强耦合**
   - 测试用例直接依赖 `buildResp` 函数
   - 测试逻辑与Mock实现绑定
   - Mock响应变更会导致测试失败

4. **无法模拟复杂场景**
   - 只支持成功响应
   - 无法测试错误响应（4xx, 5xx）
   - 无法测试网络超时、响应延迟
   - 无法测试流式响应中断

## 改进目标

1. **降低扩展成本** - 添加新模型从修改5+个文件降至修改1个配置
2. **提高测试隔离性** - 每个测试可独立定义响应规则
3. **支持复杂场景** - 错误、延迟、超时等场景
4. **减少代码冗余** - 消除重复的处理器代码

## 推荐方案：配置驱动 + 场景覆盖

### 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                    MockConfig (配置层)                       │
│  - 定义所有模型的默认响应规则                                  │
│  - 支持响应模板和变量替换                                      │
│  - 定义响应格式映射 (openai_chat/gemini/deepseek)             │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 MockRegistry (注册层)                        │
│  - 测试前注册特定场景的响应覆盖                                │
│  - 支持错误响应、延迟、条件匹配                                │
│  - 每个测试独立隔离                                           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              MockResponseGenerator (生成层)                  │
│  - 优先查找Registry中的覆盖规则                               │
│  - 回退到Config中的默认规则                                   │
│  - 统一生成响应                                               │
└─────────────────────────────────────────────────────────────┘
```

### 核心类型定义

```typescript
// MockConfig.ts
/**Mock响应配置 */
export type MockModelConfig = {
    /**模型标识 */
    id: string;
    /**交互器类型 */
    interactor: 'openai' | 'gemini';
    /**响应格式模板 */
    responseFormat: 'openai_chat' | 'openai_text' | 'gemini' | 'deepseek_chat';
    /**响应生成规则 */
    responseRule: MockResponseRule;
};

/**响应生成规则 */
export type MockResponseRule = {
    /**响应类型 */
    type: 'success' | 'error' | 'timeout';
    /**延迟毫秒 */
    delay?: number;
    /**错误码 (type=error时) */
    errorCode?: number;
    /**错误消息 */
    errorMessage?: string;
    /**自定义响应生成器 */
    customGenerator?: (request: MockRequest) => MockResponse;
};

/**场景覆盖规则 */
export type MockScenarioOverride = {
    /**匹配条件 */
    match: {
        model?: string;
        instanceName?: string;
        requestPattern?: RegExp;
    };
    /**覆盖的响应规则 */
    responseRule: MockResponseRule;
};

/**Mock请求信息 */
export type MockRequest = {
    model: string;
    instanceName: string;
    lastMessage: string;
    fullRequest: unknown;
};
```

## 实现步骤

### 阶段1：创建新架构（不破坏现有代码）

- [ ] 创建 `src/Mock/Config/MockConfig.ts` - 定义配置类型
- [ ] 创建 `src/Mock/Config/MockRegistry.ts` - 实现注册器
- [ ] 创建 `src/Mock/Config/MockResponseGenerator.ts` - 实现响应生成器
- [ ] 创建 `src/Mock/Config/index.ts` - 导出接口
- [ ] 创建 `src/Mock/Config/DefaultConfig.ts` - 默认模型配置

### 阶段2：重构Mock服务器

- [ ] 修改 `MockServer.ts` 集成新的响应生成器
- [ ] 重构 `OpenAIRequester/index.ts` 使用配置驱动
- [ ] 重构 `GeminiRequester/index.ts` 使用配置驱动
- [ ] 保持向后兼容，支持旧的处理器方式

### 阶段3：迁移现有配置

- [ ] 将 `MOCK_LAM_SERVICE_TABLE` 中的模型配置迁移到新格式
- [ ] 创建默认响应生成器
- [ ] 删除冗余的处理器文件（可选，保持向后兼容）

### 阶段4：改进测试用例

- [ ] 更新测试用例，移除对 `buildResp` 的直接依赖
- [ ] 添加错误场景测试用例
- [ ] 添加延迟场景测试用例
- [ ] 添加超时场景测试用例
- [ ] 验证所有测试通过

## 文件结构变更

### 新增文件

```
LaM-Manager/
  src/
    Mock/
      Config/
        MockConfig.ts           # 配置类型定义
        MockRegistry.ts         # 注册器实现
        MockResponseGenerator.ts # 响应生成器
        DefaultConfig.ts        # 默认模型配置
        index.ts                # 导出接口
```

### 修改文件

```
LaM-Manager/
  src/
    Mock/
      Server/
        MockServer.ts           # 集成响应生成器
        OpenAIRequester/
          index.ts              # 使用配置驱动
        GeminiRequester/
          index.ts              # 使用配置驱动
      Utils.ts                  # 保留兼容函数
      index.ts                  # 导出新接口
```

### 测试文件

```
Test/
  src/
    LaM-Manager/
      index.test.ts             # 基础功能测试
      error-scenario.test.ts    # 错误场景测试（新增）
      delay-scenario.test.ts    # 延迟场景测试（新增）
```

## 测试用例设计

### 基础功能测试（使用默认配置）

```typescript
describe("LaM-Manager ChatTask", () => {
    it("尝试与 GPT35Chat 对话", async () => {
        const result = await chatFn("Chat_GPT35Chat", "你好");
        // 验证响应结构，不依赖具体实现
        expect(result.completed?.choices?.[0]).toMatchObject({
            role: "assistant",
            finish_reason: "stop"
        });
        expect(result.completed?.choices?.[0].content).toContain("GPT35Chat");
        expect(result.completed?.choices?.[0].content).toContain("你好");
    });
});
```

### 错误场景测试（使用注册覆盖）

```typescript
describe("LaM-Manager Error Handling", () => {
    let registry: MockRegistry;

    beforeEach(() => {
        registry = MockRegistry.getInstance();
        registry.clear();
    });

    afterEach(() => {
        registry.clear();
    });

    it("处理API错误响应", async () => {
        registry.register({
            match: { model: 'gpt-3.5-turbo' },
            responseRule: {
                type: 'error',
                errorCode: 429,
                errorMessage: 'Rate limit exceeded'
            }
        });

        await expect(chatFn("Chat_GPT35Chat", "你好"))
            .rejects.toThrow('Rate limit exceeded');
    });

    it("处理响应延迟", async () => {
        registry.register({
            match: { model: 'gpt-3.5-turbo' },
            responseRule: {
                type: 'success',
                delay: 100
            }
        });

        const start = Date.now();
        await chatFn("Chat_GPT35Chat", "你好");
        const elapsed = Date.now() - start;

        expect(elapsed).toBeGreaterThanOrEqual(100);
    });

    it("处理超时", async () => {
        registry.register({
            match: { model: 'gpt-3.5-turbo' },
            responseRule: {
                type: 'timeout'
            }
        });

        await expect(chatFn("Chat_GPT35Chat", "你好"))
            .rejects.toThrow('timeout');
    });
});
```

### Instruct任务测试

```typescript
describe("LaM-Manager InstructTask", () => {
    it("处理文本补全", async () => {
        const result = await instructFn("Instruct_GPT35Text", "def factorial(n):");
        expect(result.completed?.choices?.[0]).toBeDefined();
        expect(result.completed?.choices?.[0].content).toContain("GPT35Text");
    });

    it("处理前缀补全", async () => {
        registry.register({
            match: { model: 'deepseek-chat' },
            responseRule: {
                type: 'success',
                customGenerator: (req) => ({
                    content: `补全: ${req.lastMessage}`,
                    finish_reason: 'stop'
                })
            }
        });

        const result = await instructFn("Instruct_DeepseekPrefix", "请续写");
        expect(result.completed?.choices?.[0].content).toContain("补全");
    });
});
```

## 向后兼容性

### 保持现有API

- `LaMManagerMockTool.buildResp()` 函数保留
- `LaMManagerMockTool.MOCK_LAM_SERVICE_TABLE` 保留
- 现有测试用例无需修改即可运行

### 渐进迁移

- 新测试使用注册覆盖模式
- 旧测试可继续使用 `buildResp`
- 逐步迁移到新架构

## 预期收益

| 指标 | 改进前 | 改进后 |
|------|--------|--------|
| 添加新模型 | 修改5+个文件 | 修改1个配置 |
| 测试场景 | 仅支持成功 | 支持错误/延迟/超时 |
| Mock代码量 | ~300行 | ~120行（减少60%） |
| 测试隔离性 | 全局共享 | 每个测试独立 |
| 扩展性 | 硬编码分发 | 配置驱动 |

## 风险与缓解

### 风险1：破坏现有测试

**缓解措施**：
- 保持向后兼容API
- 渐进式迁移
- 充分的回归测试

### 风险2：学习成本

**缓解措施**：
- 提供详细文档和示例
- 保持API简洁直观
- 代码审查确保正确使用

### 风险3：性能影响

**缓解措施**：
- 配置查找使用Map缓存
- 注册器使用高效匹配算法
- 性能基准测试

## 时间规划

| 阶段 | 预计时间 | 内容 |
|------|----------|------|
| 阶段1 | 1天 | 创建新架构 |
| 阶段2 | 0.5天 | 重构Mock服务器 |
| 阶段3 | 0.5天 | 迁移现有配置 |
| 阶段4 | 1天 | 改进测试用例 |
| **总计** | **3天** | |

## 验收标准

- [ ] 所有现有测试通过
- [ ] 新增错误场景测试通过
- [ ] 新增延迟场景测试通过
- [ ] 新增超时场景测试通过
- [ ] 添加新模型只需修改配置
- [ ] 代码覆盖率不降低
- [ ] TypeScript类型检查通过
- [ ] ESLint检查通过
