const regex = (text:string)=> {
        //移除think标签与特殊格式
        text = text.replace(/<think>[\s\S]*?<\/think>/g, "");
        text = text.replace(/\s*ASSISTANT(:|：)\s*/gi,'');

        //移除gemini末尾总结
        text = text.replace(/\s*\n(---|===)\s*\*?\*?([a-zA-Z]|既然|接下来|要不要|我可以为|你想)[\s\S]+/,'');



        //修复星号
        const brackets = [
            ['【','】'],
            ['（','）'],
            ['\\(','\\)'],
            ['\\[','\\]'],
        ] as const;
        const quotes = [
            ['"','"'],
            ['“','”'],
            ['「','」'],
        ] as const;
        const endsymbols = [',','\\.','，','。',';','；'] as const;
        const ap = /(?<!\\)\*/.source;//非转义的动作匹配
        const ta = /\\\*/.source;//转义的动作匹配

        //逐行trim
        const eachTrim = ()=> text = text
            .replace(/\n\s+/g, "\n")
            .replace(/\s+\n/g, "\n")
            .trim();

        text = text.replace(/\r\n/g, "\n");  //crlf

        eachTrim();

        //检查未转义的星号数量并尝试修复
        const napcount = (str:string)=> str.match(new RegExp(ap,'g'))?.length ?? 0;
        if(napcount(text) % 2 != 0){
            const fixes = [
                //孤立符号
                () => text.replace(new RegExp(` ${ap} `, 'g'), " \\* "),
                //乘法
                () => text.replace(new RegExp(`([a-zA-Z0-9])${ap}([a-zA-Z0-9])`, 'g'), "$1\\*$2")
            ];
            for (const fix of fixes) {
                const fxtext = fix();
                if (napcount(fxtext) % 2 === 0) {
                    text = fxtext;
                    break;
                }
            }
        }

        //删除 无效括号 (*string*) -> *string*
        //删除 无效引号 "*string*" -> *string*
        [...brackets,...quotes].forEach(([l,r])=>{
            const regex = new RegExp(`${l}${ap}(([^*\\n${l+r}]|${ta})+?)${ap}${r}`, "g");
            text=text.replace(regex, `*$1*`);
        });

        //动作外的
        //非数学表达式括号转为动作 (string) -> *string*
        brackets.forEach(([l,r])=>{
            //不包含 +-*/\n
            const regex = new RegExp(`^(([^*\\n]|${ta})+?)${l}([^+\\-*/.\\n${l+r}]+)${r}`, "gm");
            text=text.replace(regex, `$1\n*$3*\n`);
        });

        //修复不完整星号
        //(^|[？！。；…])\* 一行开头或[？！。；…]后的星号 -- 新模型不再有此问题不再确保[？！。；…]
        // *string -> *string*
        // string* -> *string*
        const fixstart = ()=>text = text
            .replace(new RegExp(`(^${ap}([^*\\n]|${ta})+$)`,'gm'), `$1*`) //结尾前的1+n个非星号非换行字符
            .replace(new RegExp(`(^([^*\\n]|${ta})+${ap}$)`,'gm'), `*$1`);//从开头到结尾星号前的1+n个非星号非换行字符
        fixstart();

        //确保动作换行
        // *string**string* -> *string*\n*string*
        const actRegex = new RegExp(`\\n?(${ap}([^*\\n]|${ta})+?${ap})\\n?`,'g');
        text = text.replace(actRegex, "\n$1\n").trim();

        //动作换行后产生新行, 再次尝试修复
        fixstart();

        //整行匹配前运行过可能产新行的操作时需确保eachTrim
        eachTrim();

        //删除无效成对前引号
        // ^"string"$ -> ^string$
        const rmquotes = ()=>quotes.forEach(([l,r])=>{
            const regex = new RegExp(`^${l}([^\\n${l+r}]+)${r}$`, "gm");
            text=text.replace(regex, "$1");
        });
        rmquotes();
        //删除星号内括号
        // *(string)* -> *string*
        brackets.forEach(([l,r])=>{
            const regex = new RegExp(`^${ap}${l}(([^*\\n${l+r}]|${ta})+)${r}${ap}$`, "gm");
            text=text.replace(regex, `*$1*`);
        });

        //删除单符号行
        text = text
            .replace(new RegExp(
                `^[*${endsymbols.join('')}${[...brackets,...quotes].flat().join('')}](\\n|$)`,
            'gm'),"")//单符号
            .replace(new RegExp(
                `^(${[...brackets,...quotes].map(([l,r])=>l+r).join('|')})(\\n|$)`
            ,'gm'),"")//成对空括号
            .trim();

        //转换整行括号动作 ^(string)$ -> ^*string*$
        brackets.forEach(([l,r])=>{
            const regex = new RegExp(`^${l}([^\\n${l}${r}]+)${r}$`, "gm");
            text=text.replace(regex, `*$1*`);
        });

        quotes.forEach(([l,r])=>{
            //删除整段引号动作星号, 视为描述 ^*"string"*$ -> ^string$
            const regex1 = new RegExp(`^${ap}${l}(([^*\\n${l+r}]|${ta})+)${r}${ap}$`, "gm");
            text=text.replace(regex1, "$1");
            //转换星号内引号发言 ^*string:"string"*$ -> ^*string*\nstring$
            const regex2 = new RegExp(`^${ap}(([^*\\n]|${ta})+?)(:|：)${l}(([^*\\n${l+r}]|${ta})+)${r}${ap}$`, "gm");
            text=text.replace(regex2, "*$1*\n$4");
        });

        //整行匹配前运行过可能产新行的操作时需确保eachTrim
        eachTrim();

        //移除无效的动作符号
        //*string。* -> *string*
        //*string*， -> *string*
        const regex1 = new RegExp(`^${ap}(([^*\\n]|${ta})+)(${endsymbols.join('|')})${ap}$`, "gm");
        text=text.replace(regex1, `*$1*`);
        const regex2 = new RegExp(`^${ap}(([^*\\n]|${ta})+)${ap}(${endsymbols.join('|')})$`, "gm");
        text=text.replace(regex2, `*$1*`);
        //换行情况 *string*\n， -> *string*\n
        const regex3 = new RegExp(`^${ap}(([^*\\n]|${ta})+)${ap}\n(${endsymbols.join('|')})`, "gm");
        text=text.replace(regex3, `*$1*\n`);

        //整行匹配前运行过可能产新行的操作时需确保eachTrim
        eachTrim();
        //换行后可能产生新完整引号描述 "string" 行, 需要再次删除
        rmquotes();

        return text;
};

describe('regex', () => {
    it('应使3,4换行', () => {
        expect(regex(`*motion1*

desc2

*motion3*desc4

desc5
*motion6*
desc7
*motion8*
`)).toEqual(`*motion1*
desc2
*motion3*
desc4
desc5
*motion6*
desc7
*motion8*`);
    });
    it('应使除16,17,18外的换行', () => {
        expect(regex(`*motion1*

“desc2” *motion3* “desc4”

*motion5*

“desc6” *motion7* “desc8”

*motion9*
“desc10” *motion11*

“desc12” *motion13* “desc14”

*motion15*
“desc16” desc17 "desc18”

*motion19*
“desc20”

`)).toEqual(`*motion1*
desc2
*motion3*
desc4
*motion5*
desc6
*motion7*
desc8
*motion9*
desc10
*motion11*
desc12
*motion13*
desc14
*motion15*
“desc16” desc17 "desc18”
*motion19*
desc20`);
    });
    it('应移除6的星号后句号, 纠正7的双星',()=>{
        expect(regex(`*motion1*

*motion2*

desc3
*motion4*

“desc5"
*motion6*.
*motion7**`)).toEqual(`*motion1*
*motion2*
desc3
*motion4*
“desc5"
*motion6*
*motion7*`);
    });
    it('应纠正5,11的双星',()=>{
        expect(regex(`*motion1*
desc2
desc3
*motion4*
*motion5**
*motion6*
desc7
desc8
*motion9*
desc10
*motion11**`)).toEqual(`*motion1*
desc2
desc3
*motion4*
*motion5*
*motion6*
desc7
desc8
*motion9*
desc10
*motion11*`)
    });
    it('应填补7的左侧缺失星,去除所有星外括号',()=>{
        expect(regex(`*motion1*
desc2
(*motion3*)

*motion4*
desc5
*motion6*
motion7*
desc8
*motion9*

(*motion10*)
desc11
*motion12*

(*motion13*)
desc14
*motion15*
desc16
*motion17*
(*motion18*)

`)).toEqual(`*motion1*
desc2
*motion3*
*motion4*
desc5
*motion6*
*motion7*
desc8
*motion9*
*motion10*
desc11
*motion12*
*motion13*
desc14
*motion15*
desc16
*motion17*
*motion18*`)
    });
    it('应去除所有星内括号,并确保10不被拆分,确保17保持',()=>{
        expect(regex(`*(motion1)*
desc2
*(motion3)*
desc4

*motion5*
“desc6”
*(motion7)*
*motion8*
“desc9”
*(motion“motion”motion10)*
“desc11”
*(motion12)*
*motion13*
“desc14”
*(motion15)*

*motion16*
"desc17"，
*(motion18)*
“desc18”
*motion19*
desc20

*(motion21)*


`)).toEqual(`*motion1*
desc2
*motion3*
desc4
*motion5*
desc6
*motion7*
*motion8*
desc9
*motion“motion”motion10*
desc11
*motion12*
*motion13*
desc14
*motion15*
*motion16*
"desc17"，
*motion18*
desc18
*motion19*
desc20
*motion21*`);
    });
    it('应确保无效括号被删除,纯括号行被转为星号',()=>{
        expect(regex(`*motion1*
desc2
*motion3*

(motion4)
()
(desc5
desc6)`)).toEqual(`*motion1*
desc2
*motion3*
*motion4*
(desc5
desc6)`);
    });
    it('应确保2尾随的被转义的星号不被处理,填补3尾随星号,789换行',()=>{
        expect(regex(`*motion1* 
*motion2\\*motion3
*"desc4" *motion5* 
*motion"motion"motion6* 
"desc7" *motion8* "desc9" 
*motion10*`)).toEqual(`*motion1*
*motion2\\*motion3*
*"desc4" *
*motion5*
*motion"motion"motion6*
desc7
*motion8*
desc9
*motion10*`);
    });
    it('应确保234,6789换行,12不受影响',()=>{
        expect(regex(` *motion1*  
desc2(*motion3*) desc4  

*motion5*  
desc6(*motion7*) desc8(*motion9*)  

*motion10* desc11[motion12]desc13`)).toEqual(`*motion1*
desc2
*motion3*
desc4
*motion5*
desc6
*motion7*
desc8
*motion9*
*motion10*
desc11[motion12]desc13`);
    });
    it('应确保think块被移除,ASsISTANT前缀被移除',()=>{
        expect(regex(`<think>**thk1**

thk2


</think>

ASsISTANT: *motion1*

*motion2*

*motion“motion”、“motion”motion3*

*motion4*

“desc5”

*motion6*`)).toEqual(`*motion1*
*motion2*
*motion“motion”、“motion”motion3*
*motion4*
desc5
*motion6*`);
    });


    it(`应处理78星号内尾随`,()=>{
        expect(regex(`*motion1*

*motion2。*

*motion3。*

*“desc4！”*

*motion6。*

*motion7：“desc8！”*`)).toEqual(`*motion1*
*motion2*
*motion3*
desc4！
*motion6*
*motion7*
desc8！`)
    });

    //#region AI测试
    // 边界情况测试
    it('应处理空字符串', () => {
        expect(regex('')).toEqual('');
    });

    it('应处理只有空白字符的输入', () => {
        expect(regex('   \n\t\n   ')).toEqual('');
    });

    it('应处理只有换行符的输入', () => {
        expect(regex('\n\n\n')).toEqual('');
    });

    // Gemini末尾总结移除测试
    it('应移除Gemini末尾总结块', () => {
        expect(regex(`*motion1*
desc2

---
*既然已经了解了情况，我会继续帮助你*`)).toEqual(`*motion1*
desc2`);
    });

    it('应移除Gemini末尾总结块（无星号）', () => {
        expect(regex(`*motion1*
desc2

---
既然已经了解了情况，我会继续帮助你`)).toEqual(`*motion1*
desc2`);
    });

    // 多种括号混合测试
    it('应处理多种括号混合', () => {
        expect(regex(`*motion1*
(desc2)【desc3】[desc4]
*motion5*`)).toEqual(`*motion1*
*desc2*
*desc3*
*desc4*
*motion5*`);
    });

    // 嵌套引号测试
    it('应处理嵌套引号', () => {
        expect(regex(`"他说'你好'"
*motion1*`)).toEqual(`他说'你好'
*motion1*`);
    });

    // 特殊字符转义测试
    it('应正确处理转义星号', () => {
        expect(regex(`*motion1*
这是转义\\*不是动作
*motion2*`)).toEqual(`*motion1*
这是转义\\*不是动作
*motion2*`);
    });

    it('应正确处理多个转义星号', () => {
        expect(regex(`*motion1*
\\*\\*\\*
*motion2*`)).toEqual(`*motion1*
\\*\\*\\*
*motion2*`);
    });

    // 超长动作文本测试
    it('应处理超长动作文本', () => {
        const longMotion = 'a'.repeat(1000);
        expect(regex(`*${longMotion}*`)).toEqual(`*${longMotion}*`);
    });

    // 连续动作测试
    it('应处理连续多个动作', () => {
        expect(regex(`*motion1**motion2**motion3*`)).toEqual(`*motion1*
*motion2*
*motion3*`);
    });

    // 动作与标点混合测试
    it('应正确处理动作与各种标点', () => {
        expect(regex(`*motion1*，*motion2*。*motion3*；`)).toEqual(`*motion1*
*motion2*
*motion3*`);
    });

    // 只有动作星号的边界情况
    it('应处理只有单个星号', () => {
        expect(regex('*')).toEqual('');
    });

    it('应处理只有双星号', () => {
        expect(regex('**')).toEqual('**');
    });

    // 中文标点测试
    it('应正确处理中文标点', () => {
        expect(regex(`*motion1*。"desc2"`)).toEqual(`*motion1*
desc2`);
    });

    // 多行think块测试
    it('应处理多行think块', () => {
        expect(regex(`<think>
思考内容1
思考内容2
</think>
*motion1*`)).toEqual(`*motion1*`);
    });

    // 多个think块测试
    it('应处理多个think块', () => {
        expect(regex(`<think>思考1</think>
*motion1*
<think>思考2</think>
*motion2*`)).toEqual(`*motion1*
*motion2*`);
    });

    // 动作内包含特殊字符测试
    it('应处理动作内包含特殊字符', () => {
        expect(regex(`*motion@#$%^&*()`)).toEqual(`*motion@#$%^&*`);
    });

    // 只有引号的行测试
    it('应删除只有引号的行', () => {
        expect(regex(`*motion1*
"
"desc2"
*motion3*`)).toEqual(`*motion1*
desc2
*motion3*`);
    });

    // 混合大小写ASSISTANT测试
    it('应处理各种大小写的ASSISTANT前缀', () => {
        expect(regex(`ASSISTANT: *motion1*
assistant：*motion2*
Assistant: *motion3*`)).toEqual(`*motion1*
*motion2*
*motion3*`);
    });
    //#endregion
});