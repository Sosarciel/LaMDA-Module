import { DeepseekPrefix } from "@sosraciel-lamda/lam-manager";
import { MockResponseFactory, MockOptionFactory } from "@sosraciel-lamda/lam-manager/mock";
import type { DeepseekRequest } from "@sosraciel-lamda/lam-manager";

describe("LaM-Manager InstructTask DeepseekPrefix Formatter", () => {
    const formatter = DeepseekPrefix;

    describe("1. formatOption 选项格式化", () => {
        it("1.1 应正确格式化基本指示选项", async () => {
            const option = MockOptionFactory.createInstructTaskOption({
                prompt: "请续写：",
            });
            const result = await formatter.formatOption({
                option,
                modelId: "deepseek-chat",
                tokensizerType: "deepseek",
            }) as DeepseekRequest;

            expect(result).toEqual({
                model: "deepseek-chat",
                messages: [
                    { role: "user", content: "请续写：" },
                    { role: "assistant", content: "", prefix: true },
                ],
                max_tokens: 100,
                temperature: 0.7,
                top_p: 1,
                presence_penalty: 0,
                frequency_penalty: 0,
            });
        });

        it("1.2 应正确处理prefix参数作为用户消息", async () => {
            const option = MockOptionFactory.createInstructTaskOption({
                prompt: "系统提示内容",
                prefix: "用户输入前缀",
            });
            const result = await formatter.formatOption({
                option,
                modelId: "deepseek-chat",
                tokensizerType: "deepseek",
            }) as DeepseekRequest;

            expect(result).toEqual({
                model: "deepseek-chat",
                messages: [
                    { role: "user", content: "系统提示内容" },
                    { role: "assistant", content: "用户输入前缀", prefix: true },
                ],
                max_tokens: 100,
                temperature: 0.7,
                top_p: 1,
                presence_penalty: 0,
                frequency_penalty: 0,
            });
        });

        it("1.3 应正确处理stop参数", async () => {
            const option = MockOptionFactory.createInstructTaskOption({
                prompt: "请续写：",
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
                    { role: "user", content: "请续写：" },
                    { role: "assistant", content: "", prefix: true },
                ],
                max_tokens: 100,
                temperature: 0.7,
                top_p: 1,
                presence_penalty: 0,
                frequency_penalty: 0,
                stop: ["\n"],
            });
        });

        it("1.4 应对空prompt返回undefined", async () => {
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

        it("1.5 应对null prompt返回undefined", async () => {
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
        it("2.1 应正确解析Deepseek响应", () => {
            const mockResp = MockResponseFactory.createDeepseekResponse();
            const result = formatter.formatResp(mockResp);

            expect(result).toEqual({
                vaild: true,
                choices: [{ content: "你好，有什么需要帮助的吗？" }],
            });
        });

        it("2.2 应正确处理空响应", () => {
            const mockResp = MockResponseFactory.createDeepseekResponse({ choices: [] });
            const result = formatter.formatResp(mockResp);

            expect(result).toEqual({
                vaild: true,
                choices: [],
            });
        });

        it("2.3 应正确处理多选项响应", () => {
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
