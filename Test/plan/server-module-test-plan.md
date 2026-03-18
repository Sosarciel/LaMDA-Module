# Server 模块测试计划

## 测试目标

基于 `server/plan/module-split-plan.md` 的模块拆分计划，制定详细的测试策略，确保拆分前后功能正确性。

## 测试策略

### 总体策略
1. **拆分前测试**：在拆分前编写测试，确保现有功能正确
2. **拆分中测试**：拆分过程中持续测试，确保功能不变
3. **拆分后测试**：拆分后验证模块独立性

### 测试优先级
1. **高优先级**：即将拆分的模块（PermissionManager、CmdParser）
2. **中优先级**：后续拆分的模块（TTSManager、TranslationManager）
3. **低优先级**：不拆分的模块

## 模块测试计划

### 1. PermissionManager 测试

**测试文件**: `Test/src/Server/permission-manager.test.ts`

**测试用例**:

#### 1.1 权限节点匹配测试
```typescript
describe("权限节点匹配", () => {
    test("应正确匹配精确节点", async () => {
        const pm = createPM({
            define: { admin: { segment: [{ node: "admin.delete", weight: 10 }] } }
        });
        expect(await pm.check({ roleset: "admin", node: "admin.delete" })).toBe(true);
    });

    test("应正确匹配通配符节点", async () => {
        const pm = createPM({
            define: { admin: { segment: [{ node: "admin.*", weight: 10 }] } }
        });
        expect(await pm.check({ roleset: "admin", node: "admin.delete" })).toBe(true);
        expect(await pm.check({ roleset: "admin", node: "admin.create" })).toBe(true);
    });

    test("应正确匹配多级通配符", async () => {
        const pm = createPM({
            define: { super: { segment: [{ node: "**", weight: 100 }] } }
        });
        expect(await pm.check({ roleset: "super", node: "any.node.here" })).toBe(true);
    });

    test("应不匹配不相关的节点", async () => {
        const pm = createPM({
            define: { admin: { segment: [{ node: "admin.*", weight: 10 }] } }
        });
        expect(await pm.check({ roleset: "admin", node: "user.delete" })).toBe(false);
    });
});
```

#### 1.2 权重计算测试
```typescript
describe("权重计算", () => {
    test("应正确计算正权重", async () => {
        const pm = createPM({
            define: { role: { segment: [{ node: "test", weight: 10 }] } }
        });
        expect(await pm.check({ roleset: "role", node: "test" })).toBe(true);
    });

    test("应正确计算负权重", async () => {
        const pm = createPM({
            define: { role: { segment: [{ node: "test", weight: -10 }] } }
        });
        expect(await pm.check({ roleset: "role", node: "test" })).toBe(false);
    });

    test("应正确计算混合权重", async () => {
        const pm = createPM({
            define: {
                pos: { segment: [{ node: "test", weight: 10 }] },
                neg: { segment: [{ node: "test", weight: -5 }] }
            }
        });
        expect(await pm.check({ roleset: ["pos", "neg"], node: "test" })).toBe(true);
    });

    test("应正确处理权重阈值", async () => {
        const pm = createPM({
            define: { role: { segment: [{ node: "test", weight: 5 }] } }
        });
        expect(await pm.check({ roleset: "role", node: "test", threshold: 10 })).toBe(false);
    });
});
```

#### 1.3 权限继承测试
```typescript
describe("权限继承", () => {
    test("应正确继承权限", async () => {
        const pm = createPM({
            define: { base: { segment: [{ node: "base.*", weight: 5 }] } },
            role: { derived: { inherit: ["base"], segment: [{ node: "derived.*", weight: 10 }] } }
        });
        expect(await pm.check({ roleset: "derived", node: "base.action" })).toBe(true);
        expect(await pm.check({ roleset: "derived", node: "derived.action" })).toBe(true);
    });

    test("应正确处理多层继承", async () => {
        const pm = createPM({
            define: {
                level1: { segment: [{ node: "level1.*", weight: 5 }] },
                level2: { inherit: ["level1"], segment: [{ node: "level2.*", weight: 10 }] }
            },
            role: { level3: { inherit: ["level2"], segment: [{ node: "level3.*", weight: 15 }] } }
        });
        expect(await pm.check({ roleset: "level3", node: "level1.action" })).toBe(true);
        expect(await pm.check({ roleset: "level3", node: "level2.action" })).toBe(true);
        expect(await pm.check({ roleset: "level3", node: "level3.action" })).toBe(true);
    });
});
```

#### 1.4 循环继承检测测试
```typescript
describe("循环继承检测", () => {
    test("应检测并处理循环继承", async () => {
        const pm = createPM({
            define: {
                a: { inherit: ["b"] },
                b: { inherit: ["a"] }
            }
        });
        // 不应该无限循环
        const result = await pm.check({ roleset: "a", node: "test" });
        expect(result).toBe(false);
    });

    test("应处理自引用", async () => {
        const pm = createPM({
            define: { a: { inherit: ["a"] } }
        });
        const result = await pm.check({ roleset: "a", node: "test" });
        expect(result).toBe(false);
    });
});
```

#### 1.5 角色集过滤测试
```typescript
describe("角色集过滤", () => {
    test("应正确处理单个角色", async () => {
        const pm = createPM({
            define: { role: { segment: [{ node: "test", weight: 10 }] } }
        });
        expect(await pm.check({ roleset: "role", node: "test" })).toBe(true);
    });

    test("应正确处理多个角色", async () => {
        const pm = createPM({
            define: {
                role1: { segment: [{ node: "test", weight: 5 }] },
                role2: { segment: [{ node: "test", weight: 10 }] }
            }
        });
        expect(await pm.check({ roleset: ["role1", "role2"], node: "test" })).toBe(true);
    });

    test("应正确处理不存在的角色", async () => {
        const pm = createPM({ define: {} });
        expect(await pm.check({ roleset: "nonexistent", node: "test" })).toBe(false);
    });
});
```

---

### 2. CmdParser 测试

**测试文件**: `Test/src/Server/cmd-parser.test.ts`

**测试用例**:

#### 2.1 命令前缀识别测试
```typescript
describe("命令前缀识别", () => {
    test("应识别 cmd: 前缀", () => {
        const cmd = CmdParser.parseCmd("cmd:test;;");
        expect(cmd.command).toBe("test");
    });

    test("应识别 cmd： 前缀（中文冒号）", () => {
        const cmd = CmdParser.parseCmd("cmd：test;;");
        expect(cmd.command).toBe("test");
    });

    test("应忽略前缀前的空白", () => {
        const cmd = CmdParser.parseCmd("   cmd:test;;");
        expect(cmd.command).toBe("test");
    });
});
```

#### 2.2 命令后缀识别测试
```typescript
describe("命令后缀识别", () => {
    test("应识别 ;; 后缀", () => {
        const cmd = CmdParser.parseCmd("cmd:test;;");
        expect(cmd.command).toBe("test");
    });

    test("应识别 ；； 后缀（中文分号）", () => {
        const cmd = CmdParser.parseCmd("cmd:test；；");
        expect(cmd.command).toBe("test");
    });

    test("应处理无后缀的命令", () => {
        const cmd = CmdParser.parseCmd("cmd:test");
        expect(cmd.command).toBe("test");
    });
});
```

#### 2.3 命令分割测试
```typescript
describe("命令分割", () => {
    test("应正确分割简单命令", () => {
        const cmd = CmdParser.parseCmd("cmd:test;;");
        expect(cmd.args).toEqual(["test"]);
    });

    test("应正确分割带参数的命令", () => {
        const cmd = CmdParser.parseCmd("cmd:test arg1 arg2;;");
        expect(cmd.args).toEqual(["test", "arg1", "arg2"]);
    });

    test("应处理多余空格", () => {
        const cmd = CmdParser.parseCmd("cmd:test  arg1   arg2;;");
        expect(cmd.args).toEqual(["test", "arg1", "arg2"]);
    });
});
```

#### 2.4 参数解析测试
```typescript
describe("参数解析", () => {
    test("应解析简单键值对", () => {
        const opt = CmdParser.parseOption('key=value');
        expect(opt.key).toBe("value");
    });

    test("应解析带引号的值", () => {
        const opt = CmdParser.parseOption('key="value with spaces"');
        expect(opt.key).toBe("value with spaces");
    });

    test("应处理转义字符", () => {
        const opt = CmdParser.parseOption('key="value\\"with\\"quotes"');
        expect(opt.key).toBe('value"with"quotes');
    });

    test("应解析多个键值对", () => {
        const opt = CmdParser.parseOption('key1=value1 key2=value2');
        expect(opt.key1).toBe("value1");
        expect(opt.key2).toBe("value2");
    });
});
```

#### 2.5 主参数提取测试
```typescript
describe("主参数提取", () => {
    test("应提取命令前的主参数", () => {
        const cmd = CmdParser.parseCmd("前置参数 cmd:test;;");
        expect(cmd.mainArg).toBe("前置参数");
    });

    test("应提取命令后的主参数", () => {
        const cmd = CmdParser.parseCmd("cmd:test;; 后置参数");
        expect(cmd.mainArg).toBe("后置参数");
    });

    test("应处理无主参数的情况", () => {
        const cmd = CmdParser.parseCmd("cmd:test;;");
        expect(cmd.mainArg).toBe("");
    });
});
```

#### 2.6 完整命令解析测试
```typescript
describe("完整命令解析", () => {
    test("应解析完整的命令对象", () => {
        const cmd = CmdParser.parseCmd("前置 cmd:test arg1 arg2;; 后置");
        expect(cmd.command).toBe("test");
        expect(cmd.args).toEqual(["test", "arg1", "arg2"]);
        expect(cmd.rawArg).toBe("arg1 arg2");
        expect(cmd.mainArg).toBe("前置 后置");
    });

    test("应处理缺省命令（sendmessage）", () => {
        const cmd = CmdParser.parseCmd("普通消息");
        expect(cmd.command).toBe("sendmessage");
        expect(cmd.mainArg).toBe("普通消息");
    });
});
```

---

### 3. TTSManager 测试

**测试文件**: `Test/src/Server/tts-manager.test.ts`

**测试用例**:

#### 3.1 TTS 实例创建测试
```typescript
describe("TTS 实例创建", () => {
    test("应成功创建 TTS 实例", async () => {
        // Mock 配置文件
        const mockConfig = {
            instance_table: {
                test_tts: {
                    type: "MoeGoeVITS",
                    config: { /* mock config */ }
                }
            }
        };
        
        const ttsManager = new TTSManager(mockConfig);
        await ttsManager.inited;
        expect(ttsManager.sm).toBeDefined();
    });
});
```

#### 3.2 TTS 功能测试（需要 Mock）
```typescript
describe("TTS 功能", () => {
    test("应成功调用 TTS", async () => {
        // Mock TTS 实例
        const mockTTS = {
            tts: jest.fn().mockResolvedValue("/path/to/output.wav")
        };
        
        const ttsManager = createMockTTSManager(mockTTS);
        const result = await ttsManager.tts("test_instance", {
            text: "测试文本",
            outPath: "/output/test.wav"
        });
        
        expect(result).toBe("/output/test.wav");
    });
});
```

---

### 4. TranslationManager 测试

**测试文件**: `Test/src/Server/translation-manager.test.ts`

**测试用例**:

#### 4.1 翻译实例创建测试
```typescript
describe("翻译实例创建", () => {
    test("应成功创建翻译实例", async () => {
        const mockConfig = {
            instance_table: {
                baidu: {
                    type: "Baidu",
                    config: { appid: "test", key: "test" }
                }
            }
        };
        
        const transManager = new TranslationManager(mockConfig);
        await transManager.inited;
        expect(transManager.sm).toBeDefined();
    });
});
```

#### 4.2 翻译功能测试（需要 Mock）
```typescript
describe("翻译功能", () => {
    test("应成功翻译文本", async () => {
        const mockTranslator = {
            translate: jest.fn().mockResolvedValue("翻译结果")
        };
        
        const transManager = createMockTranslationManager(mockTranslator);
        const result = await transManager.translate("test_instance", {
            text: "test",
            from: "en",
            to: "zh"
        });
        
        expect(result).toBe("翻译结果");
    });
});
```

---

### 5. TextProcesser 测试

**测试文件**: `Test/src/Server/text-processer.test.ts`

**测试用例**:

#### 5.1 Markdown 格式修正测试
```typescript
describe("Markdown 格式修正", () => {
    test("应修正不成对的星号", () => {
        const text = "这是一个*测试文本";
        const fixed = TextProcesser.fixMarkdown(text);
        expect(fixed).toBe("这是一个*测试文本*");
    });

    test("应修正动作格式", () => {
        const text = "*动作*文本*动作*";
        const fixed = TextProcesser.fixMarkdown(text);
        expect(fixed).toContain("*动作*");
    });

    test("应处理转义星号", () => {
        const text = "计算 2\\*3 的结果";
        const fixed = TextProcesser.fixMarkdown(text);
        expect(fixed).toBe("计算 2\\*3 的结果");
    });
});
```

#### 5.2 文本清理测试
```typescript
describe("文本清理", () => {
    test("应移除 think 标签", () => {
        const text = "正常文本<think hidden content</think >其他文本";
        const cleaned = TextProcesser.clearFormat(text);
        expect(cleaned).toBe("正常文本其他文本");
    });

    test("应移除角色输出格式", () => {
        const text = "ASSISTANT: 这是回复";
        const cleaned = TextProcesser.clearFormat(text);
        expect(cleaned).toBe("这是回复");
    });
});
```

---

## 测试文件结构

```
Test/
  src/
    Server/
      permission-manager.test.ts  # 权限管理器测试
      cmd-parser.test.ts          # 命令解析器测试
      tts-manager.test.ts         # TTS 管理器测试
      translation-manager.test.ts # 翻译管理器测试
      text-processer.test.ts      # 文本处理器测试
```

## 测试工具

- **Jest**: 测试框架
- **Mock 函数**: 模拟外部依赖
- **TypeScript**: 类型安全

## 测试执行

```bash
# 运行所有测试
npm run test

# 运行特定模块测试
npx jest src/Server/permission-manager.test.ts
npx jest src/Server/cmd-parser.test.ts
```

## 测试覆盖率目标

- PermissionManager: 90%+
- CmdParser: 95%+
- TTSManager: 80%+
- TranslationManager: 80%+
- TextProcesser: 85%+

## 测试时间表

### 阶段1：高优先级模块（1周）
- 第1-3天：编写 PermissionManager 测试
- 第4-5天：编写 CmdParser 测试

### 阶段2：中优先级模块（1周）
- 第6-7天：编写 TTSManager 测试
- 第8-10天：编写 TranslationManager 测试

### 阶段3：低优先级模块（可选）
- 第11-15天：编写 TextProcesser 测试

## 注意事项

1. **Mock 外部依赖**：所有测试应 Mock 外部依赖，确保测试独立性
2. **测试边界情况**：不仅要测试正常流程，还要测试异常情况
3. **保持测试简单**：每个测试用例应只测试一个功能点
4. **及时更新测试**：代码修改后应及时更新相关测试
