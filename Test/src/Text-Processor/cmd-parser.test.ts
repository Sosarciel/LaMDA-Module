import { CmdParser } from "@sosraciel-lamda/text-processor";

describe('CmdParser', () => {
    describe('parseOption', () => {
        it('应解析简单的键值对', () => {
            const result = CmdParser.parseOption('key1=value1 key2=value2');
            expect(result).toEqual({
                key1: 'value1',
                key2: 'value2'
            });
        });

        it('应解析带引号的值', () => {
            const result = CmdParser.parseOption('key1="value with spaces" key2=value2');
            expect(result).toEqual({
                key1: 'value with spaces',
                key2: 'value2'
            });
        });

        it('应处理转义字符', () => {
            const result = CmdParser.parseOption('key1="value\\"with\\"quotes"');
            expect(result).toEqual({
                key1: 'value"with"quotes'
            });
        });

        it('应返回空对象对于空字符串', () => {
            const result = CmdParser.parseOption('');
            expect(result).toEqual({});
        });

        it('应处理无值的键', () => {
            const result = CmdParser.parseOption('key1 key2=value2');
            expect(result.key2).toBe('value2');
        });
    });

    describe('parseCmd', () => {
        describe('基本解析', () => {
            it('应解析带前缀和后缀的指令', () => {
                const result = CmdParser.parseCmd('cmd:reset;;');
                expect(result.command).toBe('reset');
                expect(result.args).toContain('reset');
            });

            it('应解析带中文前缀的指令', () => {
                const result = CmdParser.parseCmd('cmd：reset；；');
                expect(result.command).toBe('reset');
            });

            it('应解析带参数的指令', () => {
                const result = CmdParser.parseCmd('cmd:test arg1 arg2;;');
                expect(result.command).toBe('test');
                expect(result.args).toEqual(['test', 'arg1', 'arg2']);
            });

            it('应返回 sendmessage 对于无指令的消息', () => {
                const result = CmdParser.parseCmd('普通消息');
                expect(result.command).toBe('sendmessage');
            });
        });

        describe('mainArg', () => {
            it('应正确提取主参数', () => {
                const result1 = CmdParser.parseCmd('cmd:reset;;这是主参数');
                expect(result1.mainArg).toBe('这是主参数');
                const result2 = CmdParser.parseCmd('这是主参数cmd:reset;;');
                expect(result2.mainArg).toBe('这是主参数');
            });

            it('应返回原消息对于无指令的消息', () => {
                const result = CmdParser.parseCmd('这是一条普通消息');
                expect(result.mainArg).toBe('这是一条普通消息');
            });

            it('应处理指令在中间的情况', () => {
                const result = CmdParser.parseCmd('前缀 cmd:test;; 后缀');
                expect(result.mainArg).toBe('前缀后缀');
            });
        });

        describe('rawArg', () => {
            it('应返回未切分的参数文本', () => {
                const result = CmdParser.parseCmd('cmd:test arg1 arg2 arg3;;');
                expect(result.rawArg).toBe('arg1 arg2 arg3');
            });

            it('应处理无参数的指令', () => {
                const result = CmdParser.parseCmd('cmd:reset;;');
                expect(result.rawArg).toBe('');
            });
        });

        describe('边界情况', () => {
            it('应处理空消息', () => {
                const result = CmdParser.parseCmd('');
                expect(result.command).toBe('sendmessage');
                expect(result.mainArg).toBe('');
            });

            it('应处理只有空格的消息', () => {
                const result = CmdParser.parseCmd('   ');
                expect(result.command).toBe('sendmessage');
            });

            it('应处理指令前后有空格', () => {
                const result = CmdParser.parseCmd('  cmd:test arg1;;  ');
                expect(result.command).toBe('test');
                expect(result.args).toEqual(['test', 'arg1']);
            });

            it('应处理多行消息', () => {
                const result = CmdParser.parseCmd('第一行\ncmd:test;;\n第三行');
                expect(result.command).toBe('test');
            });
        });
    });
});
