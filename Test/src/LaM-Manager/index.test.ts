import { CredManager, LaMManager } from "@sosraciel-lamda/lam-manager";
import { LaMManagerMockServer, LaMManagerMockTool } from "@sosraciel-lamda/lam-manager/mock";
import { UtilFT } from "@zwa73/utils";
import path from 'pathe';
import { CACHE_PATH } from "@/src/Constant";

const server: LaMManagerMockServer = new LaMManagerMockServer(3000);

beforeAll(async () => {
    await server.start();
});

afterAll(async () => {
    await server.stop();
});

beforeAll(async () => {
    const LaMServiceTablePath = path.join(CACHE_PATH, 'LaMManager.json');
    const CredServiceTablePath = path.join(CACHE_PATH, 'CredManager.json');
    const CredCategoryTablePath = path.join(CACHE_PATH, 'CredCategory.json');

    await UtilFT.writeJSONFile(LaMServiceTablePath, LaMManagerMockTool.MOCK_LAM_SERVICE_TABLE);
    await UtilFT.writeJSONFile(CredServiceTablePath, LaMManagerMockTool.MOCK_CRED_SERVICE_TABLE);
    await UtilFT.writeJSONFile(CredCategoryTablePath, LaMManagerMockTool.MOCK_CRED_CATEGORY_TABLE);

    LaMManager.initInject({
        serviceTable: LaMServiceTablePath,
    });
    CredManager.initInject({
        serviceTable: CredServiceTablePath,
        categoryTable: CredCategoryTablePath,
    });
});

describe("LaM-Manager Integration", () => {
    describe("ChatTask", () => {
        const chatFn = async (instanceName: string, message: string) => {
            return LaMManager.chat.execute(instanceName, {
                target: LaMManagerMockTool.MOCK_CHAR,
                messages: [{
                    content: message,
                    type: 'chat',
                    senderName: LaMManagerMockTool.MOCK_USER,
                }],
                log_level: "debug",
                n: 1,
                max_tokens: 100,
                stop: ["\n"],
            });
        };

        it("GPT35Chat应成功完成对话", async () => {
            const result = await chatFn("Chat_GPT35Chat", "你好");

            // 验证响应结构（集成测试只验证流程正确性）
            expect(result.completed).toBeDefined();
            expect(result.completed?.vaild).toBe(true);
            expect(result.completed?.choices).toHaveLength(1);
            expect(result.completed?.choices?.[0]?.content).toBeDefined();
        });

        it("GPT35Text应成功完成对话", async () => {
            const result = await chatFn("Chat_GPT35Text", "你好");

            expect(result.completed).toBeDefined();
            expect(result.completed?.vaild).toBe(true);
            expect(result.completed?.choices).toHaveLength(1);
            expect(result.completed?.choices?.[0]?.content).toBeDefined();
        });

        it("DeepseekChat应成功完成对话", async () => {
            const result = await chatFn("Chat_DeepseekChat", "你好");

            expect(result.completed).toBeDefined();
            expect(result.completed?.vaild).toBe(true);
            expect(result.completed?.choices).toHaveLength(1);
            expect(result.completed?.choices?.[0]?.content).toBeDefined();
        });

        it("Gemini3Pro应成功完成对话", async () => {
            const result = await chatFn("Chat_Gemini3Pro", "你好");

            expect(result.completed).toBeDefined();
            expect(result.completed?.vaild).toBe(true);
            expect(result.completed?.choices).toHaveLength(1);
            expect(result.completed?.choices?.[0]?.content).toBeDefined();
        });
    });

    describe("InstructTask", () => {
        const instructFn = async (instanceName: string, prompt: string, options?: {
            suffix?: string;
            prefix?: string;
            max_tokens?: number;
            temperature?: number;
        }) => {
            return LaMManager.instruct.execute(instanceName, {
                prompt: prompt,
                suffix: options?.suffix,
                prefix: options?.prefix,
                max_tokens: options?.max_tokens || 100,
                temperature: options?.temperature || 0.7,
                log_level: "debug",
            });
        };

        it("GPT35Text应成功完成指令", async () => {
            const result = await instructFn("Instruct_GPT35Text", "续写");

            expect(result.completed).toBeDefined();
            expect(result.completed?.vaild).toBe(true);
            expect(result.completed?.choices).toHaveLength(1);
            expect(result.completed?.choices?.[0]?.content).toBeDefined();
        });

        it("DeepseekText应成功完成指令", async () => {
            const result = await instructFn("Instruct_DeepseekText", "def hello():");

            expect(result.completed).toBeDefined();
            expect(result.completed?.vaild).toBe(true);
            expect(result.completed?.choices).toHaveLength(1);
            expect(result.completed?.choices?.[0]?.content).toBeDefined();
        });

        it("DeepseekPrefix应成功完成前缀续写", async () => {
            const result = await instructFn("Instruct_DeepseekPrefix", "请续写", {
                prefix: "function test() {"
            });

            expect(result.completed).toBeDefined();
            expect(result.completed?.vaild).toBe(true);
            expect(result.completed?.choices).toHaveLength(1);
            expect(result.completed?.choices?.[0]?.content).toBeDefined();
        });
    });

    describe("Error Handling", () => {
        it("应正确处理无效实例名", async () => {
            const result = await LaMManager.chat.execute("InvalidInstance", {
                target: "assistant",
                messages: [{ type: 'chat', senderName: 'user', content: 'test' }],
                max_tokens: 100,
            });

            // 无效实例应返回空结果
            expect(result.completed).toBeUndefined();
        });
    });
});
