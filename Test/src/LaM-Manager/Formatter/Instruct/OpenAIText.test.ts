import { OpenAIText } from "@sosraciel-lamda/lam-manager";
import { MockResponseFactory, MockOptionFactory } from "@sosraciel-lamda/lam-manager/mock";
import type { OpenAITextRequest } from "@sosraciel-lamda/lam-manager";

describe("LaM-Manager InstructTask OpenAIText Formatter", () => {
    const formatter = OpenAIText;

    describe("1. formatOption 选项格式化", () => {
        it("1.1 应正确格式化基本指示选项", async () => {
            const option = MockOptionFactory.createInstructTaskOption({
                prompt: "请续写：",
            });
            const result = await formatter.formatOption({
                option,
                modelId: "gpt-3.5-turbo-instruct",
                tokensizerType: "cl100k_base",
            }) as OpenAITextRequest;

            expect(result).toBeDefined();
            expect(result.model).toBe("gpt-3.5-turbo-instruct");
            expect(result.prompt).toBeDefined();
            expect(result.max_tokens).toBe(100);
            expect(result.temperature).toBe(0.7);
        });

        it("1.2 应正确处理suffix参数", async () => {
            const option = MockOptionFactory.createInstructTaskOption({
                prompt: "def hello():",
                suffix: "\n    return 'world'",
            });
            const result = await formatter.formatOption({
                option,
                modelId: "gpt-3.5-turbo-instruct",
                tokensizerType: "cl100k_base",
            }) as OpenAITextRequest;

            expect(result).toBeDefined();
            expect(result.suffix).toBe("\n    return 'world'");
        });

        it("1.3 应正确处理stop参数", async () => {
            const option = MockOptionFactory.createInstructTaskOption({
                prompt: "请续写：",
                stop: ["\n", "END"],
            });
            const result = await formatter.formatOption({
                option,
                modelId: "gpt-3.5-turbo-instruct",
                tokensizerType: "cl100k_base",
            }) as OpenAITextRequest;

            expect(result).toBeDefined();
            expect(result.stop).toEqual(["\n", "END"]);
        });

        it("1.4 应正确处理logprobs参数", async () => {
            const option = MockOptionFactory.createInstructTaskOption({
                prompt: "请续写：",
                logprobs: 5,
            });
            const result = await formatter.formatOption({
                option,
                modelId: "gpt-3.5-turbo-instruct",
                tokensizerType: "cl100k_base",
            }) as OpenAITextRequest;

            expect(result).toBeDefined();
            expect(result.logprobs).toBe(5);
        });

        it("1.5 应正确处理echo参数", async () => {
            const option = MockOptionFactory.createInstructTaskOption({
                prompt: "请续写：",
                echo: true,
            });
            const result = await formatter.formatOption({
                option,
                modelId: "gpt-3.5-turbo-instruct",
                tokensizerType: "cl100k_base",
            }) as OpenAITextRequest;

            expect(result).toBeDefined();
            expect(result.echo).toBe(true);
        });

        it("1.6 应对空prompt返回undefined", async () => {
            const option = MockOptionFactory.createInstructTaskOption({
                prompt: "",
            });
            const result = await formatter.formatOption({
                option,
                modelId: "gpt-3.5-turbo-instruct",
                tokensizerType: "cl100k_base",
            });

            expect(result).toBeUndefined();
        });
    });

    describe("2. formatResp 响应解析", () => {
        it("2.1 应正确解析文本响应", () => {
            const mockResp = MockResponseFactory.createOpenAITextResponse();
            const result = formatter.formatResp(mockResp);

            expect(result.vaild).toBe(true);
            expect(result.choices.length).toBeGreaterThan(0);
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
