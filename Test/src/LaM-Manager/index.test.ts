import { CredManager, LaMManager } from "@sosraciel-lamda/lam-manager";
import { LaMManagerMockServer, LaMManagerMockTool } from "@sosraciel-lamda/lam-manager/mock";
import { UtilFT } from "@zwa73/utils";
import path from 'pathe';
import { CACHE_PATH } from "@/src/Constant";


const getHttpModuleData = async (instanceName:string)=>{
    const sm = await LaMManager.sm.getService(instanceName);
    const data = sm?.instance.getData();
    if(data!=null && 'config' in data )
        return data;
    return null;
}

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

describe("LaM-Manager 集成测试", () => {
    describe("1. ChatTask 聊天任务", () => {
        const chatFn = async (instanceName: string, message: string) => {
            const moduleData = await getHttpModuleData(instanceName);
            const modelId = moduleData?.config?.id;
            
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

        it("1.1 GPT35Chat应成功完成对话", async () => {
            const moduleData = await getHttpModuleData("Chat_GPT35Chat");
            expect(moduleData?.config?.id).toBe("gpt-3.5-turbo");
            
            const result = await chatFn("Chat_GPT35Chat", "你好");

            expect(result.completed).toBeDefined();
            expect(result.completed?.vaild).toBe(true);
            expect(result.completed?.choices).toHaveLength(1);
            expect(result.completed?.choices?.[0]?.content).toBeDefined();
        });

        it("1.2 GPT35Text应成功完成对话", async () => {
            const moduleData = await getHttpModuleData("Chat_GPT35Text");
            expect(moduleData?.config?.id).toBe("gpt-3.5-turbo-instruct");
            
            const result = await chatFn("Chat_GPT35Text", "你好");

            expect(result.completed).toBeDefined();
            expect(result.completed?.vaild).toBe(true);
            expect(result.completed?.choices).toHaveLength(1);
            expect(result.completed?.choices?.[0]?.content).toBeDefined();
        });

        it("1.3 DeepseekChat应成功完成对话", async () => {
            const moduleData = await getHttpModuleData("Chat_DeepseekChat");
            expect(moduleData?.config?.id).toBe("deepseek-chat");
            
            const result = await chatFn("Chat_DeepseekChat", "你好");

            expect(result.completed).toBeDefined();
            expect(result.completed?.vaild).toBe(true);
            expect(result.completed?.choices).toHaveLength(1);
            expect(result.completed?.choices?.[0]?.content).toBeDefined();
        });

        it("1.4 Gemini3Pro应成功完成对话", async () => {
            const moduleData = await getHttpModuleData("Chat_Gemini3Pro");
            expect(moduleData?.config?.id).toBe("gemini-3-pro-preview");
            
            const result = await chatFn("Chat_Gemini3Pro", "你好");

            expect(result.completed).toBeDefined();
            expect(result.completed?.vaild).toBe(true);
            expect(result.completed?.choices).toHaveLength(1);
            expect(result.completed?.choices?.[0]?.content).toBeDefined();
        });
    });

    describe("2. InstructTask 指令任务", () => {
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

        it("2.1 GPT35Text应成功完成指令", async () => {
            const moduleData = await getHttpModuleData("Instruct_GPT35Text");
            expect(moduleData?.config?.id).toBe("gpt-3.5-turbo-instruct");
            
            const result = await instructFn("Instruct_GPT35Text", "续写");

            expect(result.completed).toBeDefined();
            expect(result.completed?.vaild).toBe(true);
            expect(result.completed?.choices).toHaveLength(1);
            expect(result.completed?.choices?.[0]?.content).toBeDefined();
        });

        it("2.2 DeepseekText应成功完成指令", async () => {
            const moduleData = await getHttpModuleData("Instruct_DeepseekText");
            expect(moduleData?.config?.id).toBe("deepseek-chat");
            
            const result = await instructFn("Instruct_DeepseekText", "def hello():");

            expect(result.completed).toBeDefined();
            expect(result.completed?.vaild).toBe(true);
            expect(result.completed?.choices).toHaveLength(1);
            expect(result.completed?.choices?.[0]?.content).toBeDefined();
        });

        it("2.3 DeepseekPrefix应成功完成前缀续写", async () => {
            const moduleData = await getHttpModuleData("Instruct_DeepseekPrefix");
            expect(moduleData?.config?.id).toBe("deepseek-chat");
            
            const result = await instructFn("Instruct_DeepseekPrefix", "请续写", {
                prefix: "function test() {"
            });

            expect(result.completed).toBeDefined();
            expect(result.completed?.vaild).toBe(true);
            expect(result.completed?.choices).toHaveLength(1);
            expect(result.completed?.choices?.[0]?.content).toBeDefined();
        });
    });

    describe("3. ErrorHandling 错误处理", () => {
        it("3.1 应正确处理无效实例名", async () => {
            const result = await LaMManager.chat.execute("InvalidInstance", {
                target: "assistant",
                messages: [{ type: 'chat', senderName: 'user', content: 'test' }],
                max_tokens: 100,
            });

            expect(result.completed).toBeUndefined();
        });
    });
});
