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

            expect(result).toBeDefined();
            expect(result.model).toBe("deepseek-chat");
            expect(result.messages).toBeDefined();
            expect(result.messages!.length).toBeGreaterThan(0);
            expect(result.max_tokens).toBe(100);
            expect(result.temperature).toBe(1);
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

            expect(result).toBeDefined();
            expect(result.messages).toBeDefined();
            const hasHint = result.messages!.some(m => 
                typeof m.content === 'string' && m.content.includes("(继续)")
            );
            expect(hasHint).toBe(true);
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

            expect(result).toBeDefined();
            expect(result.stop).toEqual(["\n"]);
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

            expect(result).toBeDefined();
            expect(result.presence_penalty).toBe(0.5);
            expect(result.frequency_penalty).toBe(0.3);
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

            expect(result.vaild).toBe(true);
            expect(result.choices.length).toBeGreaterThan(0);
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
