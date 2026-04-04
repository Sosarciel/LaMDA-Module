import { UtilDB } from "@sosraciel-lamda/postgresql-manager";

describe("UtilDB.cleanUndefined 单元测试", () => {
    describe("对象处理", () => {
        test("1. 应删除对象中的 undefined 字段", () => {
            const obj = {
                a: 1,
                b: undefined,
                c: "test"
            };

            UtilDB.cleanUndefined(obj);

            expect(obj).toEqual({ a: 1, c: "test" });
            expect('b' in obj).toBe(false);
        });

        test("2. 应保留 null 值", () => {
            const obj = {
                a: 1,
                b: null,
                c: "test"
            };

            UtilDB.cleanUndefined(obj);

            expect(obj).toEqual({ a: 1, b: null, c: "test" });
        });

        test("3. 应保留空对象", () => {
            const obj = {
                a: 1,
                b: {},
                c: "test"
            };

            UtilDB.cleanUndefined(obj);

            expect(obj).toEqual({ a: 1, b: {}, c: "test" });
        });
    });

    describe("数组处理", () => {
        test("4. 应将数组中的 undefined 转为 null", () => {
            const obj = {
                arr: [1, undefined, 3]
            };

            UtilDB.cleanUndefined(obj);

            expect(obj.arr).toEqual([1, null, 3]);
        });

        test("5. 应保留数组中的 null 值", () => {
            const obj = {
                arr: [1, null, 3]
            };

            UtilDB.cleanUndefined(obj);

            expect(obj.arr).toEqual([1, null, 3]);
        });

        test("6. 应正确处理数组中的多个 undefined", () => {
            const obj = {
                arr: [undefined, undefined, undefined]
            };

            UtilDB.cleanUndefined(obj);

            expect(obj.arr).toEqual([null, null, null]);
        });
    });

    describe("嵌套结构处理", () => {
        test("7. 应递归清理嵌套对象中的 undefined", () => {
            const obj = {
                level1: {
                    level2: {
                        a: 1,
                        b: undefined,
                        c: "test"
                    }
                }
            };

            UtilDB.cleanUndefined(obj);

            expect(obj.level1.level2).toEqual({ a: 1, c: "test" });
            expect('b' in obj.level1.level2).toBe(false);
        });

        test("8. 应递归处理嵌套数组中的 undefined", () => {
            const obj = {
                arr: [
                    { a: 1, b: undefined },
                    { c: undefined, d: 2 }
                ]
            };

            UtilDB.cleanUndefined(obj);

            expect(obj.arr).toEqual([
                { a: 1 },
                { d: 2 }
            ]);
        });

        test("9. 应正确处理数组中嵌套数组的 undefined", () => {
            const obj = {
                arr: [
                    [1, undefined, 3],
                    [undefined, 2]
                ]
            };

            UtilDB.cleanUndefined(obj);

            expect(obj.arr).toEqual([
                [1, null, 3],
                [null, 2]
            ]);
        });

        test("10. 应正确处理深度嵌套的混合结构", () => {
            const obj = {
                level1: {
                    arr: [1, undefined, { nested: undefined, value: "test" }],
                    obj: {
                        nested: {
                            arr: [undefined],
                            value: undefined
                        }
                    }
                }
            };

            UtilDB.cleanUndefined(obj);

            expect(obj.level1.arr).toEqual([1, null, { value: "test" }]);
            expect(obj.level1.obj.nested.arr).toEqual([null]);
            expect('value' in obj.level1.obj.nested).toBe(false);
        });
    });

    describe("边界情况", () => {
        test("11. 空对象应不变", () => {
            const obj = {};

            UtilDB.cleanUndefined(obj);

            expect(obj).toEqual({});
        });

        test("12. 空数组应不变", () => {
            const obj = {
                arr: []
            };

            UtilDB.cleanUndefined(obj);

            expect(obj.arr).toEqual([]);
        });

        test("13. 无 undefined 的对象应不变", () => {
            const obj = {
                a: 1,
                b: "test",
                c: null,
                d: { e: 2 }
            };

            const expected = JSON.parse(JSON.stringify(obj));

            UtilDB.cleanUndefined(obj);

            expect(obj).toEqual(expected);
        });

        test("14. 顶层数组应正确处理", () => {
            const arr = [1, undefined, { a: undefined, b: 2 }];

            UtilDB.cleanUndefined(arr);

            expect(arr).toEqual([1, null, { b: 2 }]);
        });

        test("15. null 输入应安全处理", () => {
            expect(() => UtilDB.cleanUndefined(null)).not.toThrow();
        });

        test("16. 原始类型输入应安全处理", () => {
            expect(() => UtilDB.cleanUndefined(123)).not.toThrow();
            expect(() => UtilDB.cleanUndefined("string")).not.toThrow();
            expect(() => UtilDB.cleanUndefined(undefined as any)).not.toThrow();
        });
    });

    describe("JSON.stringify 行为一致性", () => {
        test("17. 清理后 JSON.stringify 结果应与清理前一致（除 undefined 外）", () => {
            const obj = {
                a: 1,
                b: undefined,
                c: null,
                arr: [1, undefined, 3],
                nested: { x: undefined, y: 2 }
            };

            // JSON.stringify 的预期行为
            const expectedJson = JSON.stringify({
                a: 1,
                c: null,
                arr: [1, null, 3],
                nested: { y: 2 }
            });

            UtilDB.cleanUndefined(obj);
            const actualJson = JSON.stringify(obj);

            expect(actualJson).toBe(expectedJson);
        });

        test("18. 数组中 undefined 转换应与 JSON.stringify 一致", () => {
            const arr = [undefined, 1, undefined, 2, undefined];

            // JSON.stringify 将数组中的 undefined 转为 null
            const expectedJson = JSON.stringify(arr);

            const testArr = [undefined, 1, undefined, 2, undefined];
            UtilDB.cleanUndefined(testArr);
            const actualJson = JSON.stringify(testArr);

            expect(actualJson).toBe(expectedJson);
        });
    });
});
