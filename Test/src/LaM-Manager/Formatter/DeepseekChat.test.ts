import { DeepseekChatTaskFormatter } from "@sosraciel-lamda/lam-manager";
import type { LaMChatMessages, DeepseekResponse } from "@sosraciel-lamda/lam-manager";

const createMockDeepseekResponse = (overrides: Partial<DeepseekResponse> = {}): DeepseekResponse => ({
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 1234567890,
    model: "deepseek-chat",
    system_fingerprint: "fp_test",
    usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
        prompt_cache_hit_tokens: 0,
        prompt_cache_miss_tokens: 10,
        prompt_tokens_details: { cached_tokens: 0 },
    },
    choices: [{
        index: 0,
        message: { role: "assistant", content: "测试响应" },
        finish_reason: "stop",
        logprobs: null,
    }],
    ...overrides,
});

describe("DeepseekChat Formatter", () => {
    describe("buildMessage", () => {
        it("应正确转换聊天消息", () => {
            const messages: LaMChatMessages = [
                { type: 'desc', content: '系统描述' },
                { type: 'chat', senderName: 'user', content: '你好' },
                { type: 'chat', senderName: 'assistant', content: '你好！' },
            ];
            const result = DeepseekChatTaskFormatter.buildMessage({
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

        it("应正确处理hint提示", () => {
            const messages: LaMChatMessages = [
                { type: 'chat', senderName: 'user', content: '你好' },
            ];
            const result = DeepseekChatTaskFormatter.buildMessage({
                target: 'assistant',
                messages,
                hint: ' (继续)',
            });

            expect(result).toEqual([
                { role: 'system', content: 'user:' },
                { role: 'user', content: '你好 (继续)' },
            ]);
        });

        it("应正确处理只有desc消息的情况", () => {
            const messages: LaMChatMessages = [
                { type: 'desc', content: '系统描述' },
            ];
            const result = DeepseekChatTaskFormatter.buildMessage({
                target: 'assistant',
                messages,
            });

            expect(result).toEqual([
                { role: 'system', content: '系统描述' },
            ]);
        });

        it("应正确处理多条desc消息", () => {
            const messages: LaMChatMessages = [
                { type: 'desc', content: '系统描述1' },
                { type: 'desc', content: '系统描述2' },
                { type: 'chat', senderName: 'user', content: '你好' },
            ];
            const result = DeepseekChatTaskFormatter.buildMessage({
                target: 'assistant',
                messages,
            });

            expect(result).toEqual([
                { role: 'system', content: '系统描述1' },
                { role: 'system', content: '系统描述2' },
                { role: 'system', content: 'user:' },
                { role: 'user', content: '你好' },
            ]);
        });

        it("应正确处理目标角色发送的消息", () => {
            const messages: LaMChatMessages = [
                { type: 'chat', senderName: 'assistant', content: '你好' },
            ];
            const result = DeepseekChatTaskFormatter.buildMessage({
                target: 'assistant',
                messages,
            });

            expect(result).toEqual([
                { role: 'system', content: 'assistant:' },
                { role: 'assistant', content: '你好' },
            ]);
        });
    });

    describe("formatResp", () => {
        it("应正确解析Deepseek响应", () => {
            const mockResp = createMockDeepseekResponse();

            const result = DeepseekChatTaskFormatter.formatResp(mockResp);

            expect(result).toEqual({
                vaild: true,
                choices: [{ content: "测试响应" }],
            });
        });

        it("应正确处理空响应", () => {
            const mockResp = createMockDeepseekResponse({ choices: [] });
            const result = DeepseekChatTaskFormatter.formatResp(mockResp);

            expect(result).toEqual({
                vaild: false,
                choices: [],
            });
        });

        it("应正确处理无效响应", () => {
            const mockResp = createMockDeepseekResponse({ choices: undefined as unknown as [] });
            const result = DeepseekChatTaskFormatter.formatResp(mockResp);

            expect(result).toEqual({
                vaild: false,
                choices: [],
            });
        });

        it("应正确处理多选项响应", () => {
            const mockResp = createMockDeepseekResponse({
                choices: [
                    { index: 0, message: { role: "assistant", content: "选项1" }, finish_reason: "stop", logprobs: null },
                    { index: 1, message: { role: "assistant", content: "选项2" }, finish_reason: "stop", logprobs: null },
                ],
            });

            const result = DeepseekChatTaskFormatter.formatResp(mockResp);

            expect(result).toEqual({
                vaild: true,
                choices: [{ content: "选项1" }, { content: "选项2" }],
            });
        });

        it("应过滤掉无content的选项", () => {
            const mockResp = createMockDeepseekResponse({
                choices: [
                    { index: 0, message: { role: "assistant", content: "有效响应" }, finish_reason: "stop", logprobs: null },
                    { index: 1, message: { role: "assistant", content: undefined as unknown as string }, finish_reason: "stop", logprobs: null },
                ],
            });

            const result = DeepseekChatTaskFormatter.formatResp(mockResp);

            expect(result).toEqual({
                vaild: true,
                choices: [{ content: "有效响应" }],
            });
        });
    });
});
