
function getReDefineFunction(scope,funcNames)
{
	decodeCode = "";
	scope.traverse(scope.block,{
			"FunctionDeclaration"(path)
			{
				let {id,body} = path.node;
				body = body.body;
				if (!body || body.length != 1 || 
				    !types.isReturnStatement(body[0]))
				{
					return;
				}
				let argument = body[0].argument;
				if (!types.isCallExpression(argument) || 
				    !types.isIdentifier(argument.callee))
				{
					return;
				}
				decodeCode += path.toString();
				funcNames.push(id.name);
				path.remove();
			},
	})
	return decodeCode;
}

//获取 Obfuscator 混淆的特征paths，大数组 + 自执行函数 + 解密函数
function getOldObPaths(path,funcNames)
{
	
	let {scope,node,parentPath} = path;
	if (parentPath.node.declarations.length != 1)
	{
		return;
	}
	let {id,init}   = node;
	let name = id.name;
	let binding = scope.getBinding(name);
	let {constant,referencePaths} = binding;
	if (!constant || referencePaths.length < 2) 
	{
		return;
	}
	let nextPath = parentPath.getNextSibling();
	if (!nextPath.isExpressionStatement())
	{
		return;
	}
	
	let thirdPath = nextPath.getNextSibling();
	if (!thirdPath.isVariableDeclaration())
	{
		return;
	}
	
	let {declarations} = thirdPath.node;
	if (declarations.length != 1) return;
	
	{
		let {id,init} = declarations[0];
		if (!types.isFunctionExpression(init))
		{
			return;
		}
		funcNames.push(id.name);
		let obfuscatorPaths = [path];
		obfuscatorPaths.push(nextPath);
		obfuscatorPaths.push(thirdPath);
		return obfuscatorPaths;
	}
	

	
}


function getNewObPaths(path, funcNames)
{
	let functionParent = path.getFunctionParent();
	if (!functionParent) return;
	let {node,scope} = functionParent;
	let name = node.id.name;
	let binding = scope.parent.getBinding(name);
	if (!binding || binding.referencePaths.length < 2)
	{
		return;
	}
	
	
	let {referencePaths} = binding;
	let obfuscatorPaths = [functionParent];
	

	
	for (const referPath of referencePaths)
	{
		let AncestorPath = referPath.findParent(p => p.isFunctionDeclaration()) || 
		                   referPath.findParent(p => p.isCallExpression());
		if (!AncestorPath)
		{
			return;
		}
		
		let {node,parentPath} = AncestorPath;
		
		
		if (AncestorPath.isFunctionDeclaration())
		{
			funcNames.push(AncestorPath.get('id').node.name);
		}
		else
		{
			let {arguments} = node;
			if (arguments.length < 2 || !types.isIdentifier(arguments[0],{name:name}) || 
			   !types.isNumericLiteral(arguments[1]))
			{
				return;
			}
			if(!AncestorPath.parentPath.isExpressionStatement({expression:node}))
			{
				return;
			}
			AncestorPath = parentPath;
		}
		if (obfuscatorPaths.includes(AncestorPath))
		{
			continue;
		}
		

			  
		obfuscatorPaths.push(AncestorPath);		
	}
	
	return obfuscatorPaths;	
}

const CallExpressToLiteral = 
{
	VariableDeclarator(path) 
	{
		let {scope,node} = path;
		let {id,init} = node;
		if (!types.isArrayExpression(init) ||
		    !init.elements.every(element => types.isStringLiteral(element)))
		{
			return;
		}
		
		let binding = scope.getBinding(id.name);
		if (!binding || !binding.constant)
		{
			return;
		}
		let obfuscatorPaths,funcNames = [];
		if (binding.referencePaths.length == 1)
		{
			let referPath = binding.referencePaths[0];
			let {node,parentPath} = referPath;
			if (!parentPath.isReturnStatement({argument:node}))
			{
				return;
			}
			obfuscatorPaths = getNewObPaths(path, funcNames);
			scope = path.getFunctionParent().parentPath.scope;
		}
		else
		{
			obfuscatorPaths = getOldObPaths(path, funcNames);
		}
		
    if (!obfuscatorPaths || obfuscatorPaths.length < 3) return;
    
    let obfuscatorCode = "";
    obfuscatorPaths.forEach(eachPath => {obfuscatorCode += eachPath.toString() + ";\n"});
    obfuscatorCode += getReDefineFunction(scope,funcNames);
    
    let funcAst = parser.parse(obfuscatorCode);
	  obfuscatorCode = generator(funcAst,opts = {"compact":true}).code;

    eval(obfuscatorCode);
    
    let canRemoved = false;
    scope.traverse(scope.block, {
       "CallExpression"(path) 
       {
       	let node = path.node;
        let {callee, arguments} = node;
        if (!types.isIdentifier(callee) || 
            !funcNames.includes(callee.name) ||
            !isElementsLiteral(path)) 
        {
        	return;
        }
        
        canRemoved = true;

        let value = eval(path.toString());
        console.log(path.toString(), "-->", value);
        path.replaceWith(types.valueToNode(value));
       },
       
    });
    
    if (canRemoved)
    {
    	//直接删除，如果不能删除，请屏蔽该行。
    	obfuscatorPaths.forEach(eachPath => {eachPath.remove();});   	
    }
  },
}



function savePropertiesToObject(properties,newMap)
{
	for (const property of properties)
	{
		let propKey   = property.key.value;
		let propValue = property.value;
		if (types.isStringLiteral(propValue))
		{
			newMap.set(propKey,propValue.value);
		}
		else if (types.isFunctionExpression(propValue))
		{
			let retState = propValue.body.body;
			if (retState.length == 1 && types.isReturnStatement(retState[0]))
			{
				let argument = retState[0].argument;
				if (types.isCallExpression(argument))
				{
					newMap.set(propKey,"Call");
				}
				else if (types.isBinaryExpression(argument) || 
							   types.isLogicalExpression(argument))
				{
					newMap.set(propKey,argument.operator);
				}
			}
		}
		else
		{
			break;
		}
	}
}

function replaceReferNode(newMap,referencePaths,scope)
{
	for (const referPath of referencePaths)
	{
		let {node,parent,parentPath} = referPath;
		let ancestorPath = parentPath.parentPath;
		if (!parentPath.isMemberExpression({object:node})) 
		{
			continue;
		}
		let {property} = parent;
		let propKey = property.value;
		let propValue = newMap.get(propKey);
		if (!propValue) 
		{
			continue;
		}

		
		if (ancestorPath.isCallExpression({callee:parent}))
		{
			let {arguments} = ancestorPath.node;
			switch (propValue) {
					case "Call":
						 ancestorPath.replaceWith(types.CallExpression(arguments[0], arguments.slice(1)));
						 break;
					case "||":
					case "&&":
						 ancestorPath.replaceWith(types.LogicalExpression(propValue, arguments[0], arguments[1]));
						 break;
					default:
						 ancestorPath.replaceWith(types.BinaryExpression(propValue, arguments[0], arguments[1]));
						 break; 
			}
		}
		else
		{
			parentPath.replaceWith(types.valueToNode(propValue));
		}
		
		scope.crawl();
	}	
}


const decodeObject = {
	VariableDeclarator({node,scope})
	{
		const {id,init} = node;
		if (!types.isObjectExpression(init)) return;
		let name = id.name;

		let binding =  scope.getBinding(name);
		let {constant,referencePaths} = binding;
		if (!constant) return;

		let properties = init.properties;
		if (properties.length == 0) return;
		
		let newMap = new Map();
		savePropertiesToObject(properties,newMap); 
		if (newMap.size != properties.length) return;
		
		replaceReferNode(newMap,referencePaths,scope);
		
		newMap.clear();
	},
}


//去控制流
const decodeControlFlow = {
	
	WhileStatement(path)
	{
		const {node,scope} = path;
		const {test,body}  = node;
		if (!types.isLiteral(test,{value:true})) return;
		if (body.body.length != 2) return;
		let switchNode = body.body[0],breakNode = body.body[1];
		if (!types.isSwitchStatement(switchNode) || 
		    !types.isBreakStatement(breakNode))
		{
			return;
		}
		let {discriminant,cases} = switchNode;
		if (!types.isMemberExpression(discriminant)) return;
		let {object,property} = discriminant;
		if (!types.isIdentifier(object) || !types.isUpdateExpression(property)) return;
		
		let arrName = object.name;
		let binding =  scope.getBinding(arrName);
		if (!binding || !binding.path || !binding.path.isVariableDeclarator()) return;
		let {id,init} = binding.path.node; 
		if (!types.isCallExpression(init) || !types.isMemberExpression(init.callee)) return;
		object   = init.callee.object;
		property = init.callee.property;
		if (!types.isStringLiteral(object) || !types.isStringLiteral(property,{value:"split"})) 
		{
			return;
		}
		
		let disPatchArray = object.value.split("|");
		let retBody = [];
		disPatchArray.forEach(index =>
		{
			let caseBody = cases[index].consequent;
			if (types.isContinueStatement(caseBody[caseBody.length-1]))
			{
				caseBody.pop();
			}
			retBody = retBody.concat(caseBody);
		})
		
		path.replaceWithMultiple(retBody);
	},
}




const deleteObfuscatorCode = 
{
	VariableDeclarator(path)
	{
		let sourceCode = path.toString();
		let {id,init} = path.node;
		if (types.isCallExpression(init))
		{
			let {callee,arguments} = init;
			if (arguments.length == 0 && sourceCode.includes("apply"))
			{
				path.remove();
			}
			else if((sourceCode.includes("constructor") || sourceCode.includes("RegExp")) &&
				     types.isIdentifier(callee) && arguments.length == 2 && 
				     types.isThisExpression(arguments[0]) &&
				     types.isFunctionExpression(arguments[1]))
			{
				let funcName = id.name;
				
				let nextSibling = path.parentPath.getNextSibling();
				if (nextSibling.isExpressionStatement())
				{
					let expression = nextSibling.get("expression");
					
					if (expression.isCallExpression() && expression.get("callee").isIdentifier({name:funcName}))
					{
						path.remove();
						nextSibling.remove();
					}
				}
			}
		}
	},
	ExpressionStatement(path)
	{
		let sourceCode = path.toString();
		if (!sourceCode.includes("RegExp") && !sourceCode.includes("chain"))
		{
			return;
		}
		
		let {expression} = path.node;
		if (!types.isCallExpression(expression))
		{
			return;
		}
		let {callee,arguments} = expression;
		
		if (!types.isFunctionExpression(callee) || arguments.length != 0)
		{
			return;
		}
		
		let body = callee.body.body;
		if (body.length != 1 || !types.isExpressionStatement(body[0]))
		{
			return;
		}
		expression = body[0].expression;
		if (!types.isCallExpression(expression))
		{
			return;
		}		
		callee = expression.callee;
		arguments = expression.arguments;
		
		if (!types.isCallExpression(callee) || arguments.length != 0)
		{
			return;
		}
		arguments = callee.arguments;
		if(arguments.length == 2 && 
			types.isThisExpression(arguments[0]) &&
			types.isFunctionExpression(arguments[1]))
		{
			path.remove();
		}
	},
	CallExpression(path)
	{
		let {scope,node} = path;
		let {callee,arguments} = node;
		
		let sourceCode = path.toString();
		if (arguments.length == 0 && sourceCode.includes("constructor") &&
		    sourceCode.includes("setInterval"))
		{
			path.remove();
			return;
		}

		
		if (!types.isIdentifier(callee,{name:"setInterval"}))
		{
			return;
		}
		if (arguments.length != 2 || !types.isFunctionExpression(arguments[0]) ||
		    !types.isNumericLiteral(arguments[1]))
		{
			return;
		}
		
		let body = arguments[0].body.body;
		if (body.length != 1 || !types.isExpressionStatement(body[0]))
		{
			return;
		}
		expression = body[0].expression;
		if (!types.isCallExpression(expression))
		{
			return;
		}
		callee = expression.callee;
		arguments = expression.arguments;
		
		if (!types.isIdentifier(callee) || arguments.length != 0)
		{
			return;
		}
		
		let binding =  scope.getBinding(callee.name);
		if (!binding || !binding.path)
		{
			return;
		}
		
		sourceCode = binding.path.toString();
		if (sourceCode.includes("constructor") || 
		    sourceCode.includes("debugger"))
		{
			path.remove();
			binding.path.remove();
		}
	},
	FunctionDeclaration(path)
	{
		let {body} = path.node.body;
		if (body.length == 2 && types.isFunctionDeclaration(body[0]) &&
		   types.isTryStatement(body[1]))
		{
			let sourceCode = path.toString();
			if (sourceCode.includes("constructor") &&
			    sourceCode.includes("debugger") &&
			    sourceCode.includes("apply"))
			{
				path.remove();
			}
		}
	},
}

global.CallExpressToLiteral =  CallExpressToLiteral;
global.decodeObject = decodeObject;
global.decodeControlFlow = decodeControlFlow;
global.deleteObfuscatorCode = deleteObfuscatorCode;
