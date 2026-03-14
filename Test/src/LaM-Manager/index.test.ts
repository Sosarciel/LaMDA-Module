import { CredManager, LaMManager } from "@sosraciel-lamda/lam-manager";
import { LaMManagerMockTool } from "@sosraciel-lamda/lam-manager/mock";
import { UtilFT } from "@zwa73/utils";
import path from 'pathe';
import { CACHE_PATH } from "@/src/Constant";

beforeAll(async ()=>{
    const LaMServiceTablePath = path.join(CACHE_PATH,'LaMManager.json');
    const CredServiceTablePath = path.join(CACHE_PATH,'CredManager.json');
    const CredCategoryTablePath = path.join(CACHE_PATH,'CredCategory.json');

    await UtilFT.writeJSONFile(LaMServiceTablePath,LaMManagerMockTool.MOCK_LAM_SERVICE_TABLE);
    await UtilFT.writeJSONFile(CredServiceTablePath,LaMManagerMockTool.MOCK_CRED_SERVICE_TABLE);
    await UtilFT.writeJSONFile(CredCategoryTablePath,LaMManagerMockTool.MOCK_CRED_CATEGORY_TABLE);

    LaMManager.initInject({
        serviceTable :LaMServiceTablePath,
    });
    CredManager.initInject({
        serviceTable :CredServiceTablePath,
        categoryTable:CredCategoryTablePath,
    });
})

describe("LaMService", () => {
    describe("ChatTask", () => {
        const chatFn = async (instanceName:string,message:string) => {
            return LaMManager.chat.execute(instanceName,{
                target:LaMManagerMockTool.MOCK_CHAR,
                messages:[{
                    content:message,
                    type:'chat',
                    senderName:LaMManagerMockTool.MOCK_USER,
                }],
                log_level:"debug",
                n:1,
                max_tokens:100,
                stop:["\n"],
            });
        }
        it("尝试与 GPT35Chat 对话", async () => {
            const result = await chatFn("GPT35Chat","你好");
            expect(result.completed?.choices?.[0].content).toBe(LaMManagerMockTool.buildResp('GPT35Chat', "你好"));
        });
        it("尝试与 GPT35Text 对话", async () => {
            const result = await chatFn("GPT35Text","你好");
            expect(result.completed?.choices?.[0].content).toBe(LaMManagerMockTool.buildResp('GPT35Text', "你好"));
        });
        it("尝试与 DeepseekChat 对话", async () => {
            const result = await chatFn("DeepseekChat","你好");
            expect(result.completed?.choices?.[0].content).toBe(LaMManagerMockTool.buildResp('DeepseekChat', "你好"));
        });
        it("尝试与 Gemini3Pro 对话", async () => {
            const result = await chatFn("Gemini3Pro","你好");
            expect(result.completed?.choices?.[0].content).toBe(LaMManagerMockTool.buildResp('Gemini3Pro', "你好"));
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
        }
        it("尝试使用 OpenAIInstruct 生成文本", async () => {
            const prompt = "写一个简短的介绍，介绍人工智能的发展历史";
            const result = await instructFn("OpenAIInstruct", prompt);
            expect(result.completed?.choices?.[0].content).toBe(LaMManagerMockTool.buildResp('OpenAIInstruct', prompt));
        });
        it("尝试使用 DeepseekFIM 进行代码补全", async () => {
            const prompt = "def factorial(n):";
            const suffix = "    return result";
            const prefix = "    if n <= 1:\n        return 1\n    result = 1\n    for i in range(2, n+1):";
            const result = await instructFn("DeepseekFIM", prompt, { suffix, prefix });
            // DeepseekFIM 会将 prefix 合并到 prompt 中
            const expectedPrompt = `${prompt}${prefix}`;
            expect(result.completed?.choices?.[0].content).toBe(LaMManagerMockTool.buildResp('OpenAIInstruct', expectedPrompt));
        });
        it("尝试使用 DeepseekPrefixCompletion 进行前缀续写", async () => {
            const prompt = "请续写以下代码";
            const prefix = "function calculateSum(a, b) {";
            const result = await instructFn("DeepseekPrefixCompletion", prompt, { prefix });
            // DeepseekPrefixCompletion 使用 chat 端点，所以返回 DeepseekChat 的响应
            expect(result.completed?.choices?.[0].content).toBe(LaMManagerMockTool.buildResp('DeepseekChat', prompt));
        });
    });
});
