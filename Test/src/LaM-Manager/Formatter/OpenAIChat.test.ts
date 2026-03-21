import { OpenAIConversationChatTaskFormatter, OpenAIThinkMap, OpenAIThinkMapHasNone } from "@sosraciel-lamda/lam-manager";
import type { LaMChatMessages, OpenAIChatResponse, AnyOpenAIChatLikeResponse } from "@sosraciel-lamda/lam-manager";

describe("OpenAIChat Formatter", () => {
    describe("buildMessage", () => {
        it("应正确转换聊天消息", () => {
            const messages: LaMChatMessages = [
                { type: 'desc', content: '系统描述' },
                { type: 'chat', senderName: 'user', content: '你好' },
                { type: 'chat', senderName: 'assistant', content: '你好！' },
            ];
            const result = OpenAIConversationChatTaskFormatter.buildMessage({
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
            const result = OpenAIConversationChatTaskFormatter.buildMessage({
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
            const result = OpenAIConversationChatTaskFormatter.buildMessage({
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
            const result = OpenAIConversationChatTaskFormatter.buildMessage({
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
            const result = OpenAIConversationChatTaskFormatter.buildMessage({
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
        it("应正确解析OpenAI响应", () => {
            const mockResp: OpenAIChatResponse = {
                id: "chatcmpl-test",
                object: "chat.completion",
                created: 1234567890,
                model: "gpt-3.5-turbo",
                system_fingerprint: null,
                usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
                choices: [{
                    index: 0,
                    message: { role: "assistant", content: "测试响应" },
                    finish_reason: "stop",
                }],
            };

            const result = OpenAIConversationChatTaskFormatter.formatResp(mockResp);

            expect(result).toEqual({
                vaild: true,
                choices: [{ content: "测试响应" }],
            });
        });

        it("应正确处理空响应", () => {
            const mockResp: OpenAIChatResponse = {
                id: "chatcmpl-test",
                object: "chat.completion",
                created: 1234567890,
                model: "gpt-3.5-turbo",
                system_fingerprint: null,
                usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
                choices: [],
            };
            const result = OpenAIConversationChatTaskFormatter.formatResp(mockResp);

            expect(result).toEqual({
                vaild: false,
                choices: [],
            });
        });

        it("应正确处理无效响应", () => {
            const mockResp: AnyOpenAIChatLikeResponse = {} as AnyOpenAIChatLikeResponse;
            const result = OpenAIConversationChatTaskFormatter.formatResp(mockResp);

            expect(result).toEqual({
                vaild: false,
                choices: [],
            });
        });

        it("应正确处理多选项响应", () => {
            const mockResp: OpenAIChatResponse = {
                id: "chatcmpl-test",
                object: "chat.completion",
                created: 1234567890,
                model: "gpt-3.5-turbo",
                system_fingerprint: null,
                usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
                choices: [
                    { index: 0, message: { role: "assistant", content: "选项1" }, finish_reason: "stop" },
                    { index: 1, message: { role: "assistant", content: "选项2" }, finish_reason: "stop" },
                ],
            };

            const result = OpenAIConversationChatTaskFormatter.formatResp(mockResp);

            expect(result).toEqual({
                vaild: true,
                choices: [{ content: "选项1" }, { content: "选项2" }],
            });
        });

        it("应过滤掉无content的选项", () => {
            const mockResp: OpenAIChatResponse = {
                id: "chatcmpl-test",
                object: "chat.completion",
                created: 1234567890,
                model: "gpt-3.5-turbo",
                system_fingerprint: null,
                usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
                choices: [
                    { index: 0, message: { role: "assistant", content: "有效响应" }, finish_reason: "stop" },
                    { index: 1, message: { role: "assistant", content: undefined as unknown as string }, finish_reason: "stop" },
                ],
            };

            const result = OpenAIConversationChatTaskFormatter.formatResp(mockResp);

            expect(result).toEqual({
                vaild: true,
                choices: [{ content: "有效响应" }],
            });
        });
    });

    describe("OpenAIThinkMap", () => {
        it("应正确映射推理预算", () => {
            expect(OpenAIThinkMap.non).toBe('minimal');
            expect(OpenAIThinkMap.hig).toBe('high');
            expect(OpenAIThinkMap.mid).toBe('medium');
            expect(OpenAIThinkMap.low).toBe('low');
            expect(OpenAIThinkMap.min).toBe('minimal');
            expect(OpenAIThinkMap.max).toBe('xhigh');
        });
    });

    describe("OpenAIThinkMapHasNone", () => {
        it("应正确映射推理预算(支持none)", () => {
            expect(OpenAIThinkMapHasNone.non).toBe('none');
            expect(OpenAIThinkMapHasNone.hig).toBe('high');
            expect(OpenAIThinkMapHasNone.mid).toBe('medium');
            expect(OpenAIThinkMapHasNone.low).toBe('low');
            expect(OpenAIThinkMapHasNone.max).toBe('xhigh');
        });
    });
});
