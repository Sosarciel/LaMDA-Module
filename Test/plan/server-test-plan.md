# Server 主程序测试计划

## 测试目标

测试 `server` 主程序的胶水功能，通过**剥离可独立测试的模块**进行自动化测试，避免在真实生产环境中进行测试。

## 测试策略

由于server是半生产环境，链接真实数据库做小规模实际使用测试，不适合跑自动化测试。因此，本测试计划采用以下策略：

1. **模块剥离测试**：将可独立测试的模块剥离出来，在Test项目中创建对应的测试文件
2. **Mock依赖**：对于依赖外部服务的模块，使用Mock对象替代真实服务
3. **单元测试**：对纯函数和工具类进行单元测试
4. **集成测试**：对模块间的协作进行集成测试（使用Mock数据）

## 可剥离测试的模块

### 1. PermissionManager（权限管理器）

**可测试性**：高 - 纯逻辑，无外部依赖

**测试内容**：
- [ ] 权限节点匹配（patternToRegex, testPattern）
- [ ] 权重计算（calcWeight）
- [ ] 权限继承（flatData）
- [ ] 循环继承检测
- [ ] 权重冲突解决
- [ ] 角色集过滤（filterRoleSet）

**测试方法**：
```typescript
// 创建测试用的权限配置
const testTable = {
    define: {
        admin: { segment: [{ node: "admin.*", weight: 10 }] },
        user: { segment: [{ node: "user.*", weight: 5 }] }
    },
    role: {
        superadmin: { inherit: ["admin"], segment: [{ node: "*", weight: 100 }] },
        normaluser: { inherit: ["user"] }
    },
    rule: []
};

const pm = _PermissionManager.create({ table: testTable });

// 测试权限检查
const hasPermission = await pm.check({ roleset: "superadmin", node: "admin.delete" });
```

### 2. CmdParser（命令解析器）

**可测试性**：高 - 纯函数，无外部依赖

**测试内容**：
- [ ] 命令前缀识别
- [ ] 命令后缀识别
- [ ] 命令分割（splitCmd）
- [ ] 参数解析（parseOption）
- [ ] 主参数提取（getMainArg）
- [ ] 完整命令解析（parseCmd）

**测试方法**：
```typescript
// 测试命令解析
const cmdObj = CmdParser.parseCmd("cmd:test arg1 arg2;;");
expect(cmdObj.command).toBe("test");
expect(cmdObj.args).toEqual(["test", "arg1", "arg2"]);
```

### 3. TextProcesser（文本处理器）

**可测试性**：中 - 可能依赖LaMChar模块

**测试内容**：
- [ ] 文本预处理
- [ ] 文本后处理
- [ ] 特殊字符处理
- [ ] Markdown处理

**测试方法**：
```typescript
// 测试文本处理
const processedText = await TextProcesser.process("test text");
expect(processedText).toBeDefined();
```

### 4. TranslationManager（翻译管理器）

**可测试性**：中 - 依赖第三方API，需要Mock

**测试内容**：
- [ ] 翻译接口调用
- [ ] 错误处理
- [ ] 缓存机制

**测试方法**：
```typescript
// Mock翻译API
const mockTranslator = {
    translate: jest.fn().mockResolvedValue("translated text")
};

// 测试翻译管理器
const tm = new TranslationManager(mockTranslator);
const result = await tm.translate("test text");
expect(result).toBe("translated text");
```

### 5. CharProfile（角色档案）

**可测试性**：中 - 依赖数据库，需要Mock

**测试内容**：
- [ ] 档案创建
- [ ] 档案加载
- [ ] 档案更新
- [ ] 档案验证

**测试方法**：
```typescript
// Mock数据库访问
const mockDBAccesser = {
    getData: jest.fn().mockResolvedValue({ /* test data */ }),
    setData: jest.fn().mockResolvedValue(undefined)
};

// 测试角色档案
const profile = new CharProfile(mockDBAccesser);
await profile.load("test_char");
```

## 测试文件结构

```
Test/
  src/
    Server/
      permission-manager.test.ts  # 权限管理器测试
      cmd-parser.test.ts          # 命令解析器测试
      text-processer.test.ts      # 文本处理器测试
      translation-manager.test.ts # 翻译管理器测试
      char-profile.test.ts        # 角色档案测试
```

## 测试步骤

### 阶段1：高优先级模块测试（1-2天）

1. **PermissionManager测试**
   - 创建测试文件 `permission-manager.test.ts`
   - 测试权限匹配、权重计算、继承关系
   - 测试循环继承检测
   - 测试权重冲突解决

2. **CmdParser测试**
   - 创建测试文件 `cmd-parser.test.ts`
   - 测试命令解析、参数提取
   - 测试各种边界情况

### 阶段2：中优先级模块测试（1-2天）

3. **TextProcesser测试**
   - 创建测试文件 `text-processer.test.ts`
   - 测试文本处理逻辑
   - Mock依赖模块

4. **TranslationManager测试**
   - 创建测试文件 `translation-manager.test.ts`
   - Mock第三方API
   - 测试翻译功能和错误处理

### 阶段3：集成测试（可选）

5. **CharProfile测试**
   - 创建测试文件 `char-profile.test.ts`
   - Mock数据库访问
   - 测试档案管理功能

## 测试用例设计

### PermissionManager测试用例

```typescript
describe("PermissionManager", () => {
    test("应正确匹配权限节点", async () => {
        const pm = _PermissionManager.create({ table: {
            define: { admin: { segment: [{ node: "admin.*", weight: 10 }] } },
            role: {},
            rule: []
        }});
        
        const hasPermission = await pm.check({ roleset: "admin", node: "admin.delete" });
        expect(hasPermission).toBe(true);
    });

    test("应正确计算权重", async () => {
        const pm = _PermissionManager.create({ table: {
            define: {
                positive: { segment: [{ node: "test", weight: 10 }] },
                negative: { segment: [{ node: "test", weight: -5 }] }
            },
            role: {},
            rule: []
        }});
        
        const hasPermission = await pm.check({ roleset: ["positive", "negative"], node: "test" });
        expect(hasPermission).toBe(true); // 10 + (-5) = 5 >= 1
    });

    test("应检测循环继承", async () => {
        const pm = _PermissionManager.create({ table: {
            define: {
                a: { inherit: ["b"] },
                b: { inherit: ["a"] }
            },
            role: {},
            rule: []
        }});
        
        // 不应该无限循环
        const hasPermission = await pm.check({ roleset: "a", node: "test" });
        expect(hasPermission).toBe(false);
    });
});
```

### CmdParser测试用例

```typescript
describe("CmdParser", () => {
    test("应正确解析简单命令", () => {
        const cmdObj = CmdParser.parseCmd("cmd:test;;");
        expect(cmdObj.command).toBe("test");
        expect(cmdObj.args).toEqual(["test"]);
    });

    test("应正确解析带参数的命令", () => {
        const cmdObj = CmdParser.parseCmd("cmd:test arg1 arg2;;");
        expect(cmdObj.command).toBe("test");
        expect(cmdObj.args).toEqual(["test", "arg1", "arg2"]);
        expect(cmdObj.rawArg).toBe("arg1 arg2");
    });

    test("应正确解析选项参数", () => {
        const options = CmdParser.parseOption('key1="value1" key2="value2"');
        expect(options.key1).toBe("value1");
        expect(options.key2).toBe("value2");
    });

    test("应处理缺省命令", () => {
        const cmdObj = CmdParser.parseCmd("普通消息");
        expect(cmdObj.command).toBe("sendmessage");
    });
});
```

## 预期结果

- 所有可剥离模块的自动化测试通过
- 测试覆盖率达到80%以上
- 发现并修复潜在的bug
- 为后续开发提供回归测试保障

## 注意事项

1. **不要在真实环境测试**：所有测试都应在Test项目中进行，避免影响生产环境
2. **使用Mock对象**：对于依赖外部服务的模块，使用Mock对象替代
3. **测试边界情况**：不仅要测试正常流程，还要测试异常情况
4. **保持测试独立性**：每个测试用例应该独立，不依赖其他测试用例

## 测试优先级

1. **高优先级**：PermissionManager、CmdParser（纯逻辑，无外部依赖）
2. **中优先级**：TextProcesser、TranslationManager（需要Mock）
3. **低优先级**：CharProfile（需要Mock数据库）

## 测试工具

- **Jest**：测试框架
- **Mock函数**：模拟外部依赖
- **TypeScript**：类型安全

## 测试报告

测试完成后，应编写测试报告，包括：

1. 测试概述
2. 测试结果
3. 发现的问题
4. 改进建议
5. 测试覆盖率