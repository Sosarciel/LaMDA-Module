import { DeepseekChatTaskFormatter } from "@sosraciel-lamda/lam-manager";
import { MockResponseFactory, MockOptionFactory } from "@sosraciel-lamda/lam-manager/mock";
import type { DeepseekRequest } from "@sosraciel-lamda/lam-manager";

describe("LaM-Manager ChatTask DeepseekChat Formatter", () => {
    const formatter = DeepseekChatTaskFormatter;

    describe("1. formatOption 选项格式化", () => {
        it("1.1 应正确格式化基本聊天选项", async () => {
            const option = MockOptionFactory.createChatTaskOption();
            const result = await formatter.formatOption({
                option,
                modelId: "deepseek-chat",
                tokensizerType: "deepseek",
            }) as DeepseekRequest;

            expect(result).toEqual({
                model: "deepseek-chat",
                messages: [
                    { role: "system", content: "系统描述" },
                    { role: "system", content: "user:" },
                    { role: "user", content: "你好" },
                    { role: "system", content: "assistant:" },
                    { role: "assistant", content: "你好！" },
                    { role: "system", content: "assistant:" },
                ],
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
            }) as DeepseekRequest;

            expect(result).toEqual({
                model: "deepseek-chat",
                messages: [
                    { role: "system", content: "系统描述" },
                    { role: "system", content: "user:" },
                    { role: "user", content: "你好" },
                    { role: "system", content: "assistant:" },
                    { role: "assistant", content: "你好！ (继续)" },
                    { role: "system", content: "assistant:" },
                ],
                max_tokens: 100,
                temperature: 1,
                top_p: 1,
                presence_penalty: 0,
                frequency_penalty: 0,
                stop:undefined
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
            }) as DeepseekRequest;

            expect(result).toEqual({
                model: "deepseek-chat",
                messages: [
                    { role: "system", content: "系统描述" },
                    { role: "system", content: "user:" },
                    { role: "user", content: "你好" },
                    { role: "system", content: "assistant:" },
                    { role: "assistant", content: "你好！" },
                    { role: "system", content: "assistant:" },
                ],
                max_tokens: 100,
                temperature: 1,
                top_p: 1,
                presence_penalty: 0,
                frequency_penalty: 0,
                stop: ["\n"],
            });
        });

        it("1.4 应正确处理presence_penalty和frequency_penalty", async () => {
            const option = MockOptionFactory.createChatTaskOption({
                presence_penalty: 0.5,
                frequency_penalty: 0.3,
            });
            const result = await formatter.formatOption({
                option,
                modelId: "deepseek-chat",
                tokensizerType: "deepseek",
            }) as DeepseekRequest;

            expect(result).toEqual({
                model: "deepseek-chat",
                messages: [
                    { role: "system", content: "系统描述" },
                    { role: "system", content: "user:" },
                    { role: "user", content: "你好" },
                    { role: "system", content: "assistant:" },
                    { role: "assistant", content: "你好！" },
                    { role: "system", content: "assistant:" },
                ],
                max_tokens: 100,
                temperature: 1,
                top_p: 1,
                presence_penalty: 0.5,
                frequency_penalty: 0.3,
            });
        });

        it("1.5 应对空messages返回undefined", async () => {
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

        it("1.6 应对null messages返回undefined", async () => {
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
    });

    describe("3. formatResp 响应解析", () => {
        it("3.1 应正确解析Deepseek响应", () => {
            const mockResp = MockResponseFactory.createDeepseekResponse();
            const result = formatter.formatResp(mockResp);

            expect(result).toEqual({
                vaild: true,
                choices: [{ content: "你好，有什么需要帮助的吗？" }],
            });
        });

        it("3.2 应正确处理空响应", () => {
            const mockResp = MockResponseFactory.createDeepseekResponse({ choices: [] });
            const result = formatter.formatResp(mockResp);

            expect(result).toEqual({
                vaild: false,
                choices: [],
            });
        });

        it("3.3 应正确处理多选项响应", () => {
            const mockResp = MockResponseFactory.createDeepseekResponse({
                choices: [
                    { index: 0, message: { role: "assistant", content: "选项1" }, finish_reason: "stop", logprobs: null },
                    { index: 1, message: { role: "assistant", content: "选项2" }, finish_reason: "stop", logprobs: null },
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
