import { GeminiChatTaskFormatter, GeminiThinkMap, transGeminiThinkBudget, combineHint } from "@sosraciel-lamda/lam-manager";
import type { LaMChatMessages, ChatTaskOption, GeminiResponse } from "@sosraciel-lamda/lam-manager";

describe("LaM-Manager Gemini Formatter", () => {
    describe("1. buildMessage 消息构建", () => {
        it("1.1 应正确转换聊天消息", () => {
            const messages: LaMChatMessages = [
                { type: 'desc', content: '系统描述' },
                { type: 'chat', senderName: 'user', content: '你好' },
                { type: 'chat', senderName: 'assistant', content: '你好！' },
            ];
            const result = GeminiChatTaskFormatter.buildMessage({
                target: 'assistant',
                messages,
            });

            expect(result.define).toBe('系统描述');
            expect(result.message).toHaveLength(4);
            expect(result.message[0].role).toBe('user');
            expect(result.message[0].parts[0].text).toBe('user:');
        });

        it("1.2 应正确处理hint提示", () => {
            const messages: LaMChatMessages = [
                { type: 'chat', senderName: 'user', content: '你好' },
            ];
            const result = GeminiChatTaskFormatter.buildMessage({
                target: 'assistant',
                messages,
                hint: ' (继续)',
            });

            const lastPart = result.message[result.message.length - 1].parts[0];
            expect(lastPart.text).toContain('(继续)');
        });

        it("1.3 应正确处理只有desc消息的情况", () => {
            const messages: LaMChatMessages = [
                { type: 'desc', content: '系统描述' },
            ];
            const result = GeminiChatTaskFormatter.buildMessage({
                target: 'assistant',
                messages,
            });

            expect(result.define).toBe('系统描述');
            expect(result.message).toHaveLength(0);
        });
    });

    describe("2. formatResp 响应解析", () => {
        it("2.1 应正确解析Gemini响应", () => {
            const mockResp = {
                candidates: [{
                    content: {
                        parts: [{ text: '测试响应' }],
                        role: 'model' as const,
                    },
                    finishReason: 'STOP',
                    avgLogprobs: -0.1,
                }],
                usageMetadata: {
                    promptTokenCount: 10,
                    candidatesTokenCount: 5,
                    totalTokenCount: 15,
                    promptTokensDetails: [{ modality: 'TEXT' as const, tokenCount: 5 }],
                    candidatesTokensDetails: [{ modality: 'TEXT' as const, tokenCount: 41 }],
                    thoughtsTokenCount: 0,
                },
                modelVersion: 'gemini-3-pro',
            } satisfies GeminiResponse;

            const result = GeminiChatTaskFormatter.formatResp(mockResp);

            expect(result).toEqual({
                vaild: true,
                choices: [{ content: '测试响应' }],
            });
        });

        it("2.2 应正确处理空响应", () => {
            const mockResp = {
                candidates: [],
                usageMetadata: {
                    promptTokenCount: 10,
                    candidatesTokenCount: 0,
                    totalTokenCount: 10,
                    promptTokensDetails: [{ modality: 'TEXT' as const, tokenCount: 5 }],
                    candidatesTokensDetails: [{ modality: 'TEXT' as const, tokenCount: 41 }],
                    thoughtsTokenCount: 0,
                },
                modelVersion: 'gemini-3-pro',
            } satisfies GeminiResponse;
            const result = GeminiChatTaskFormatter.formatResp(mockResp);

            expect(result).toEqual({
                vaild: false,
                choices: [],
            });
        });

        it("2.3 应过滤掉思考内容", () => {
            const mockResp = {
                candidates: [{
                    content: {
                        parts: [
                            { text: '思考内容', thought: true },
                            { text: '实际响应' },
                        ],
                        role: 'model' as const,
                    },
                    finishReason: 'STOP',
                    avgLogprobs: -0.1,
                }],
                usageMetadata: {
                    promptTokenCount: 10,
                    candidatesTokenCount: 5,
                    totalTokenCount: 15,
                    promptTokensDetails: [{ modality: 'TEXT' as const, tokenCount: 5 }],
                    candidatesTokensDetails: [{ modality: 'TEXT' as const, tokenCount: 41 }],
                    thoughtsTokenCount: 5,
                },
                modelVersion: 'gemini-3-pro',
            } satisfies GeminiResponse;

            const result = GeminiChatTaskFormatter.formatResp(mockResp);

            expect(result).toEqual({
                vaild: true,
                choices: [{ content: '实际响应' }],
            });
        });

        it("2.4 应正确处理多候选响应", () => {
            const mockResp = {
                candidates: [
                    {
                        content: { parts: [{ text: '选项1' }], role: 'model' as const },
                        finishReason: 'STOP',
                        avgLogprobs: -0.1,
                    },
                    {
                        content: { parts: [{ text: '选项2' }], role: 'model' as const },
                        finishReason: 'STOP',
                        avgLogprobs: -0.2,
                    },
                ],
                usageMetadata: {
                    promptTokenCount: 10,
                    candidatesTokenCount: 10,
                    totalTokenCount: 20,
                    promptTokensDetails: [{ modality: 'TEXT' as const, tokenCount: 5 }],
                    candidatesTokensDetails: [{ modality: 'TEXT' as const, tokenCount: 41 }],
                    thoughtsTokenCount: 0,
                },
                modelVersion: 'gemini-3-pro',
            } satisfies GeminiResponse;

            const result = GeminiChatTaskFormatter.formatResp(mockResp);

            expect(result).toEqual({
                vaild: true,
                choices: [{ content: '选项1' }, { content: '选项2' }],
            });
        });
    });

    describe("3. GeminiThinkMap 推理预算映射", () => {
        it("3.1 应正确映射推理预算", () => {
            expect(GeminiThinkMap.non).toBe(128);
            expect(GeminiThinkMap.hig).toBe(1024);
            expect(GeminiThinkMap.mid).toBe(512);
            expect(GeminiThinkMap.low).toBe(256);
            expect(GeminiThinkMap.min).toBe(128);
            expect(GeminiThinkMap.max).toBe(2048);
        });
    });

    describe("4. transGeminiThinkBudget 推理预算转换", () => {
        it("4.1 应正确转换think_budget参数", () => {
            expect(transGeminiThinkBudget('gemini-3-pro', 'hig')).toBe(1024);
            expect(transGeminiThinkBudget('gemini-3-pro', 'mid')).toBe(512);
            expect(transGeminiThinkBudget('gemini-3-pro', undefined)).toBeUndefined();
        });
    });

    describe("5. combineHint 提示组合", () => {
        it("5.1 gemini-3-pro应添加think_budget限制提示", () => {
            const opt: ChatTaskOption = {
                target: 'assistant',
                messages: [],
                think_budget: 'hig',
            };
            const result = combineHint('gemini-3-pro-preview', opt);
            expect(result).toContain('limit_thought_tokens_to_under_1024_words');
        });

        it("5.2 其他模型不应添加think_budget限制提示", () => {
            const opt: ChatTaskOption = {
                target: 'assistant',
                messages: [],
                think_budget: 'hig',
            };
            const result = combineHint('gemini-2-flash', opt);
            expect(result).toBeUndefined();
        });

        it("5.3 无think_budget时不应添加提示", () => {
            const opt: ChatTaskOption = {
                target: 'assistant',
                messages: [],
            };
            const result = combineHint('gemini-3-pro-preview', opt);
            expect(result).toBeUndefined();
        });
    });
});
