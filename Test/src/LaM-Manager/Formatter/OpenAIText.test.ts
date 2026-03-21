import { OpenAITextChatTaskFormatter } from "@sosraciel-lamda/lam-manager";
import type { LaMChatMessages, OpenAITextResponse } from "@sosraciel-lamda/lam-manager";

const createMockOpenAITextResponse = (overrides: Partial<OpenAITextResponse> = {}): OpenAITextResponse => ({
    id: "cmpl-test",
    object: "text_completion",
    created: 1234567890,
    model: "gpt-3.5-turbo-instruct",
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    choices: [{
        index: 0,
        text: "测试响应",
        finish_reason: "stop",
        logprobs: null,
    }],
    ...overrides,
});

describe("LaM-Manager OpenAIText Formatter", () => {
    describe("1. buildMessage 消息构建", () => {
        it("1.1 应正确转换聊天消息为文本格式", () => {
            const messages: LaMChatMessages = [
                { type: 'desc', content: '系统描述' },
                { type: 'chat', senderName: 'user', content: '你好' },
                { type: 'chat', senderName: 'assistant', content: '你好！' },
            ];
            const result = OpenAITextChatTaskFormatter.buildMessage({
                target: 'assistant',
                messages,
            });

            expect(result).toContain('系统描述');
            expect(result).toContain('user:你好');
            expect(result).toContain('assistant:你好！');
        });

        it("1.2 应正确处理hint提示", () => {
            const messages: LaMChatMessages = [
                { type: 'chat', senderName: 'user', content: '你好' },
            ];
            const result = OpenAITextChatTaskFormatter.buildMessage({
                target: 'assistant',
                messages,
                hint: ' (继续)',
            });

            expect(result).toContain('(继续)');
        });

        it("1.3 应正确处理只有desc消息的情况", () => {
            const messages: LaMChatMessages = [
                { type: 'desc', content: '系统描述' },
            ];
            const result = OpenAITextChatTaskFormatter.buildMessage({
                target: 'assistant',
                messages,
            });

            expect(result).toBe('系统描述');
        });

        it("1.4 应正确处理多条desc消息", () => {
            const messages: LaMChatMessages = [
                { type: 'desc', content: '系统描述1' },
                { type: 'desc', content: '系统描述2' },
            ];
            const result = OpenAITextChatTaskFormatter.buildMessage({
                target: 'assistant',
                messages,
            });

            expect(result).toContain('系统描述1');
            expect(result).toContain('系统描述2');
        });
    });

    describe("2. formatMessage 消息格式化", () => {
        it("2.1 应正确添加目标前缀", () => {
            const result = OpenAITextChatTaskFormatter.formatMessage({
                messages: 'user:你好',
                target: 'assistant',
            });

            expect(result).toBe('user:你好\nassistant:');
        });
    });

    describe("3. formatResp 响应解析", () => {
        it("3.1 应正确解析OpenAI文本响应", () => {
            const mockResp = createMockOpenAITextResponse();

            const result = OpenAITextChatTaskFormatter.formatResp(mockResp);

            expect(result).toEqual({
                vaild: true,
                choices: [{ content: "测试响应" }],
            });
        });

        it("3.2 应正确处理空响应", () => {
            const mockResp = createMockOpenAITextResponse({ choices: [] });
            const result = OpenAITextChatTaskFormatter.formatResp(mockResp);

            expect(result).toEqual({
                vaild: false,
                choices: [],
            });
        });

        it("3.3 应正确处理无效响应", () => {
            const mockResp = createMockOpenAITextResponse({ choices: [] });
            const result = OpenAITextChatTaskFormatter.formatResp(mockResp);

            expect(result).toEqual({
                vaild: false,
                choices: [],
            });
        });

        it("3.4 应正确处理多选项响应", () => {
            const mockResp = createMockOpenAITextResponse({
                choices: [
                    { index: 0, text: "选项1", finish_reason: "stop", logprobs: null },
                    { index: 1, text: "选项2", finish_reason: "stop", logprobs: null },
                ],
            });

            const result = OpenAITextChatTaskFormatter.formatResp(mockResp);

            expect(result).toEqual({
                vaild: true,
                choices: [{ content: "选项1" }, { content: "选项2" }],
            });
        });

        it("3.5 应过滤掉无text的选项", () => {
            const mockResp = createMockOpenAITextResponse({
                choices: [
                    { index: 0, text: "有效响应", finish_reason: "stop", logprobs: null },
                    { index: 1, text: undefined as unknown as string, finish_reason: "stop", logprobs: null },
                ],
            });

            const result = OpenAITextChatTaskFormatter.formatResp(mockResp);

            expect(result).toEqual({
                vaild: true,
                choices: [{ content: "有效响应" }],
            });
        });
    });
});
