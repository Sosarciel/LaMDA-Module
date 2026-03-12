const regex = (text:string)=> {
        //移除think标签与特殊格式
        text = text.replace(/<think>[\s\S]*?<\/think>/g, "");
        text = text.replace(/\s*ASSISTANT(:|：)\s*/gi,'');
        //移除gemini末尾总结
        text = text.replace(/\s*\n---\s*\*?\*?既然[\s\S]+/,'');

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
        const actRegex = new RegExp(`\\n?(${ap}([^*\\n]|${ta})+?${ap})\\n?`,'g');
        text = text.replace(actRegex, "\n$1\n").trim();

        //动作换行后产生新行, 再次尝试修复
        fixstart();
        eachTrim();

        //删除无效成对前引号 ^"string"$ -> ^string$
        quotes.forEach(([l,r])=>{
            const regex = new RegExp(`^${l}([^\\n${l+r}]+)${r}$`, "gm");
            text=text.replace(regex, "$1");
        });
        //删除星号内括号 *(string)* -> *string*
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

        //删除整段引号动作星号, 视为描述 ^*"string"*$ -> ^string$
        quotes.forEach(([l,r])=>{
            const regex = new RegExp(`^${ap}${l}(([^*\\n${l+r}]|${ta})+)${r}${ap}$`, "gm");
            text=text.replace(regex, "$1");
        });

        //移除无效的动作符号
        //*string。* -> *string*
        //*string*， -> *string*
        endsymbols.forEach(s=>{
            const regex1 = new RegExp(`^${ap}(([^*\\n]|${ta})+)(${endsymbols.join('|')})${ap}$`, "gm");
            text=text.replace(regex1, `*$1*`);
            const regex2 = new RegExp(`^${ap}(([^*\\n]|${ta})+)${ap}(${endsymbols.join('|')})$`, "gm");
            text=text.replace(regex2, `*$1*`);
        });
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
});