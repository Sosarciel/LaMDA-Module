import { TextFormatter } from "@sosraciel-lamda/text-processor";

//const regex = (text:string)=> createMarkdownFixPipe().process(TextFormatter.clearFormat(text));
const regex = (text:string)=> TextFormatter.fixMarkdown(TextFormatter.clearFormat(text));

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

    it(`应处理1星号内尾随`,()=>{
        expect(regex(`*motion1:*
desc2`)).toEqual(`*motion1*
desc2`)
    });

    it('应正确处理所有尾随句号与换行尾随句号', () => {
        expect(regex(`*motion1*
。"desc2"*motion3*。"desc4"`)).toEqual(`*motion1*
desc2
*motion3*
desc4`);
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