---
aliases: [RulePipe 改进与测试计划]
---
# RulePipe 改进与测试计划

## 一、当前状态分析

### RulePipe 现有功能
- `create(...rules)` - 静态工厂方法，支持 rest 参数传入规则
- `process(text, hook?)` - 执行所有规则，可选 hook 调试
- `debug(text)` - 返回每步调试结果
- `length` / `rules` - 只读属性

### MarkdownRuleSet 现有规则（18个）
| 规则名 | 类型 | 说明 |
|--------|------|------|
| normalizeLineEndings | 基础 | CRLF 转 LF |
| trimEachLine | 基础 | 去除每行首尾空白 |
| fixOddAsterisks | 修复 | 修复奇数个未转义星号 |
| removeInvalidBracketAsterisks | 清理 | 删除无效括号内的星号动作 |
| convertNonMathBrackets | 转换 | 转换非数学表达式括号为动作 |
| fixIncompleteAsterisks | 修复 | 修复不完整星号 |
| ensureActionLineBreaks | 格式化 | 确保动作换行 |
| removeInvalidQuotes | 清理 | 删除无效成对前引号 |
| removeBracketsInAsterisks | 清理 | 删除星号内括号 |
| removeSingleSymbolLines | 清理 | 删除单符号行 |
| convertLineBracketsToAction | 转换 | 转换整行括号为动作 |
| processQuoteActions | 处理 | 处理引号动作 |
| removeInvalidPunctuation | 清理 | 移除动作内的无效标点 |

---

## 二、RulePipe 改进方案

### 2.1 类型安全改进

**问题**：当前 `RuleItem` 联合类型导致类型推断不够精确

**方案**：保持现有设计，但可考虑添加类型守卫

```typescript
/**判断是否为规则对象 */
export const isRuleObject = (item: RuleItem): item is { rule: RuleFn; desc?: string } =>
    typeof item !== "function";
```

### 2.2 性能优化

**问题**：每次 `process` 调用都会遍历所有规则，即使某些规则不产生变化

**方案**：暂不需要优化，当前场景文本处理量不大

### 2.3 功能扩展建议

#### 2.3.1 规则分组（低优先级）
```typescript
/**规则分组，便于批量启用/禁用 */
public getRuleGroup(start: number, end: number): RuleDefinition[] {
    return this._rules.slice(start, end);
}
```

#### 2.3.2 条件执行（低优先级）
```typescript
/**执行到条件满足为止 */
public processUntil(text: string, condition: (result: string) => boolean): string {
    let result = text;
    for (const rule of this._rules) {
        result = rule.rule(result);
        if (condition(result)) break;
    }
    return result;
}
```

### 2.4 不建议添加的功能

- **动态添加/删除规则**：违背管道不可变设计原则
- **规则优先级**：增加复杂度，用户应在创建时自行排序
- **异步规则**：增加复杂度，当前场景不需要

---

## 三、大 Pipe 测试方案

### 3.1 测试策略

#### 分层测试
```
┌─────────────────────────────────────┐
│         集成测试（完整管道）          │
├─────────────────────────────────────┤
│       规则组测试（相关规则组合）       │
├─────────────────────────────────────┤
│        单元测试（单个规则）           │
└─────────────────────────────────────┘
```

### 3.2 单元测试方案

每个规则独立测试，覆盖以下场景：

```typescript
describe('MarkdownRuleSet', () => {
    describe('normalizeLineEndings', () => {
        it('应转换 CRLF 为 LF', () => {
            expect(MarkdownRuleSet.normalizeLineEndings('a\r\nb')).toBe('a\nb');
        });
        it('应保留 LF 不变', () => {
            expect(MarkdownRuleSet.normalizeLineEndings('a\nb')).toBe('a\nb');
        });
        it('应处理空字符串', () => {
            expect(MarkdownRuleSet.normalizeLineEndings('')).toBe('');
        });
    });

    // 每个规则类似...
});
```

### 3.3 规则组测试方案

按功能分组测试规则组合：

```typescript
describe('MarkdownRuleSet - 星号处理组', () => {
    const pipe = RulePipe.create(
        { rule: MarkdownRuleSet.fixOddAsterisks, desc: '修复奇数星号' },
        { rule: MarkdownRuleSet.fixIncompleteAsterisks, desc: '修复不完整星号' }
    );

    it('应修复各种星号问题', () => {
        expect(pipe.process('a * b')).toBe('a \\* b');
        expect(pipe.process('*string')).toBe('*string*');
    });
});
```

### 3.4 集成测试方案

测试完整管道的端到端行为：

```typescript
describe('MarkdownFixPipe - 集成测试', () => {
    const pipe = createMarkdownFixPipe();

    describe('基础场景', () => {
        it('应处理空输入', () => {
            expect(pipe.process('')).toBe('');
        });
        it('应处理纯文本', () => {
            expect(pipe.process('plain text')).toBe('plain text');
        });
    });

    describe('复杂场景', () => {
        it('应正确处理嵌套结构', () => {
            const input = '*motion1*\n(desc2)';
            const expected = '*motion1*\n*desc2*';
            expect(pipe.process(input)).toBe(expected);
        });
    });

    describe('边界情况', () => {
        it('应处理超长文本', () => {
            const longText = 'a'.repeat(10000);
            expect(pipe.process(longText)).toBe(longText);
        });
    });
});
```

### 3.5 调试测试方案

利用 `debug()` 方法进行问题定位：

```typescript
describe('MarkdownFixPipe - 调试测试', () => {
    it('应能追踪每步变化', () => {
        const pipe = createMarkdownFixPipe();
        const steps = pipe.debug('*motion1*desc2');

        // 验证关键步骤
        const step3 = steps.find(s => s.desc?.includes('换行'));
        expect(step3?.output).toContain('\n*motion1*\n');
    });

    it('hook 应正确调用', () => {
        const pipe = createMarkdownFixPipe();
        const changes: string[] = [];

        pipe.process('*motion1*', (info) => {
            changes.push(info.desc ?? '');
        });

        expect(changes.length).toBeGreaterThan(0);
    });
});
```

### 3.6 回归测试方案

使用快照测试确保输出稳定：

```typescript
describe('MarkdownFixPipe - 回归测试', () => {
    const testCases = [
        { name: 'case1', input: '*motion1*\n\ndesc2' },
        { name: 'case2', input: '(string)\n*motion*' },
        // 更多测试用例...
    ];

    testCases.forEach(({ name, input }) => {
        it(`应正确处理 ${name}`, () => {
            const pipe = createMarkdownFixPipe();
            expect(pipe.process(input)).toMatchSnapshot();
        });
    });
});
```

---

## 四、测试文件结构建议

```
LaMDA-Module/Test/src/Text-Processor/
├── RulePipe.test.ts           # RulePipe 核心测试
├── MarkdownRuleSet.test.ts    # 单规则单元测试
├── MarkdownRuleSet-Groups.test.ts  # 规则组测试
└── fixMarkdown.test.ts        # 集成测试（现有）
```

---

## 五、实施优先级

| 优先级 | 任务 | 预计工作量 |
|--------|------|-----------|
| P0 | 单规则单元测试 | 2h |
| P1 | 规则组测试 | 1h |
| P2 | 调试测试 | 0.5h |
| P3 | 回归快照测试 | 1h |

---

## 六、总结

RulePipe 当前设计简洁有效，不建议过度扩展。测试应采用分层策略：

1. **单元测试** - 确保每个规则独立正确
2. **规则组测试** - 验证相关规则的组合效果
3. **集成测试** - 确保完整管道端到端正确
4. **调试测试** - 便于问题定位

这种分层测试策略既能保证质量，又便于问题定位和维护。
