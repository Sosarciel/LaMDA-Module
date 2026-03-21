import { OpenAIInstructBase } from "@sosraciel-lamda/lam-manager";
import type { OpenAITextResponse } from "@sosraciel-lamda/lam-manager";

const createMockOpenAITextResponse = (overrides: Partial<OpenAITextResponse> = {}): OpenAITextResponse => ({
    id: "cmpl-test",
    object: "text_completion",
    created: 1234567890,
    model: "deepseek-chat",
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    choices: [{
        index: 0,
        text: "续写内容",
        finish_reason: "stop",
        logprobs: null,
    }],
    ...overrides,
});

describe("LaM-Manager DeepseekText Formatter", () => {
    describe("1. formatResp 响应解析", () => {
        it("1.1 应正确解析文本响应", () => {
            const mockResp = createMockOpenAITextResponse();

            const result = OpenAIInstructBase.formatResp(mockResp);

            expect(result).toEqual({
                vaild: true,
                choices: [{ content: "续写内容" }],
            });
        });

        it("1.2 应正确处理空响应", () => {
            const mockResp = createMockOpenAITextResponse({ choices: [] });
            const result = OpenAIInstructBase.formatResp(mockResp);

            expect(result).toEqual({
                vaild: false,
                choices: [],
            });
        });

        it("1.3 应正确处理无效响应", () => {
            const mockResp = {} as OpenAITextResponse;
            const result = OpenAIInstructBase.formatResp(mockResp);

            expect(result).toEqual({
                vaild: false,
                choices: [],
            });
        });

        it("1.4 应正确处理多选项响应", () => {
            const mockResp = createMockOpenAITextResponse({
                choices: [
                    { index: 0, text: "选项1", finish_reason: "stop", logprobs: null },
                    { index: 1, text: "选项2", finish_reason: "stop", logprobs: null },
                ],
            });

            const result = OpenAIInstructBase.formatResp(mockResp);

            expect(result).toEqual({
                vaild: true,
                choices: [{ content: "选项1" }, { content: "选项2" }],
            });
        });

        it("1.5 应过滤掉无text的选项", () => {
            const mockResp = createMockOpenAITextResponse({
                choices: [
                    { index: 0, text: "有效响应", finish_reason: "stop", logprobs: null },
                    { index: 1, text: undefined as unknown as string, finish_reason: "stop", logprobs: null },
                ],
            });

            const result = OpenAIInstructBase.formatResp(mockResp);

            expect(result).toEqual({
                vaild: true,
                choices: [{ content: "有效响应" }],
            });
        });
    });
});
