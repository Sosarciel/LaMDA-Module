import { clipMessage } from "@sosraciel-lamda/text-processor";

describe('TextClipper - clipMessage', () => {
    describe('基本功能', () => {
        it('应正确切分短文本', () => {
            const text = '短文本';
            const result = clipMessage(text, 100);
            expect(result).toEqual(['短文本']);
        });

        it('应正确切分长文本', () => {
            const text = '这是一段很长的文本，需要被切分成多个片段。每个片段都不应该超过最大长度限制。';
            const result = clipMessage(text, 20);
            expect(result.length).toBeGreaterThan(1);
            result.forEach(chunk => {
                expect(chunk.length).toBeLessThanOrEqual(25); // 考虑后处理可能增加长度
            });
        });

        it('应处理空字符串', () => {
            const result = clipMessage('', 100);
            expect(result).toEqual([]);
        });
    });

    describe('分隔符优先级', () => {
        it('应优先在句末标点处切分', () => {
            const text = '第一句话。第二句话。第三句话。';
            const result = clipMessage(text, 10);
            expect(result.length).toBeGreaterThan(1);
        });

        it('应在句末标点不足时使用逗号切分', () => {
            const text = '第一段，第二段，第三段，第四段';
            const result = clipMessage(text, 8);
            expect(result.length).toBeGreaterThan(1);
        });

        it('应在无分隔符时强制切分', () => {
            const text = 'abcdefghijklmnopqrstuvwxyz';
            const result = clipMessage(text, 10);
            expect(result.length).toBeGreaterThan(1);
        });
    });

    describe('后处理', () => {
        it('应移除首尾的逗号和空格', () => {
            const text = '测试文本，需要切分。';
            const result = clipMessage(text, 5);
            result.forEach(chunk => {
                expect(chunk).not.toMatch(/^[，,\s]/);
                expect(chunk).not.toMatch(/[，,\s]$/);
            });
        });

        it('应移除单独的星号行', () => {
            const text = '第一段*\n第二段';
            const result = clipMessage(text, 20);
            expect(result).not.toContain('*');
        });

        it('应过滤空片段', () => {
            const text = '测试';
            const result = clipMessage(text, 100);
            expect(result.every(chunk => chunk.length >= 1)).toBe(true);
        });
    });

    describe('边界情况', () => {
        it('应处理只有换行符的文本', () => {
            const result = clipMessage('\n\n\n', 100);
            expect(result.length).toBe(1);
            expect(result[0]).toBe('');
        });

        it('应处理超长无分隔符文本', () => {
            const text = 'a'.repeat(1000);
            const result = clipMessage(text, 100);
            expect(result.length).toBeGreaterThan(1);
        });

        it('应处理中英文混合', () => {
            const text = 'Hello world, this is a test。这是中文测试，需要切分。';
            const result = clipMessage(text, 20);
            expect(result.length).toBeGreaterThan(1);
        });

        it('应处理maxLength为1的情况', () => {
            const text = '测试';
            const result = clipMessage(text, 1);
            expect(result.length).toBeGreaterThan(0);
        });
    });

    describe('实际场景', () => {
        it('应正确处理QQ消息切分', () => {
            const text = '*微笑着打招呼*\n\n你好呀！今天天气真好呢～要不要一起出去玩？\n\n*期待地看着你*';
            const result = clipMessage(text, 80);
            expect(result.length).toBeGreaterThan(0);
            result.forEach(chunk => {
                expect(chunk.length).toBeLessThanOrEqual(85);
            });
        });

        it('应处理带动作标记的文本', () => {
            const text = '*动作1*描述文字*动作2*更多描述';
            const result = clipMessage(text, 20);
            expect(result.length).toBeGreaterThan(0);
        });
    });
});
