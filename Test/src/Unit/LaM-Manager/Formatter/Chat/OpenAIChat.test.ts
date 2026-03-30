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

            expect(result).toEqual({
                model: "gpt-3.5-turbo",
                messages: [
                    { role: "system", content: "系统描述" },
                    { role: "system", content: "user:" },
                    { role: "user", content: "你好" },
                    { role: "system", content: "assistant:" },
                    { role: "assistant", content: "你好！" },
                    { role: "system", content: "assistant:" },
                ],
                max_completion_tokens: 100,
                temperature: 1,
                top_p: 1,
                n: 1,
                presence_penalty: 0,
                frequency_penalty: 0,
                logit_bias: null,
            });
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

            expect(result).toEqual({
                model: "gpt-3.5-turbo",
                messages: [
                    { role: "system", content: "系统描述" },
                    { role: "system", content: "user:" },
                    { role: "user", content: "你好" },
                    { role: "system", content: "assistant:" },
                    { role: "assistant", content: "你好！ (继续)" },
                    { role: "system", content: "assistant:" },
                ],
                max_completion_tokens: 100,
                temperature: 1,
                top_p: 1,
                n: 1,
                presence_penalty: 0,
                frequency_penalty: 0,
                logit_bias: null,
                reasoning_effort: undefined,
                stop: undefined,
            });
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

            expect(result).toEqual({
                model: "gpt-3.5-turbo",
                messages: [
                    { role: "system", content: "系统描述" },
                    { role: "system", content: "user:" },
                    { role: "user", content: "你好" },
                    { role: "system", content: "assistant:" },
                    { role: "assistant", content: "你好！" },
                    { role: "system", content: "assistant:" },
                ],
                max_completion_tokens: 100,
                temperature: 1,
                top_p: 1,
                n: 1,
                presence_penalty: 0,
                frequency_penalty: 0,
                logit_bias: null,
                reasoning_effort: OpenAIThinkMap["hig"],
            });
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

            expect(result).toEqual({
                model: "gpt-5-chat",
                messages: [
                    { role: "system", content: "系统描述" },
                    { role: "system", content: "user:" },
                    { role: "user", content: "你好" },
                    { role: "system", content: "assistant:" },
                    { role: "assistant", content: "你好！" },
                    { role: "system", content: "assistant:" },
                ],
                max_completion_tokens: 100,
                temperature: 1,
                top_p: 1,
                n: 1,
                presence_penalty: 0,
                frequency_penalty: 0,
                logit_bias: null,
                reasoning_effort: "minimal",
            });
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

            expect(result).toEqual({
                model: "o1-preview",
                messages: [
                    { role: "system", content: "系统描述" },
                    { role: "system", content: "user:" },
                    { role: "user", content: "你好" },
                    { role: "system", content: "assistant:" },
                    { role: "assistant", content: "你好！" },
                    { role: "system", content: "assistant:" },
                ],
                frequency_penalty: undefined,
                presence_penalty: undefined,
                logit_bias: undefined,
                reasoning_effort: undefined,
                stop: undefined,
                max_completion_tokens: 100,
                temperature: 1,
                top_p: 1,
                n: 1,
            });
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

            expect(result).toEqual({
                model: "o1-preview",
                messages: [
                    { role: "system", content: "系统描述" },
                    { role: "system", content: "user:" },
                    { role: "user", content: "你好" },
                    { role: "system", content: "assistant:" },
                    { role: "assistant", content: "你好！" },
                    { role: "system", content: "assistant:" },
                ],
                max_completion_tokens: 100,
                temperature: 1,
                top_p: 1,
                n: 1,
                frequency_penalty: undefined,
                logit_bias: undefined,
                presence_penalty: undefined,
                reasoning_effort: undefined,
                stop: undefined,
            });
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
            console.log(result);

            expect(result).toEqual([
                { role: 'system', content: 'user:' },
                { role: 'user', content: '你好 (继续)' },
            ]);
        });
    });

    describe("3. formatResp 响应解析", () => {
        it("3.1 应正确解析OpenAI响应", () => {
            const mockResp = MockResponseFactory.createOpenAIChatResponse();
            const result = formatter.formatResp(mockResp);

            expect(result).toEqual({
                vaild: true,
                choices: [
                    { content: "您好，有什么需要帮助的吗？" },
                    { content: "您好，有什么需要帮助的吗？" },
                ],
            });
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
