import { OpenAIConversationChatTaskFormatter, OpenAIThinkMap } from "@sosraciel-lamda/lam-manager";
import { MockResponseFactory, MockOptionFactory } from "@sosraciel-lamda/lam-manager/mock";
import type { OpenAIChatRequest } from "@sosraciel-lamda/lam-manager";

describe("LaM-Manager ChatTask OpenAIChat Formatter", () => {
    const formatter = OpenAIConversationChatTaskFormatter;

    describe("1. formatOption 选项格式化", () => {
        it("1.1 应正确格式化基本聊天选项", async () => {
            const option = MockOptionFactory.createChatTaskOption();
            const result = await formatter.formatOption({
                option,
                modelId: "gpt-3.5-turbo",
                tokensizerType: "cl100k_base",
            }) as OpenAIChatRequest;

            expect(result).toBeDefined();
            expect(result.model).toBe("gpt-3.5-turbo");
            expect(result.messages).toBeDefined();
            expect(result.messages?.length).toBeGreaterThan(0);
            expect(result.max_completion_tokens).toBe(100);
            expect(result.temperature).toBe(1);
        });

        it("1.2 应正确处理hint提示", async () => {
            const option = MockOptionFactory.createChatTaskOption({
                hint: " (继续)",
            });
            const result = await formatter.formatOption({
                option,
                modelId: "gpt-3.5-turbo",
                tokensizerType: "cl100k_base",
            }) as OpenAIChatRequest;

            expect(result).toBeDefined();
            expect(result.messages).toBeDefined();
            const hasHint = result.messages!.some(m => 
                typeof m.content === 'string' && m.content.includes("(继续)")
            );
            expect(hasHint).toBe(true);
        });

        it("1.3 应正确处理think_budget参数", async () => {
            const option = MockOptionFactory.createChatTaskOption({
                think_budget: "hig",
            });
            const result = await formatter.formatOption({
                option,
                modelId: "gpt-3.5-turbo",
                tokensizerType: "cl100k_base",
            }) as OpenAIChatRequest;

            expect(result).toBeDefined();
            expect(result.reasoning_effort).toBe(OpenAIThinkMap["hig"]);
        });

        it("1.4 应正确处理GPT-5及以上版本的think_budget", async () => {
            const option = MockOptionFactory.createChatTaskOption({
                think_budget: "non",
            });
            const result = await formatter.formatOption({
                option,
                modelId: "gpt-5-chat",
                tokensizerType: "cl100k_base",
            }) as OpenAIChatRequest;

            expect(result).toBeDefined();
            expect(result.reasoning_effort).toBe("minimal");
        });

        it("1.5 应对o系列模型禁用stop参数", async () => {
            const option = MockOptionFactory.createChatTaskOption({
                stop: ["\n"],
            });
            const result = await formatter.formatOption({
                option,
                modelId: "o1-preview",
                tokensizerType: "cl100k_base",
            }) as OpenAIChatRequest;

            expect(result).toBeDefined();
            expect(result.stop).toBeUndefined();
        });

        it("1.6 应对o系列模型禁用presence_penalty和frequency_penalty", async () => {
            const option = MockOptionFactory.createChatTaskOption({
                presence_penalty: 0.5,
                frequency_penalty: 0.3,
            });
            const result = await formatter.formatOption({
                option,
                modelId: "o1-preview",
                tokensizerType: "cl100k_base",
            }) as OpenAIChatRequest;

            expect(result).toBeDefined();
            expect(result.presence_penalty).toBeUndefined();
            expect(result.frequency_penalty).toBeUndefined();
        });

        it("1.7 应对空messages返回undefined", async () => {
            const option = MockOptionFactory.createChatTaskOption({
                messages: [],
            });
            const result = await formatter.formatOption({
                option,
                modelId: "gpt-3.5-turbo",
                tokensizerType: "cl100k_base",
            });

            expect(result).toBeUndefined();
        });

        it("1.8 应对null messages返回undefined", async () => {
            const baseOption = MockOptionFactory.createChatTaskOption();
            const option = {
                ...baseOption,
                messages: null as unknown as typeof baseOption.messages,
            };
            const result = await formatter.formatOption({
                option,
                modelId: "gpt-3.5-turbo",
                tokensizerType: "cl100k_base",
            });

            expect(result).toBeUndefined();
        });
    });

    describe("2. buildMessage 消息构建", () => {
        it("2.1 应正确转换聊天消息", () => {
            const messages = [
                { type: 'desc' as const, content: '系统描述' },
                { type: 'chat' as const, senderName: 'user', content: '你好' },
                { type: 'chat' as const, senderName: 'assistant', content: '你好！' },
            ];
            const result = formatter.buildMessage({
                target: 'assistant',
                messages,
            });

            expect(result).toEqual([
                { role: 'system', content: '系统描述' },
                { role: 'system', content: 'user:' },
                { role: 'user', content: '你好' },
                { role: 'system', content: 'assistant:' },
                { role: 'assistant', content: '你好！' },
            ]);
        });

        it("2.2 应正确处理hint提示", () => {
            const messages = [
                { type: 'chat' as const, senderName: 'user', content: '你好' },
            ];
            const result = formatter.buildMessage({
                target: 'assistant',
                messages,
                hint: ' (继续)',
            });

            expect(result[result.length - 1].content).toContain('(继续)');
        });
    });

    describe("3. formatResp 响应解析", () => {
        it("3.1 应正确解析OpenAI响应", () => {
            const mockResp = MockResponseFactory.createOpenAIChatResponse();
            const result = formatter.formatResp(mockResp);

            expect(result.vaild).toBe(true);
            expect(result.choices.length).toBeGreaterThan(0);
        });

        it("3.2 应正确处理空响应", () => {
            const mockResp = MockResponseFactory.createOpenAIChatResponse({ choices: [] });
            const result = formatter.formatResp(mockResp);

            expect(result).toEqual({
                vaild: false,
                choices: [],
            });
        });

        it("3.3 应正确处理多选项响应", () => {
            const mockResp = MockResponseFactory.createOpenAIChatResponse({
                choices: [
                    { index: 0, message: { role: "assistant", content: "选项1" }, finish_reason: "stop" },
                    { index: 1, message: { role: "assistant", content: "选项2" }, finish_reason: "stop" },
                ],
            });
            const result = formatter.formatResp(mockResp);

            expect(result).toEqual({
                vaild: true,
                choices: [{ content: "选项1" }, { content: "选项2" }],
            });
        });
    });
});
