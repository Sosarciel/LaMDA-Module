import { CharProfileMockTool } from "@sosraciel-lamda/charprofile-domain/mock";
import { CharProfile, CharAccesser, CharConstant } from "@sosraciel-lamda/charprofile-domain";
import type { CharOption } from "@sosraciel-lamda/charprofile-domain";
import fs from "fs";
import path from "pathe";

/**测试数据目录 (注意：CharAccesser内部会拼接character，所以这里只需要到data层) */
const TEST_DATA_DIR = path.resolve(__dirname, "../../data");

/**确保测试数据目录存在并清理旧数据（幂等） */
const ensureTestDataDir = async () => {
    const charDir = path.join(TEST_DATA_DIR, "character");
    // 删除旧数据
    if (fs.existsSync(charDir)) {
        await fs.promises.rm(charDir, { recursive: true });
    }
    // 创建目录
    await fs.promises.mkdir(charDir, { recursive: true });
};

/**复制mock角色数据到测试目录 */
const copyMockCharacterData = async (charId: string) => {
    const sourceDir = CharProfileMockTool.getMockCharPath(charId as any);
    const targetDir = path.join(TEST_DATA_DIR, "character", charId);
    
    // 确保目标目录存在
    await fs.promises.mkdir(targetDir, { recursive: true });
    
    // 复制config.json
    const configSource = CharProfileMockTool.getMockCharConfigPath(charId as any);
    const configTarget = path.join(targetDir, "config.json");
    await fs.promises.copyFile(configSource, configTarget);
    
    // 复制define.hbs
    const defineSource = CharProfileMockTool.getMockCharDefinePath(charId as any);
    const defineTarget = path.join(targetDir, "define.hbs");
    await fs.promises.copyFile(defineSource, defineTarget);
    
    // 复制scenes目录
    const scenesSource = CharProfileMockTool.getMockCharScenesPath(charId as any);
    const scenesTarget = path.join(targetDir, "scenes");
    if (fs.existsSync(scenesSource)) {
        await fs.promises.mkdir(scenesTarget, { recursive: true });
        const files = await fs.promises.readdir(scenesSource);
        for (const file of files) {
            await fs.promises.copyFile(
                path.join(scenesSource, file),
                path.join(scenesTarget, file)
            );
        }
    }
};

/**准备所有测试数据 */
const prepareAllTestData = async () => {
    await ensureTestDataDir();
    for (const charId of CharProfileMockTool.MOCK_CHAR_IDS) {
        await copyMockCharacterData(charId);
    }
};

/**创建测试角色选项 */
const createTestCharOption = (charId: string): CharOption => ({
    dataPath: TEST_DATA_DIR,
    charId
});

describe("CharProfile-Domain 模块测试", () => {
    beforeAll(async () => {
        await prepareAllTestData();
        // 只初始化一次
        CharProfile.initInject({ dataPath: TEST_DATA_DIR });
    }, 30000);

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

        test("13. 应正确获取MockChar1场景", async () => {
            const accesser = await CharAccesser.create(createTestCharOption("MockChar1"));
            const config = await accesser.loadChar();

            const defaultScene = config.getScene("default");
            expect(defaultScene.name).toBe("default");
            expect(defaultScene.define).toBe("");
            expect(defaultScene.dialog).toEqual([
                { type: "chat", sender_name: "MockChar1", content: "*greeting*\nHello, I am MockChar1, ready for testing." }
            ]);
            expect(defaultScene.memory).toEqual([]);
        });

        test("14. 应正确获取MockChar1定义场景", async () => {
            const accesser = await CharAccesser.create(createTestCharOption("MockChar1"));
            const config = await accesser.loadChar();

            const define = config.getDefine();
            expect(define.name).toBe("define");
            expect(define.define).toBe(
                "Test AI MockChar1\n" +
                "Age ageless\n" +
                "Eyes blue\n" +
                "Hair black\n" +
                "Skin fair\n" +
                "Height 160cm\n" +
                "Characteristics test AI for unit testing\n"
            );
            expect(define.dialog).toEqual([]);
            expect(define.memory).toEqual([
                { type: "chat", sender_name: "MockChar1", content: "Hello, I am MockChar1." },
                { type: "chat", sender_name: "Individual", content: "Nice to meet you." },
                { type: "chat", sender_name: "MockChar1", content: "I am ready for testing." }
            ]);
        });

        test("15. 应正确获取MockChar2场景", async () => {
            const accesser = await CharAccesser.create(createTestCharOption("MockChar2"));
            const config = await accesser.loadChar();

            const defaultScene = config.getScene("default");
            expect(defaultScene.name).toBe("default");
            expect(defaultScene.define).toBe("");
            expect(defaultScene.dialog).toEqual([
                { type: "chat", sender_name: "MockChar2", content: "*waves hand*\nHi there! I am MockChar2 with TTS support." }
            ]);
            expect(defaultScene.memory).toEqual([]);
        });

        test("16. 应正确获取MockChar2定义场景", async () => {
            const accesser = await CharAccesser.create(createTestCharOption("MockChar2"));
            const config = await accesser.loadChar();

            const define = config.getDefine();
            expect(define.name).toBe("define");
            expect(define.define).toBe(
                "Test AI 2 MockChar2\n" +
                "Age 100\n" +
                "Eyes red\n" +
                "Hair white\n" +
                "Skin pale\n" +
                "Height 150cm\n" +
                "Characteristics second test AI with TTS support\n"
            );
            expect(define.dialog).toEqual([]);
            expect(define.memory).toEqual([
                { type: "chat", sender_name: "MockChar2", content: "I am MockChar2, the second test character." },
                { type: "chat", sender_name: "Individual", content: "What can you do?" },
                { type: "chat", sender_name: "MockChar2", content: "I can test TTS functionality." }
            ]);
        });
    });

    describe("CharProfile 测试", () => {
        test("17. 应成功初始化CharProfile并获取角色助手", async () => {
            const charHelper = await CharProfile.getCharHelper("MockChar1");
            expect(charHelper).toBeDefined();
            expect(charHelper?.getCharId()).toBe("MockChar1");
        });

        test("18. 应正确返回不存在角色", async () => {
            const charHelper = await CharProfile.getCharHelper("NonExistentChar");
            expect(charHelper).toBeUndefined();
        });

        test("19. 应成功重载角色配置", async () => {
            const charHelper = await CharProfile.getCharHelper("MockChar1");
            expect(charHelper).toBeDefined();

            const reloadedConfig = await charHelper?.reloadChar();
            expect(reloadedConfig).toBeDefined();
            expect(reloadedConfig?.getCharId()).toBe("MockChar1");
        });
    });

    describe("CharConstant 测试", () => {
        test("20. 应正确定义常量", () => {
            expect(CharConstant.AUDIO_EXT).toBe(".flac");
            expect(CharConstant.CONFIG_EXT).toBe(".json");
            expect(CharConstant.DEFINE_EXT).toBe(".hbs");
            expect(CharConstant.DEFINE_USER_STR).toBe("Individual");
            expect(CharConstant.DEFAULT_LOGIT_BIAS).toBeDefined();
            expect(CharConstant.DEFAULT_LOGIT_BIAS["Individual"]).toBe(-10);
        });
    });
});
