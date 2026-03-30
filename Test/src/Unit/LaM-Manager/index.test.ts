import { CredManager, LaMManager } from "@sosraciel-lamda/lam-manager";
import { LaMManagerMockServer, LaMManagerMockTool } from "@sosraciel-lamda/lam-manager/mock";
import { UtilFT } from "@zwa73/utils";
import path from 'pathe';
import { CACHE_PATH, LAM_PORT } from "@/src/Constant";


const getHttpModuleData = async (instanceName:string)=>{
    const sm = await LaMManager.sm.getService(instanceName);
    const data = sm?.instance.getData();
    if(data!=null && 'config' in data )
        return data;
    return null;
}

/** Mock 服务配置表 (使用自定义端口) */
const MOCK_CRED_CATEGORY_TABLE = LaMManagerMockTool.getMockCredCategoryTable(LAM_PORT);

const server: LaMManagerMockServer = new LaMManagerMockServer(LAM_PORT);

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
    await UtilFT.writeJSONFile(CredCategoryTablePath, MOCK_CRED_CATEGORY_TABLE);

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
            
            return {
                result: await LaMManager.chat.execute(instanceName, {
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
                }),
                modelId,
            };
        };

        it("1.1 GPT35Chat应成功完成对话", async () => {
            const { result, modelId } = await chatFn("Chat_GPT35Chat", "你好");
            const expectedContent = LaMManagerMockTool.buildMockResponseText(modelId!);

            expect(modelId).toBe("gpt-3.5-turbo");
            expect(result.completed).toEqual({
                vaild: true,
                choices: [{ content: expectedContent }],
            });
        });

        it("1.2 GPT35Text应成功完成对话", async () => {
            const { result, modelId } = await chatFn("Chat_GPT35Text", "你好");
            const expectedContent = LaMManagerMockTool.buildMockResponseText(modelId!);

            expect(modelId).toBe("gpt-3.5-turbo-instruct");
            expect(result.completed).toEqual({
                vaild: true,
                choices: [{ content: expectedContent }],
            });
        });

        it("1.3 DeepseekChat应成功完成对话", async () => {
            const { result, modelId } = await chatFn("Chat_DeepseekChat", "你好");
            const expectedContent = LaMManagerMockTool.buildMockResponseText(modelId!);

            expect(modelId).toBe("deepseek-chat");
            expect(result.completed).toEqual({
                vaild: true,
                choices: [{ content: expectedContent }],
            });
        });

        it("1.4 Gemini3Pro应成功完成对话", async () => {
            const { result, modelId } = await chatFn("Chat_Gemini3Pro", "你好");
            const expectedContent = LaMManagerMockTool.buildMockResponseText(modelId!);

            expect(modelId).toBe("gemini-3-pro-preview");
            expect(result.completed).toEqual({
                vaild: true,
                choices: [{ content: expectedContent }],
            });
        });
    });

    describe("2. InstructTask 指令任务", () => {
        const instructFn = async (instanceName: string, prompt: string, options?: {
            suffix?: string;
            prefix?: string;
            max_tokens?: number;
            temperature?: number;
        }) => {
            const moduleData = await getHttpModuleData(instanceName);
            const modelId = moduleData?.config?.id;

            return {
                result: await LaMManager.instruct.execute(instanceName, {
                    prompt: prompt,
                    suffix: options?.suffix,
                    prefix: options?.prefix,
                    max_tokens: options?.max_tokens || 100,
                    temperature: options?.temperature || 0.7,
                    log_level: "debug",
                }),
                modelId,
            };
        };

        it("2.1 GPT35Text应成功完成指令", async () => {
            const { result, modelId } = await instructFn("Instruct_GPT35Text", "续写");
            const expectedContent = LaMManagerMockTool.buildMockResponseText(modelId!);

            expect(modelId).toBe("gpt-3.5-turbo-instruct");
            expect(result.completed).toEqual({
                vaild: true,
                choices: [{ content: expectedContent }],
            });
        });

        it("2.2 DeepseekText应成功完成指令", async () => {
            const { result, modelId } = await instructFn("Instruct_DeepseekText", "def hello():");
            const expectedContent = LaMManagerMockTool.buildMockResponseText(modelId!);

            expect(modelId).toBe("deepseek-chat");
            expect(result.completed).toEqual({
                vaild: true,
                choices: [{ content: expectedContent }],
            });
        });

        it("2.3 DeepseekPrefix应成功完成前缀续写", async () => {
            const { result, modelId } = await instructFn("Instruct_DeepseekPrefix", "请续写", {
                prefix: "function test() {"
            });
            const expectedContent = LaMManagerMockTool.buildMockResponseText(modelId!);

            expect(modelId).toBe("deepseek-chat");
            expect(result.completed).toEqual({
                vaild: true,
                choices: [{ content: expectedContent }],
            });
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
