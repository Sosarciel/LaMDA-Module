import { GeminiChatTaskFormatter, GeminiThinkMap, transGeminiThinkBudget, combineHint } from "@sosraciel-lamda/lam-manager";
import { MockResponseFactory, MockOptionFactory } from "@sosraciel-lamda/lam-manager/mock";
import type { GeminiRequest } from "@sosraciel-lamda/lam-manager";

describe("LaM-Manager ChatTask Gemini Formatter", () => {
    const formatter = GeminiChatTaskFormatter;

    describe("1. formatOption 选项格式化", () => {
        it("1.1 应正确格式化基本聊天选项", async () => {
            const option = MockOptionFactory.createChatTaskOption();
            const result = formatter.formatOption({
                option,
                modelId: "gemini-3-pro",
                tokensizerType: "cl100k_base",
            }) as GeminiRequest;

            expect(result).toEqual({
                system_instruction: {
                    parts: {
                        text: "系统描述",
                    },
                },
                contents: [
                    { role: "user", parts: [{ text: "user:" }] },
                    { role: "user", parts: [{ text: "你好" }] },
                    { role: "user", parts: [{ text: "assistant:" }] },
                    { role: "model", parts: [{ text: "你好！" }] },
                    { role: "user", parts: [{ text: "assistant:" }] },
                ],
                generationConfig: {
                    temperature: 1,
                    maxOutputTokens: 100,
                    topP: 1,
                    thinkingConfig: {
                        includeThoughts: true,
                    },
                },
                safetySettings: [
                    { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
                    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
                    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
                    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
                ],
            });
        });

        it("1.2 应正确处理hint提示", async () => {
            const option = MockOptionFactory.createChatTaskOption({
                hint: " (继续)",
            });
            const result = formatter.formatOption({
                option,
                modelId: "gemini-3-pro",
                tokensizerType: "cl100k_base",
            }) as GeminiRequest;

            expect(result.system_instruction).toEqual({
                parts: {
                    text: "系统描述",
                },
            });
            expect(result.contents).toEqual([
                { parts: [{ text: "user:" }], role: "user" },
                { parts: [{ text: "你好" }], role: "user" },
                { parts: [{ text: "assistant:" }], role: "user" },
                { parts: [{ text: "你好！ (继续)" }], role: "model" },
                { parts: [{ text: "assistant:" }], role: "user" },
            ]);
        });

        it("1.3 应正确处理think_budget参数", async () => {
            const option = MockOptionFactory.createChatTaskOption({
                think_budget: "hig",
            });
            const result = formatter.formatOption({
                option,
                modelId: "gemini-3-pro",
                tokensizerType: "cl100k_base",
            }) as GeminiRequest;

            expect(result.generationConfig?.thinkingConfig?.thinkingBudget).toBe(GeminiThinkMap["hig"]);
        });

        it("1.4 应正确处理stop参数", async () => {
            const option = MockOptionFactory.createChatTaskOption({
                stop: ["\n"],
            });
            const result = formatter.formatOption({
                option,
                modelId: "gemini-3-pro",
                tokensizerType: "cl100k_base",
            }) as GeminiRequest;

            expect(result.generationConfig?.stopSequences).toEqual(["\n"]);
        });

        it("1.5 应对空messages返回undefined", () => {
            const option = MockOptionFactory.createChatTaskOption({
                messages: [],
            });
            const result = formatter.formatOption({
                option,
                modelId: "gemini-3-pro",
                tokensizerType: "cl100k_base",
            });

            expect(result).toBeUndefined();
        });

        it("1.6 应对null messages返回undefined", () => {
            const baseOption = MockOptionFactory.createChatTaskOption();
            const option = {
                ...baseOption,
                messages: null as unknown as typeof baseOption.messages,
            };
            const result = formatter.formatOption({
                option,
                modelId: "gemini-3-pro",
                tokensizerType: "cl100k_base",
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

            expect(result).toEqual({
                define: "系统描述",
                message: [
                    { role: "user", parts: [{ text: "user:" }] },
                    { role: "user", parts: [{ text: "你好" }] },
                    { role: "user", parts: [{ text: "assistant:" }] },
                    { role: "model", parts: [{ text: "你好！" }] },
                ],
            });
        });

        it("2.2 应正确处理多条desc消息", () => {
            const messages = [
                { type: 'desc' as const, content: '系统描述1' },
                { type: 'desc' as const, content: '系统描述2' },
            ];
            const result = formatter.buildMessage({
                target: 'assistant',
                messages,
            });

            expect(result.define).toBe("系统描述1\n系统描述2");
        });
    });

    describe("3. formatResp 响应解析", () => {
        it("3.1 应正确解析Gemini响应", () => {
            const mockResp = MockResponseFactory.createGeminiResponse();
            const result = formatter.formatResp(mockResp);

            expect(result).toEqual({
                vaild: true,
                choices: [{ content: "你好！ 你好吗？ (Nǐ hǎo! Nǐ hǎo ma?)  \n \nThis means \"Hello! How are you?\"  How can I help you today?\n" }],
            });
        });

        it("3.2 应正确处理空响应", () => {
            const mockResp = MockResponseFactory.createGeminiResponse({
                candidates: [],
            });
            const result = formatter.formatResp(mockResp);

            expect(result).toEqual({
                vaild: false,
                choices: [],
            });
        });

        it("3.3 应正确过滤思考内容", () => {
            const mockResp = MockResponseFactory.createGeminiResponseWithThought(
                "这是思考内容",
                "这是实际响应"
            );
            const result = formatter.formatResp(mockResp);

            expect(result).toEqual({
                vaild: true,
                choices: [{ content: "这是实际响应" }],
            });
        });
    });

    describe("4. 辅助函数", () => {
        it("4.1 transGeminiThinkBudget应正确转换预算", () => {
            expect(transGeminiThinkBudget("gemini-3-pro", "hig")).toBe(1024);
            expect(transGeminiThinkBudget("gemini-3-pro", "mid")).toBe(512);
            expect(transGeminiThinkBudget("gemini-3-pro", "low")).toBe(256);
            expect(transGeminiThinkBudget("gemini-3-pro", "non")).toBe(128);
        });

        it("4.2 combineHint应为gemini-3-pro添加思考限制提示", () => {
            const option = MockOptionFactory.createChatTaskOption({
                think_budget: "hig",
                hint: "请继续",
            });
            const result = combineHint("gemini-3-pro", option);

            expect(result).toBe("请继续\nlimit_thought_tokens_to_under_1024_words");
        });

        it("4.3 combineHint应为gemini-2.5-pro添加思考限制提示", () => {
            const option = MockOptionFactory.createChatTaskOption({
                think_budget: "mid",
            });
            const result = combineHint("gemini-2.5-pro", option);

            expect(result).toBe("limit_thought_tokens_to_under_512_words");
        });

        it("4.4 combineHint不应为其他模型添加思考限制提示", () => {
            const option = MockOptionFactory.createChatTaskOption({
                think_budget: "hig",
                hint: "请继续",
            });
            const result = combineHint("gemini-1.5-pro", option);

            expect(result).toBe("请继续");
        });
    });
});
