import { DeepseekPrefix } from "@sosraciel-lamda/lam-manager";
import type { DeepseekResponse } from "@sosraciel-lamda/lam-manager";

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
        message: { role: "assistant", content: "续写内容" },
        finish_reason: "stop",
        logprobs: null,
    }],
    ...overrides,
});

describe("LaM-Manager DeepseekPrefix Formatter", () => {
    describe("1. formatResp 响应解析", () => {
        it("1.1 应正确解析Deepseek响应", () => {
            const mockResp = createMockDeepseekResponse();

            const result = DeepseekPrefix.formatResp(mockResp);

            expect(result).toEqual({
                vaild: true,
                choices: [{ content: "续写内容" }],
            });
        });

        it("1.2 应正确处理空响应", () => {
            const mockResp = createMockDeepseekResponse({ choices: [] });
            const result = DeepseekPrefix.formatResp(mockResp);

            expect(result).toEqual({
                vaild: true,
                choices: [],
            });
        });

        it("1.3 应正确处理多选项响应", () => {
            const mockResp = createMockDeepseekResponse({
                choices: [
                    { index: 0, message: { role: "assistant", content: "选项1" }, finish_reason: "stop", logprobs: null },
                    { index: 1, message: { role: "assistant", content: "选项2" }, finish_reason: "stop", logprobs: null },
                ],
            });

            const result = DeepseekPrefix.formatResp(mockResp);

            expect(result).toEqual({
                vaild: true,
                choices: [{ content: "选项1" }, { content: "选项2" }],
            });
        });

        it("1.4 应保留无content的选项", () => {
            const mockResp = createMockDeepseekResponse({
                choices: [
                    { index: 0, message: { role: "assistant", content: "有效响应" }, finish_reason: "stop", logprobs: null },
                    { index: 1, message: { role: "assistant", content: undefined as unknown as string }, finish_reason: "stop", logprobs: null },
                ],
            });

            const result = DeepseekPrefix.formatResp(mockResp);

            expect(result).toEqual({
                vaild: true,
                choices: [{ content: "有效响应" }, { content: undefined }],
            });
        });
    });
});
