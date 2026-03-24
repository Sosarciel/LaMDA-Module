---
aliases: [TTS-Manager 与 Translation-Manager 测试计划]
---
# TTS-Manager 与 Translation-Manager 测试计划

## 模块分析

### TTSManager

**架构**:
```
ServiceManager → MoeGoeVITS → VITSWorker → child_process
```

**核心接口**:
```typescript
interface TTSInterface {
    tts(opt: TTSOptions): MPromise<string | undefined>;
}

type TTSOptions = {
    text: string;        // 待TTS的文本
    outPath: string;     // 输出路径
    speakerId: string;   // 讲述者ID
};
```

**外部依赖**:
- MoeGoe.exe 可执行程序
- 模型文件 (.pth)
- 配置文件 (.cfg)
- ffmpeg (音频转换)

**测试挑战**:
- 依赖外部可执行程序和模型文件
- 子进程管理复杂
- 音频文件输出验证困难

### TranslationManager

**架构**:
```
ServiceManager → BaiduTranslation / GoogleUnofficialTranslation
```

**核心接口**:
```typescript
interface TranslationInterface {
    translate(param: TranslateOption): MPromise<string | undefined>;
}

type TranslateOption = {
    text: string;              // 翻译文本
    to: TranslationLanguage;   // 目标语言
    from?: TranslationLanguage;// 源语言
};
```

**外部依赖**:
- 百度翻译API (appid + secret)
- Google翻译API (非官方)
- 网络代理 (可选)

**测试挑战**:
- 需要真实的API凭证
- 网络请求依赖
- API调用可能产生费用

## 测试方案：分层组合策略

### 第一层：Manager层单元测试（Mock方案）

**测试目标**: ServiceManager的服务管理逻辑

**优点**:
- 测试速度快，无网络/IO依赖
- 测试环境简单，易于CI/CD集成
- 可精确控制测试场景和边界条件

### 第二层：Worker层集成测试（本地模拟方案）

**测试目标**: 进程管理和任务队列

**优点**:
- 更接近真实环境
- 可测试完整的请求流程
- 不依赖外部网络和真实凭证

### 第三层：Translation层协议测试（接口隔离方案）

**测试目标**: HTTP请求构建和响应解析

**优点**:
- 职责清晰，测试粒度合理
- 可针对不同层次进行测试
- 平衡了测试覆盖率和实现成本

### 第四层：端到端测试（可选，真实环境）

**测试目标**: 完整流程验证

**说明**: 仅在特定环境运行，需要真实凭证

## Mock实现设计

### MockTTS

```typescript
/**Mock TTS实现 */
export class MockTTS implements TTSInterface {
    private shouldFail = false;
    private delay = 0;

    async tts(opt: TTSOptions): Promise<string | undefined> {
        if (this.delay > 0) {
            await new Promise(resolve => setTimeout(resolve, this.delay));
        }

        if (this.shouldFail) {
            return undefined;
        }

        // 创建假的FLAC文件
        await fs.promises.writeFile(opt.outPath, 'MOCK_AUDIO_DATA');
        return opt.outPath;
    }

    isRuning = () => true;
    getData = () => ({ mock: true });

    /**设置失败模式 */
    setFailMode(fail: boolean): void {
        this.shouldFail = fail;
    }

    /**设置延迟 */
    setDelay(ms: number): void {
        this.delay = ms;
    }
}
```

### MockTranslation

```typescript
/**Mock Translation实现 */
export class MockTranslation implements TranslationInterface {
    private translations: Map<string, string> = new Map();
    private shouldFail = false;

    async translate(param: TranslateOption): Promise<string | undefined> {
        if (this.shouldFail) {
            return undefined;
        }

        // 返回预设的翻译结果
        const key = `${param.from || 'auto'}-${param.to}:${param.text}`;
        return this.translations.get(key) || `[MOCK:${param.to}]${param.text}`;
    }

    isRuning = () => true;
    getData = () => ({ mock: true });

    /**预设翻译结果 */
    setTranslation(from: string, to: string, text: string, result: string): void {
        const key = `${from}-${to}:${text}`;
        this.translations.set(key, result);
    }

    /**设置失败模式 */
    setFailMode(fail: boolean): void {
        this.shouldFail = fail;
    }
}
```

## 测试用例设计

### TTSManager测试用例

| 测试场景 | 测试类型 | 测试内容 | 优先级 |
|---------|---------|---------|--------|
| 服务初始化 | 单元测试 | 验证配置加载、实例创建 | 高 |
| 实例路由 | 单元测试 | 验证多实例选择逻辑 | 高 |
| TTS调用 | 单元测试 | 验证tts方法正确调用 | 高 |
| 错误处理 | 单元测试 | 验证异常情况处理 | 高 |
| 资源限制 | 单元测试 | 验证max_resource限制 | 中 |
| 并发处理 | 集成测试 | 验证并发任务处理 | 中 |
| 输出验证 | 集成测试 | 验证音频文件生成 | 中 |

### TranslationManager测试用例

| 测试场景 | 测试类型 | 测试内容 | 优先级 |
|---------|---------|---------|--------|
| 服务初始化 | 单元测试 | 验证配置加载 | 高 |
| 翻译调用 | 单元测试 | 验证translate方法正确调用 | 高 |
| 自动翻译 | 单元测试 | 验证autoTranslate逻辑 | 高 |
| 错误处理 | 单元测试 | 验证异常情况处理 | 高 |
| 语言映射 | 单元测试 | 验证语言代码转换 | 中 |
| 签名算法 | 单元测试 | 验证百度签名生成 | 中 |
| 超时处理 | 集成测试 | 验证请求超时机制 | 中 |

## 测试文件结构

```
Test/
  src/
    TTS-Manager/
      mock/
        MockTTS.ts           # Mock TTS实现
        MockData.ts          # 测试数据
      manager.test.ts        # Manager层测试
      interface.test.ts      # 接口测试
    Translation-Manager/
      mock/
        MockTranslation.ts   # Mock Translation实现
        MockData.ts          # 测试数据
      manager.test.ts        # Manager层测试
      baidu.test.ts          # 百度翻译协议测试
      google.test.ts         # Google翻译协议测试
```

## 测试代码示例

### TTSManager测试

```typescript
import { TTSManager } from "@sosraciel-lamda/tts-manager";
import { MockTTS } from "./mock/MockTTS";
import path from 'pathe';
import { CACHE_PATH } from "@/src/Constant";

const mockTTS = new MockTTS();

// Mock服务配置
const MOCK_TTS_SERVICE_TABLE = {
    instance_table: {
        MockTTS: {
            name: "MockTTS",
            type: "Mock",
            data: {}
        }
    }
};

beforeAll(async () => {
    const serviceTablePath = path.join(CACHE_PATH, 'TTSManager.json');
    await UtilFT.writeJSONFile(serviceTablePath, MOCK_TTS_SERVICE_TABLE);

    TTSManager.initInject({
        serviceTable: serviceTablePath
    });
});

describe("TTS-Manager", () => {
    describe("服务管理", () => {
        it("应正确初始化服务实例", async () => {
            // 测试服务创建
        });

        it("应正确处理实例不存在的情况", async () => {
            await expect(TTSManager.tts("NonExistent", {
                text: "测试",
                outPath: "/tmp/test.flac",
                speakerId: "0"
            })).rejects.toThrow();
        });
    });

    describe("TTS功能", () => {
        it("应成功生成音频文件", async () => {
            const result = await TTSManager.tts("MockTTS", {
                text: "你好世界",
                outPath: path.join(CACHE_PATH, "test.flac"),
                speakerId: "0"
            });

            expect(result).toBeDefined();
            expect(await UtilFT.pathExists(result!)).toBe(true);
        });

        it("应正确处理失败情况", async () => {
            mockTTS.setFailMode(true);

            const result = await TTSManager.tts("MockTTS", {
                text: "测试失败",
                outPath: path.join(CACHE_PATH, "fail.flac"),
                speakerId: "0"
            });

            expect(result).toBeUndefined();
        });
    });
});
```

### TranslationManager测试

```typescript
import { TranslationManager } from "@sosraciel-lamda/translation-manager";
import { MockTranslation } from "./mock/MockTranslation";
import path from 'pathe';
import { CACHE_PATH } from "@/src/Constant";

const mockTranslation = new MockTranslation();

// Mock服务配置
const MOCK_TRANS_SERVICE_TABLE = {
    instance_table: {
        MockTrans: {
            name: "MockTrans",
            type: "Mock",
            data: {}
        }
    }
};

beforeAll(async () => {
    const serviceTablePath = path.join(CACHE_PATH, 'TranslationManager.json');
    await UtilFT.writeJSONFile(serviceTablePath, MOCK_TRANS_SERVICE_TABLE);

    TranslationManager.initInject({
        serviceTable: serviceTablePath
    });

    // 预设翻译结果
    mockTranslation.setTranslation('zh-CN', 'ja', '你好', 'こんにちは');
    mockTranslation.setTranslation('zh-CN', 'en', '你好', 'Hello');
});

describe("Translation-Manager", () => {
    describe("服务管理", () => {
        it("应正确初始化服务实例", async () => {
            // 测试服务创建
        });
    });

    describe("翻译功能", () => {
        it("应成功翻译文本", async () => {
            const result = await TranslationManager.translate("MockTrans", {
                text: "你好",
                to: "ja"
            });

            expect(result).toBe("こんにちは");
        });

        it("应正确处理未知文本", async () => {
            const result = await TranslationManager.translate("MockTrans", {
                text: "未知文本",
                to: "en"
            });

            expect(result).toContain("[MOCK:en]");
        });

        it("应正确处理失败情况", async () => {
            mockTranslation.setFailMode(true);

            const result = await TranslationManager.translate("MockTrans", {
                text: "测试失败",
                to: "ja"
            });

            expect(result).toBeUndefined();
        });
    });
});
```

## 百度翻译签名测试

```typescript
import md5 from "md5";

describe("BaiduTranslation签名", () => {
    it("应正确生成MD5签名", () => {
        const appid = "test_appid";
        const text = "你好";
        const salt = "12345";
        const secret = "test_secret";

        const sign = md5(appid + text + salt + secret);

        expect(sign).toMatch(/^[a-f0-9]{32}$/);
    });

    it("签名应与预期一致", () => {
        // 使用已知输入输出验证签名算法
        const appid = "2021030100";
        const text = "test";
        const salt = "1";
        const secret = "secret123";

        const sign = md5(appid + text + salt + secret);

        // 验证签名格式正确
        expect(sign.length).toBe(32);
    });
});
```

## 测试执行策略

### 开发阶段
```
1. 运行单元测试（Mock方案）- 快速反馈
2. 运行集成测试（本地模拟）- 验证核心逻辑
```

### CI/CD阶段
```
1. 运行所有单元测试
2. 运行集成测试（不依赖外部服务）
3. 可选：运行E2E测试（需要配置真实凭证）
```

### 发布前验证
```
1. 运行完整测试套件
2. 手动验证关键功能
3. 检查测试覆盖率报告
```

## 测试覆盖率目标

| 层次 | 目标覆盖率 | 说明 |
|-----|-----------|------|
| Manager层 | 90%+ | 核心业务逻辑 |
| Translation层 | 85%+ | 协议处理逻辑 |
| TTS层 | 80%+ | 进程管理逻辑 |
| 整体 | 80%+ | 综合覆盖率 |

## 验收标准

- [ ] MockTTS实现完成
- [ ] MockTranslation实现完成
- [ ] TTSManager单元测试通过
- [ ] TranslationManager单元测试通过
- [ ] 百度翻译签名测试通过
- [ ] 错误处理测试通过
- [ ] 测试覆盖率达到80%+
- [ ] TypeScript类型检查通过
- [ ] ESLint检查通过

## 注意事项

1. **避免真实API调用**: 所有测试应使用Mock，避免产生费用和网络依赖
2. **测试隔离**: 每个测试用例独立运行，不依赖执行顺序
3. **清理测试数据**: 测试后清理生成的临时文件
4. **Mock行为一致性**: 定期检查Mock行为是否与真实服务一致
