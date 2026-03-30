import { DeepseekTextChatTaskFormatter } from "@sosraciel-lamda/lam-manager";
import { MockResponseFactory, MockOptionFactory } from "@sosraciel-lamda/lam-manager/mock";
import type { OpenAITextRequest } from "@sosraciel-lamda/lam-manager";

describe("LaM-Manager ChatTask DeepseekText Formatter", () => {
    const formatter = DeepseekTextChatTaskFormatter;

    describe("1. formatOption 选项格式化", () => {
        it("1.1 应正确格式化基本聊天选项", async () => {
            const option = MockOptionFactory.createChatTaskOption();
            const result = await formatter.formatOption({
                option,
                modelId: "deepseek-chat",
                tokensizerType: "deepseek",
            }) as OpenAITextRequest;

            expect(result).toEqual({
                model: "deepseek-chat",
                prompt: "系统描述\nuser:你好\nassistant:你好！\nassistant:",
                max_tokens: 100,
                temperature: 1,
                top_p: 1,
                presence_penalty: 0,
                frequency_penalty: 0,
            });
        });

        it("1.2 应正确处理hint提示", async () => {
            const option = MockOptionFactory.createChatTaskOption({
                hint: " (继续)",
            });
            const result = await formatter.formatOption({
                option,
                modelId: "deepseek-chat",
                tokensizerType: "deepseek",
            }) as OpenAITextRequest;

            expect(result).toEqual({
                model: "deepseek-chat",
                prompt: "系统描述\nuser:你好\nassistant:你好！ (继续)\nassistant:",
                max_tokens: 100,
                temperature: 1,
                top_p: 1,
                presence_penalty: 0,
                frequency_penalty: 0,
            });
        });

        it("1.3 应正确处理stop参数", async () => {
            const option = MockOptionFactory.createChatTaskOption({
                stop: ["\n"],
            });
            const result = await formatter.formatOption({
                option,
                modelId: "deepseek-chat",
                tokensizerType: "deepseek",
            }) as OpenAITextRequest;

            expect(result).toEqual({
                model: "deepseek-chat",
                prompt: "系统描述\nuser:你好\nassistant:你好！\nassistant:",
                max_tokens: 100,
                temperature: 1,
                top_p: 1,
                presence_penalty: 0,
                frequency_penalty: 0,
                stop: ["\n"],
            });
        });

        it("1.4 应对空messages返回undefined", async () => {
            const option = MockOptionFactory.createChatTaskOption({
                messages: [],
            });
            const result = await formatter.formatOption({
                option,
                modelId: "deepseek-chat",
                tokensizerType: "deepseek",
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
                modelId: "deepseek-chat",
                tokensizerType: "deepseek",
            });

            expect(result).toBeUndefined();
        });
    });

    describe("2. buildMessage 消息构建", () => {
        it("2.1 应正确转换聊天消息为文本格式", () => {
            const messages = [
                { type: 'desc' as const, content: '系统描述' },
                { type: 'chat' as const, senderName: 'user', content: '你好' },
            ];
            const result = formatter.buildMessage({
                target: 'assistant',
                messages,
            });

            expect(result).toBe("系统描述\nuser:你好");
        });
    });

    describe("3. formatResp 响应解析", () => {
        it("3.1 应正确解析文本响应", () => {
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

        it("3.2 应正确处理空响应", () => {
            const mockResp = MockResponseFactory.createOpenAITextResponse({ choices: [] });
            const result = formatter.formatResp(mockResp);

            expect(result).toEqual({
                vaild: false,
                choices: [],
            });
        });

        it("3.3 应正确处理多选项响应", () => {
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
