import { CmdParser } from "@sosraciel-lamda/text-processor";

describe('CmdParser', () => {
    describe('1. parseOption 解析选项', () => {
        describe('1.1 基本解析', () => {
            it('1.1.1 应解析简单的键值对', () => {
                const result = CmdParser.parseOption('key1=value1 key2=value2');
                expect(result).toEqual({
                    key1: 'value1',
                    key2: 'value2'
                });
            });

            it('1.1.2 应解析带引号的值', () => {
                const result = CmdParser.parseOption('key1="value with spaces" key2=value2');
                expect(result).toEqual({
                    key1: 'value with spaces',
                    key2: 'value2'
                });
            });

            it('1.1.3 应处理转义字符', () => {
                const result = CmdParser.parseOption('key1="value\\"with\\"quotes"');
                expect(result).toEqual({
                    key1: 'value"with"quotes'
                });
            });
        });

        describe('1.2 边界情况', () => {
            it('1.2.1 应返回空对象对于空字符串', () => {
                const result = CmdParser.parseOption('');
                expect(result).toEqual({});
            });

            it('1.2.2 应处理无值的键', () => {
                const result = CmdParser.parseOption('key1 key2=value2');
                expect(result).toEqual({
                    key2: 'value2'
                });
            });
        });
    });

    describe('2. parseCmd 解析指令', () => {
        describe('2.1 基本解析', () => {
            it('2.1.1 应解析带前缀和后缀的指令', () => {
                const result = CmdParser.parseCmd({ message: 'cmd:reset;;' });
                expect(result).toEqual({
                    command: 'reset',
                    args: ['reset'],
                    mainArg: '',
                    rawArg: ''
                });
            });

            it('2.1.2 应解析带中文前缀的指令', () => {
                const result = CmdParser.parseCmd({ message: 'cmd：reset；；' });
                expect(result.command).toBe('reset');
            });

            it('2.1.3 应解析带参数的指令', () => {
                const result = CmdParser.parseCmd({ message: 'cmd:test arg1 arg2;;' });
                expect(result).toEqual({
                    command: 'test',
                    args: ['test', 'arg1', 'arg2'],
                    mainArg: '',
                    rawArg: 'arg1 arg2'
                });
            });

            it('2.1.4 未找到指令且未传 fallback 时 command 应为 undefined', () => {
                const result = CmdParser.parseCmd({ message: '普通消息' });
                expect(result).toEqual({
                    command: undefined,
                    args: [],
                    mainArg: '普通消息',
                    rawArg: ''
                });
            });

            it('2.1.5 未找到指令时应该使用传入的 fallback 作为指令名', () => {
                const result = CmdParser.parseCmd({ message: '普通消息', fallback: 'sendmessage' });
                expect(result).toEqual({
                    command: 'sendmessage',
                    args: ['sendmessage'],
                    mainArg: '普通消息',
                    rawArg: ''
                });
            });

            it('2.1.6 fallback 只在未找到指令时生效', () => {
                const result = CmdParser.parseCmd({ message: 'cmd:reset;;', fallback: 'sendmessage' });
                expect(result.command).toBe('reset');
            });

            it('2.1.7 fallback 为空字符串时等效于未传 fallback', () => {
                const result = CmdParser.parseCmd({ message: '普通消息', fallback: '' });
                expect(result).toEqual({
                    command: undefined,
                    args: [],
                    mainArg: '普通消息',
                    rawArg: ''
                });
            });
        });

        describe('2.2 mainArg 主参数提取', () => {
            it('2.2.1 应正确提取指令后的主参数', () => {
                const result = CmdParser.parseCmd({ message: 'cmd:reset;;这是主参数' });
                expect(result.mainArg).toBe('这是主参数');
            });

            it('2.2.2 应正确提取指令前的主参数', () => {
                const result = CmdParser.parseCmd({ message: '这是主参数cmd:reset;;' });
                expect(result.mainArg).toBe('这是主参数');
            });

            it('2.2.3 应返回原消息对于无指令的消息', () => {
                const result = CmdParser.parseCmd({ message: '这是一条普通消息' });
                expect(result.mainArg).toBe('这是一条普通消息');
            });

            it('2.2.4 应处理指令在中间的情况', () => {
                const result = CmdParser.parseCmd({ message: '前缀 cmd:test;; 后缀' });
                expect(result.mainArg).toBe('前缀后缀');
            });
        });

        describe('2.3 rawArg 原始参数', () => {
            it('2.3.1 应返回未切分的参数文本', () => {
                const result = CmdParser.parseCmd({ message: 'cmd:test arg1 arg2 arg3;;' });
                expect(result.rawArg).toBe('arg1 arg2 arg3');
            });

            it('2.3.2 应处理无参数的指令', () => {
                const result = CmdParser.parseCmd({ message: 'cmd:reset;;' });
                expect(result.rawArg).toBe('');
            });
        });

        describe('2.4 边界情况', () => {
            it('2.4.1 应处理空消息', () => {
                const result = CmdParser.parseCmd({ message: '' });
                expect(result).toEqual({
                    command: undefined,
                    args: [],
                    mainArg: '',
                    rawArg: ''
                });
            });

            it('2.4.2 应处理只有空格的消息', () => {
                const result = CmdParser.parseCmd({ message: '   ' });
                expect(result).toEqual({
                    command: undefined,
                    args: [],
                    mainArg: '   ',
                    rawArg: ''
                });
            });

            it('2.4.3 应处理指令前后有空格', () => {
                const result = CmdParser.parseCmd({ message: '  cmd:test arg1;;  ' });
                expect(result).toEqual({
                    command: 'test',
                    args: ['test', 'arg1'],
                    mainArg: '',
                    rawArg: 'arg1'
                });
            });

            it('2.4.4 应处理多行消息', () => {
                const result = CmdParser.parseCmd({ message: '第一行\ncmd:test;;\n第三行' });
                expect(result).toEqual({
                    command: 'test',
                    args: ['test'],
                    mainArg: '第一行第三行',
                    rawArg: ''
                });
            });
        });
    });

    describe('3. findCmd 查找指令', () => {
        it('3.1.1 应返回完整的指令文本(含前后缀)', () => {
            expect(CmdParser.findCmd('cmd:reset;;')).toBe('cmd:reset;;');
        });

        it('3.1.2 应识别中文前缀与后缀', () => {
            expect(CmdParser.findCmd('cmd：reset；；')).toBe('cmd：reset；；');
        });

        it('3.1.3 应保留指令前后的空白', () => {
            expect(CmdParser.findCmd('  cmd:test arg1;;  ')).toBe('  cmd:test arg1;;  ');
        });

        it('3.1.4 应处理无尾缀的指令', () => {
            expect(CmdParser.findCmd('cmd:test arg1')).toBe('cmd:test arg1');
        });

        it('3.1.5 找不到指令时应返回 undefined', () => {
            expect(CmdParser.findCmd('普通消息')).toBeUndefined();
        });

        it('3.1.6 空消息应返回 undefined', () => {
            expect(CmdParser.findCmd('')).toBeUndefined();
        });

        it('3.1.7 只有空格的消息应返回 undefined', () => {
            expect(CmdParser.findCmd('   ')).toBeUndefined();
        });
    });
});
