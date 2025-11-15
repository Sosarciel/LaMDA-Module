import { CredManager, LaMManager } from "@sosraciel-lamda/lam-manager";
import { LaMManagerMock } from "@sosraciel-lamda/lam-manager/mock";
import path from 'pathe';

beforeAll(()=>{
    LaMManager.initInject({
        tablePath:path.join(LaMManagerMock.MOCK_PATH,'LaMService.json'),
    });
    CredManager.initInject({
        tablePath        :path.join(LaMManagerMock.MOCK_PATH,'CredService.json'),
        categoryTablePath:path.join(LaMManagerMock.MOCK_PATH,'CredCategory.json'),
    });
})

describe("LaMService", () => {
    describe("ChatTask", () => {
        const chatFn = async (instanceName:string,message:string) => {
            return LaMManager.chat.execute(instanceName,{
                target:LaMManagerMock.MOCK_CHAR,
                messages:{list:[{
                    content:message,
                    type:'chat',
                    senderName:LaMManagerMock.MOCK_USER,
                }]},
                log_level:"debug",
                n:1,
                max_tokens:100,
                stop:["\n"],
            });
        }
        it("尝试与 GPT35Chat 对话", async () => {
            const result = await chatFn("GPT35Chat","你好");
            expect(result.completed?.choices?.[0].content).toBe(LaMManagerMock.buildResp('GPT35Chat', "你好"));
        });
        it("尝试与 GPT35Text 对话", async () => {
            const result = await chatFn("GPT35Text","你好");
            expect(result.completed?.choices?.[0].content).toBe(LaMManagerMock.buildResp('GPT35Text', "你好"));
        });
        it("尝试与 DeepseekChat 对话", async () => {
            const result = await chatFn("DeepseekChat","你好");
            expect(result.completed?.choices?.[0].content).toBe(LaMManagerMock.buildResp('DeepseekChat', "你好"));
        });
    });
});