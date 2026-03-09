import { memoize } from "@zwa73/utils";

const buildregex = memoize((pattern:string,subs:Record<string,string>,flags:string)=>{
    Object.entries(subs).forEach(([k,v])=>
        pattern = pattern.replaceAll(`{{${k}}}`,v));
    return new RegExp(pattern,flags);
});
/**专门用于拼接正则的标签模板函数
 * @param flags 正则的 flag，如 'g', 'gm', 'i'
 * @param subs 替换的字符串，如 {name: 'John'}
 */
export const rx = (opt?:{ flags :string, subs :Record<string,string>}) => {
    const {flags='',subs={}} = opt??{};
    return (strings: TemplateStringsArray, ...values: any[]) => {
        // 核心：使用 strings.raw 避免双重转义！
        const pattern = strings.raw.reduce((acc, str, i) => {
            let val = values[i - 1];
            // 如果插值进来的是 RegExp 对象，自动提取它的 .source
            if (val instanceof RegExp) val = val.source;
            return acc + (val !== undefined ? val : '') + str;
        });
        return buildregex(pattern, subs, flags);
    };
}

