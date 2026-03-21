import { OpenAITextChatTaskFormatter } from "@sosraciel-lamda/lam-manager";
import { MockResponseFactory, MockOptionFactory } from "@sosraciel-lamda/lam-manager/mock";
import type { OpenAITextRequest } from "@sosraciel-lamda/lam-manager";

describe("LaM-Manager ChatTask OpenAIText Formatter", () => {
    const formatter = OpenAITextChatTaskFormatter;

    describe("1. formatOption 选项格式化", () => {
        it("1.1 应正确格式化基本聊天选项", async () => {
            const option = MockOptionFactory.createChatTaskOption();
            const result = await formatter.formatOption({
                option,
                modelId: "gpt-3.5-turbo-instruct",
                tokensizerType: "cl100k_base",
            }) as OpenAITextRequest;

            expect(result).toEqual({
                model: "gpt-3.5-turbo-instruct",
                prompt: "系统描述\nuser:你好\nassistant:你好！\nassistant:",
                max_tokens: 100,
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
                modelId: "gpt-3.5-turbo-instruct",
                tokensizerType: "cl100k_base",
            }) as OpenAITextRequest;

            expect(result).toEqual({
                model: "gpt-3.5-turbo-instruct",
                prompt: "系统描述\nuser:你好\nassistant:你好！ (继续)\nassistant:",
                max_tokens: 100,
                temperature: 1,
                top_p: 1,
                n: 1,
                presence_penalty: 0,
                frequency_penalty: 0,
                logit_bias: null,
            });
        });

        it("1.3 应正确处理stop参数", async () => {
            const option = MockOptionFactory.createChatTaskOption({
                stop: ["\n", "END"],
            });
            const result = await formatter.formatOption({
                option,
                modelId: "gpt-3.5-turbo-instruct",
                tokensizerType: "cl100k_base",
            }) as OpenAITextRequest;

            expect(result).toEqual({
                model: "gpt-3.5-turbo-instruct",
                prompt: "系统描述\nuser:你好\nassistant:你好！\nassistant:",
                max_tokens: 100,
                temperature: 1,
                top_p: 1,
                n: 1,
                presence_penalty: 0,
                frequency_penalty: 0,
                logit_bias: null,
                stop: ["\n", "END"],
            });
        });

        it("1.4 应对空messages返回undefined", async () => {
            const option = MockOptionFactory.createChatTaskOption({
                messages: [],
            });
            const result = await formatter.formatOption({
                option,
                modelId: "gpt-3.5-turbo-instruct",
                tokensizerType: "cl100k_base",
            });

            expect(result).toBeUndefined();
        });

        it("1.5 应对null messages返回undefined", async () => {
            const baseOption = MockOptionFactory.createChatTaskOption();
            const option = {
                ...baseOption,
                messages: null as unknown as typeof baseOption.messages,
            };
            const result = await formatter.formatOption({
                option,
                modelId: "gpt-3.5-turbo-instruct",
                tokensizerType: "cl100k_base",
            });

            expect(result).toBeUndefined();
        });
    });

    describe("2. buildMessage 消息构建", () => {
        it("2.1 应正确转换聊天消息为文本格式", () => {
            const messages = [
                { type: 'desc' as const, content: '系统描述' },
                { type: 'chat' as const, senderName: 'user', content: '你好' },
                { type: 'chat' as const, senderName: 'assistant', content: '你好！' },
            ];
            const result = formatter.buildMessage({
                target: 'assistant',
                messages,
            });

            expect(result).toBe("系统描述\nuser:你好\nassistant:你好！");
        });

        it("2.2 应正确处理只有desc消息的情况", () => {
            const messages = [
                { type: 'desc' as const, content: '系统描述' },
            ];
            const result = formatter.buildMessage({
                target: 'assistant',
                messages,
            });

            expect(result).toBe('系统描述');
        });
    });

    describe("3. formatMessage 消息格式化", () => {
        it("3.1 应正确添加目标前缀", () => {
            const result = formatter.formatMessage({
                messages: 'user:你好',
                target: 'assistant',
            });

            expect(result).toBe('user:你好\nassistant:');
        });
    });

    describe("4. formatResp 响应解析", () => {
        it("4.1 应正确解析OpenAI文本响应", () => {
            const mockResp = MockResponseFactory.createOpenAITextResponse();
            const result = formatter.formatResp(mockResp);

            expect(result).toEqual({
                vaild: true,
                choices: [
                    { content: "您好，有什么需要帮助的吗？" },
                    { content: "您好，有什么需要帮助的吗？" },
                ],
            });
        });

        it("4.2 应正确处理空响应", () => {
            const mockResp = MockResponseFactory.createOpenAITextResponse({ choices: [] });
            const result = formatter.formatResp(mockResp);

            expect(result).toEqual({
                vaild: false,
                choices: [],
            });
        });

        it("4.3 应正确处理多选项响应", () => {
            const mockResp = MockResponseFactory.createOpenAITextResponse({
                choices: [
                    { index: 0, text: "选项1", finish_reason: "stop", logprobs: null },
                    { index: 1, text: "选项2", finish_reason: "stop", logprobs: null },
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
