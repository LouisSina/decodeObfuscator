/*****************************************************
Module name:main.js
Author:悦来客栈的老板
Date:2022.04.06


混淆工具地址:https://obfuscator.io/

脚本仅用于被obfuscator混淆了的代码，不支持商业工具混淆的代码

声明:

脚本仅用于学习研究，禁止非法使用，否则后果自负！


使用方法可以观看在线视频:

https://www.bilibili.com/video/BV16V411H7yz

*****************************************************/

const fs               = require('fs');
const usefulPlugins    = require("./tools/usefulPlugins");
const decodeObfuscator = require("./tools/decodeOb");


//js混淆代码读取
process.argv.length > 2 ? encodeFile = process.argv[2]: encodeFile ="./input/demo.js";
process.argv.length > 3 ? decodeFile = process.argv[3]: decodeFile ="./output/decodeResult.js";

//将源代码解析为AST
let sourceCode = fs.readFileSync(encodeFile, {encoding: "utf-8"});
let ast    = parser.parse(sourceCode);

console.time("处理完毕，耗时");


//字面量解混淆
console.log("traverse Hex or Unicode String.......");

traverse(ast, simplifyLiteral);

console.log("constantFold.......");

traverse(ast, constantFold);

console.log("delete Repeat Define.......");

traverse(ast, deleteRepeatDefine);

traverse(ast, SimplifyIfStatement);

traverse(ast, standardLoop);

console.log("resolve Sequence.......");

traverse(ast, resolveSequence);

console.log("traverse CallExpress To ToLiteral.......");

traverse(ast, CallExpressToLiteral);

console.log("constantFold.......");

traverse(ast, constantFold);


//object key值Literal
console.log("Object Preconditioning .......");

traverse(ast, keyToLiteral);

traverse(ast, preDecodeObject);

//处理object

console.log("Object Decode .......");


traverse(ast, decodeObject);


console.log("Control Flow Decoding.......\n");

traverse(ast, decodeControlFlow);

console.log("constantFold.......");

traverse(ast, constantFold);

console.log("remove Dead Code.......\n");

traverse(ast, removeDeadCode);

ast = parser.parse(generator(ast).code);

traverse(ast, removeDeadCode);

traverse(ast, simplifyLiteral);


//可能会误删一些代码，可屏蔽
traverse(ast, deleteObfuscatorCode);


console.timeEnd("处理完毕，耗时");

let {code} = generator(ast,opts = {jsescOption:{"minimal":true}});

fs.writeFile(decodeFile, code, (err) => {});