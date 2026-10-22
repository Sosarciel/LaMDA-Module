import { CharProfileMockTool } from "@sosraciel-lamda/charprofile-domain/mock";
import { CharProfileDomain, CharAccesser, CharConstant } from "@sosraciel-lamda/charprofile-domain";
import type { CharOption } from "@sosraciel-lamda/charprofile-domain";
import fs from "fs";
import path from "pathe";
import { DATA_PATH } from "@/src/Constant";


//测试侧就地声明 mock 数据里的扩展字段
//印证领域不再认识这些字段, 由接入方通过模块增强自行声明
declare module "@sosraciel-lamda/charprofile-domain" {
    /**角色配置字段表 */
    interface CharConfigFieldTable {
        /**角色对状态的固定反馈 */
        status_reply_table:{[key:string]:string};
        /**音频翻译术语映射表 */
        term_map:{[key:string]:string};
        /**音频翻译术语映射表 翻译后 */
        term_map_after:{[key:string]:string};
        /**逻辑回归偏置 */
        logit_bias_map:{[key:string]:number};
        /**tts实例名 */
        tts_instance_name?:string|null;
        /**tts设置 */
        tts_option?:{speaker_id:string};
        /**语言模型实例名 */
        lam_instance_name:string;
    }
}


/**确保测试数据目录存在并清理旧数据（幂等） */
const ensureTestDataDir = async () => {
    const charDir = path.join(DATA_PATH, "character");
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
    const targetDir = path.join(DATA_PATH, "character", charId);
    
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
    dataPath: DATA_PATH,
    charId
});

describe("CharProfile-Domain 模块测试", () => {
    beforeAll(async () => {
        await prepareAllTestData();
        // 只初始化一次
        CharProfileDomain.initInject({ dataPath: DATA_PATH });
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

        test("6. 应通过 getField 读到扩展字段", async () => {
            const accesser = await CharAccesser.create(createTestCharOption("MockChar1"));
            const config = await accesser.loadChar();

            expect(config.getField("lam_instance_name")).toBe("default");
        });

        test("7. 应通过 getField 读到标准字段", async () => {
            const accesser = await CharAccesser.create(createTestCharOption("MockChar1"));
            const config = await accesser.loadChar();

            expect(config.getField("name")).toBe("MockChar1");
            expect(config.getField("id")).toBe("MockChar1");
            expect(config.getField("default_user_name")).toBe("TestUser");
        });

        test("8. 应正确返回全部字段", async () => {
            const accesser = await CharAccesser.create(createTestCharOption("MockChar2"));
            const config = await accesser.loadChar();

            const fields = config.getFields();
            expect(fields.name).toBe("MockChar2");
            expect(fields.lam_instance_name).toBe("test-lam");
            expect(fields.tts_instance_name).toBe("test-tts");
            expect(fields.tts_option).toEqual({ speaker_id: "MockChar2" });
        });

        test("9. 缺少扩展字段时不应由领域兜底", async () => {
            const accesser = await CharAccesser.create(createTestCharOption("MockChar1"));
            const config = await accesser.loadChar();

            //MockChar1 未配置 tts_*, 领域不再兜底, 应原样为 undefined
            expect(config.getField("tts_instance_name")).toBeUndefined();
            expect(config.getField("tts_option")).toBeUndefined();
        });

        test("10. 应能读到状态反馈表", async () => {
            const accesser = await CharAccesser.create(createTestCharOption("MockChar1"));
            const config = await accesser.loadChar();

            const table = config.getField("status_reply_table");
            expect(table["未启动"]).toBe("*MockChar1正在休眠*");
            expect(table["错误"]).toBe("*MockChar1发生了错误*");
            expect(table["未知状态"]).toBeUndefined();
        });

        test("11. 应能读到翻译术语表", async () => {
            const accesser1 = await CharAccesser.create(createTestCharOption("MockChar1"));
            const config1 = await accesser1.loadChar();
            expect(config1.getField("term_map")).toEqual({ MockChar1: "モックキャラ1" });

            const accesser2 = await CharAccesser.create(createTestCharOption("MockChar2"));
            const config2 = await accesser2.loadChar();
            expect(config2.getField("term_map_after")).toEqual({ Mock2: "MockChar2" });
        });

        test("12. 应能读到logit bias表", async () => {
            const accesser = await CharAccesser.create(createTestCharOption("MockChar1"));
            const config = await accesser.loadChar();

            expect(config.getField("logit_bias_map")).toEqual({ MockChar1: 1 });
        });

        test("13. 应正确获取MockChar1场景", async () => {
            const accesser = await CharAccesser.create(createTestCharOption("MockChar1"));
            const config = await accesser.loadChar();

            const defaultScene = config.getSceneFromTable("default");
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

            const defaultScene = config.getSceneFromTable("default");
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

    describe("CharProfileDomain 测试", () => {
        test("17. 应成功初始化CharProfileDomain并获取角色档案", async () => {
            const charProfile = await CharProfileDomain.getCharProfile("MockChar1");
            expect(charProfile).toBeDefined();
            expect(charProfile?.getCharId()).toBe("MockChar1");
        });

        test("18. 应正确返回不存在角色", async () => {
            const charProfile = await CharProfileDomain.getCharProfile("NonExistentChar");
            expect(charProfile).toBeUndefined();
        });

        test("19. 应成功重载角色配置", async () => {
            const charProfile = await CharProfileDomain.getCharProfile("MockChar1");
            expect(charProfile).toBeDefined();

            const reloadedConfig = await charProfile?.reloadChar();
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
        });
    });
});
