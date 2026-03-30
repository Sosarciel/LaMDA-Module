import { DeepseekText } from "@sosraciel-lamda/lam-manager";
import { MockResponseFactory, MockOptionFactory } from "@sosraciel-lamda/lam-manager/mock";
import type { OpenAITextRequest } from "@sosraciel-lamda/lam-manager";

describe("LaM-Manager InstructTask DeepseekText Formatter", () => {
    const formatter = DeepseekText;

    describe("1. formatOption 选项格式化", () => {
        it("1.1 应正确格式化基本指示选项", async () => {
            const option = MockOptionFactory.createInstructTaskOption({
                prompt: "请续写：",
            });
            const result = await formatter.formatOption({
                option,
                modelId: "deepseek-chat",
                tokensizerType: "deepseek",
            }) as OpenAITextRequest;

            expect(result).toEqual({
                model: "deepseek-chat",
                prompt: "请续写：",
                max_tokens: 100,
                temperature: 0.7,
                top_p: 1,
                presence_penalty: 0,
                frequency_penalty: 0,
                logit_bias: null,
            });
        });

        it("1.2 应正确处理suffix参数(FIM模式)", async () => {
            const option = MockOptionFactory.createInstructTaskOption({
                prompt: "def hello():",
                suffix: "\n    return 'world'",
            });
            const result = await formatter.formatOption({
                option,
                modelId: "deepseek-chat",
                tokensizerType: "deepseek",
            }) as OpenAITextRequest;

            expect(result).toEqual({
                model: "deepseek-chat",
                prompt: "def hello():",
                max_tokens: 100,
                temperature: 0.7,
                top_p: 1,
                presence_penalty: 0,
                frequency_penalty: 0,
                logit_bias: null,
                suffix: "\n    return 'world'",
            });
        });

        it("1.3 应正确处理prefix参数", async () => {
            const option = MockOptionFactory.createInstructTaskOption({
                prompt: "请续写：",
                prefix: "输出：",
            });
            const result = await formatter.formatOption({
                option,
                modelId: "deepseek-chat",
                tokensizerType: "deepseek",
            }) as OpenAITextRequest;

            expect(result).toEqual({
                echo: undefined,
                logprobs: undefined,
                stop: undefined,
                suffix: undefined,
                model: "deepseek-chat",
                prompt: "请续写：输出：",
                max_tokens: 100,
                temperature: 0.7,
                top_p: 1,
                presence_penalty: 0,
                frequency_penalty: 0,
                logit_bias: null,
            });
        });

        it("1.4 应正确处理stop参数", async () => {
            const option = MockOptionFactory.createInstructTaskOption({
                prompt: "请续写：",
                stop: ["\n"],
            });
            const result = await formatter.formatOption({
                option,
                modelId: "deepseek-chat",
                tokensizerType: "deepseek",
            }) as OpenAITextRequest;

            expect(result).toEqual({
                model: "deepseek-chat",
                prompt: "请续写：",
                max_tokens: 100,
                temperature: 0.7,
                top_p: 1,
                presence_penalty: 0,
                frequency_penalty: 0,
                logit_bias: null,
                stop: ["\n"],
            });
        });

        it("1.5 应对空prompt返回undefined", async () => {
            const option = MockOptionFactory.createInstructTaskOption({
                prompt: "",
            });
            const result = await formatter.formatOption({
                option,
                modelId: "deepseek-chat",
                tokensizerType: "deepseek",
            });

            expect(result).toBeUndefined();
        });

        it("1.6 应对null prompt返回undefined", async () => {
            const baseOption = MockOptionFactory.createInstructTaskOption({
                prompt: "请续写：",
            });
            const option = {
                ...baseOption,
                prompt: null as unknown as typeof baseOption.prompt,
            };
            const result = await formatter.formatOption({
                option,
                modelId: "deepseek-chat",
                tokensizerType: "deepseek",
            });

            expect(result).toBeUndefined();
        });
    });

    describe("2. formatResp 响应解析", () => {
        it("2.1 应正确解析文本响应", () => {
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

        it("2.2 应正确处理空响应", () => {
            const mockResp = MockResponseFactory.createOpenAITextResponse({ choices: [] });
            const result = formatter.formatResp(mockResp);

            expect(result).toEqual({
                vaild: false,
                choices: [],
            });
        });

        it("2.3 应正确处理多选项响应", () => {
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
