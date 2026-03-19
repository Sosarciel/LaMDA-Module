import { CharProfile, CharAccesser, CharConstant } from "@sosraciel-lamda/charprofile-domain";
import type { CharOption } from "@sosraciel-lamda/charprofile-domain";
import path from "pathe";

/**mock角色数据路径 */
const MOCK_DATA_PATH = path.resolve(__dirname, "../../CharProfile-Domain/data/mock");

/**创建测试角色选项 */
const createTestCharOption = (charId: string): CharOption => ({
    dataPath: MOCK_DATA_PATH,
    charId
});

describe("CharProfile-Domain 模块测试", () => {
    describe("CharAccesser 测试", () => {
        test("1. 应成功检查角色是否存在", async () => {
            const exists = await CharAccesser.check(createTestCharOption("MockChar1"));
            expect(exists).toBe(true);
        });

        test("2. 应正确返回不存在角色", async () => {
            const exists = await CharAccesser.check(createTestCharOption("NonExistentChar"));
            expect(exists).toBe(false);
        });

        test("3. 应成功创建CharAccesser实例", async () => {
            const accesser = await CharAccesser.create(createTestCharOption("MockChar1"));
            expect(accesser).toBeDefined();
        });

        test("4. 应成功加载角色配置", async () => {
            const accesser = await CharAccesser.create(createTestCharOption("MockChar1"));
            const config = await accesser.loadChar();
            expect(config).toBeDefined();
            expect(config.getCharId()).toBe("MockChar1");
            expect(config.getCharDisplayName()).toBe("MockChar1");
        });
    });

    describe("CharConfig 测试", () => {
        test("5. 应正确获取角色基本信息", async () => {
            const accesser = await CharAccesser.create(createTestCharOption("MockChar1"));
            const config = await accesser.loadChar();

            expect(config.getCharId()).toBe("MockChar1");
            expect(config.getCharDisplayName()).toBe("MockChar1");
            expect(config.getDefaultUserName()).toBe("TestUser");
            expect(config.getDefineUserName()).toBe(CharConstant.DEFINE_USER_STR);
        });

        test("6. 应正确获取角色LaM实例名", async () => {
            const accesser = await CharAccesser.create(createTestCharOption("MockChar1"));
            const config = await accesser.loadChar();

            expect(config.getLaMInstanceName()).toBe("default");
        });

        test("7. 应正确判断是否有语音功能", async () => {
            const accesser1 = await CharAccesser.create(createTestCharOption("MockChar1"));
            const config1 = await accesser1.loadChar();
            expect(config1.hasVoice()).toBe(false);

            const accesser2 = await CharAccesser.create(createTestCharOption("MockChar2"));
            const config2 = await accesser2.loadChar();
            expect(config2.hasVoice()).toBe(true);
        });

        test("8. 应正确获取TTS配置", async () => {
            const accesser = await CharAccesser.create(createTestCharOption("MockChar2"));
            const config = await accesser.loadChar();

            expect(config.getTTSInstanceName()).toBe("test-tts");
            expect(config.getTTSOption()).toEqual({ speaker_id: "MockChar2" });
        });

        test("9. 应正确获取状态回复", async () => {
            const accesser = await CharAccesser.create(createTestCharOption("MockChar1"));
            const config = await accesser.loadChar();

            expect(config.getStatusReply("未启动")).toBe("*MockChar1正在休眠*");
            expect(config.getStatusReply("错误")).toBe("*MockChar1发生了错误*");
            expect(config.getStatusReply("未知状态")).toBeUndefined();
        });

        test("10. 应正确进行术语替换", async () => {
            const accesser = await CharAccesser.create(createTestCharOption("MockChar1"));
            const config = await accesser.loadChar();

            const result = config.transReplace("Hello MockChar1!");
            expect(result).toBe("Hello モックキャラ1!");
        });

        test("11. 应正确进行翻译后替换", async () => {
            const accesser = await CharAccesser.create(createTestCharOption("MockChar2"));
            const config = await accesser.loadChar();

            const result = config.transAfterReplace("Hello Mock2!");
            expect(result).toBe("Hello MockChar2!");
        });

        test("12. 应正确获取logit bias", async () => {
            const accesser = await CharAccesser.create(createTestCharOption("MockChar1"));
            const config = await accesser.loadChar();

            const logitBias = config.getLogitBias();
            expect(Array.isArray(logitBias)).toBe(true);
            expect(logitBias.length).toBe(2);
            expect(logitBias[0]).toEqual(CharConstant.DEFAULT_LOGIT_BIAS);
            expect(logitBias[1]).toEqual({ MockChar1: 1 });
        });

        test("13. 应正确获取场景", async () => {
            const accesser = await CharAccesser.create(createTestCharOption("MockChar1"));
            const config = await accesser.loadChar();

            const defaultScene = config.getScene("default");
            expect(defaultScene).toBeDefined();
            expect(defaultScene.name).toBe("default");
            expect(defaultScene.dialog).toBeDefined();
            expect(Array.isArray(defaultScene.dialog)).toBe(true);
            expect(defaultScene.dialog.length).toBeGreaterThan(0);
        });

        test("14. 应正确获取定义场景", async () => {
            const accesser = await CharAccesser.create(createTestCharOption("MockChar1"));
            const config = await accesser.loadChar();

            const define = config.getDefine();
            expect(define).toBeDefined();
            expect(define.define).toContain("Test AI");
            expect(define.memory).toBeDefined();
            expect(Array.isArray(define.memory)).toBe(true);
        });
    });

    describe("CharProfile 测试", () => {
        test("15. 应成功初始化CharProfile并获取角色助手", async () => {
            CharProfile.initInject({ dataPath: MOCK_DATA_PATH });
            const charHelper = await CharProfile.getCharHelper("MockChar1");
            expect(charHelper).toBeDefined();
            expect(charHelper?.getCharId()).toBe("MockChar1");
        });

        test("16. 应正确返回不存在角色", async () => {
            CharProfile.initInject({ dataPath: MOCK_DATA_PATH });
            const charHelper = await CharProfile.getCharHelper("NonExistentChar");
            expect(charHelper).toBeUndefined();
        });

        test("17. 应成功重载角色配置", async () => {
            CharProfile.initInject({ dataPath: MOCK_DATA_PATH });
            const charHelper = await CharProfile.getCharHelper("MockChar1");
            expect(charHelper).toBeDefined();

            const reloadedConfig = await charHelper?.reloadChar();
            expect(reloadedConfig).toBeDefined();
            expect(reloadedConfig?.getCharId()).toBe("MockChar1");
        });
    });

    describe("CharConstant 测试", () => {
        test("18. 应正确定义常量", () => {
            expect(CharConstant.AUDIO_EXT).toBe(".flac");
            expect(CharConstant.CONFIG_EXT).toBe(".json");
            expect(CharConstant.DEFINE_EXT).toBe(".hbs");
            expect(CharConstant.DEFINE_USER_STR).toBe("Individual");
            expect(CharConstant.DEFAULT_LOGIT_BIAS).toBeDefined();
            expect(CharConstant.DEFAULT_LOGIT_BIAS["Individual"]).toBe(-10);
        });
    });
});
