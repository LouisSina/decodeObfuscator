/*****************************************************
通用插件合集:

Module name:usefulPugins.js
Author:悦来客栈的老板
Date:2022.02.19
Version:V1.4.0



*****************************************************/
const babel = require("./babel_asttool.js");
const types = t;

//判断节点元素是否为字面量
//eg.  ++123,-456,"789";
function isBaseLiteral(path)
{
	if (path.isLiteral())
	{
		return true;
	}
	if (path.isUnaryExpression({operator:"-"}) || 
	    path.isUnaryExpression({operator:"+"}))
	{
		return isBaseLiteral(path.get('argument'));
	}
	
	return false;
}


//判断节点元素[Arrays]是否全部为字面量
function isElementsLiteral(path)
{
	let key = null;
	
	if (path.isArrayExpression())
	{
		key = "elements";
	}
	else if(path.isObjectExpression())
	{
		key = "properties";
	}
	else if(path.isCallExpression())
	{
		key = "arguments";
	}
	else
	{
		return isBaseLiteral(path);
	}
	
	let elements = path.get(key);
	
	if (elements.length == 0) return false;
	
	if (key == "properties")
	{
		return elements.every(element => isBaseLiteral(element.get("value")));
	}
	
	return elements.every(element=>isBaseLiteral(element));
}


//规范For循环和While循环
const standardLoop = 
{
	"ForStatement|WhileStatement"({node})
	{
		if(!types.isBlockStatement(node.body))
    {
    	node.body = types.BlockStatement([node.body]);
    }
  },
}

const resolveSequence = 
{
	SequenceExpression(path)
	{
		let {scope,parentPath,node} = path;
		let expressions = node.expressions;
		if (parentPath.isReturnStatement({"argument":node}))
		{
			let lastExpression = expressions.pop();
			for (let expression of expressions)
			{
				parentPath.insertBefore(types.ExpressionStatement(expression=expression));
			}
			
			path.replaceInline(lastExpression);
		}
		else if (parentPath.isExpressionStatement({"expression":node}))
		{
			let body = [];
			expressions.forEach(express=>{
            body.push(types.ExpressionStatement(express));
        });
      path.replaceInline(body);
		}
		else
		{
			return;
		}
		
		scope.crawl();
	}
}


const simplifyLiteral = {
	NumericLiteral({node}) {
		if (node.extra && /^0[obx]/i.test(node.extra.raw)) {
			node.extra = undefined;
		}
  },
  StringLiteral({node}) 
  {
  	if (node.extra && /\\[ux]/gi.test(node.extra.raw)) {
  		node.extra = undefined;
    }
  },
}



const constantFold = 
{
	  "BinaryExpression|UnaryExpression"(path)
    {
    	if(path.isUnaryExpression({operator:"-"}) || 
    	   path.isUnaryExpression({operator:"void"}))
    	{
    		return;
    	}
    	const {confident,value} = path.evaluate();
    	if (!confident || value == "Infinity") return;
    	path.replaceWith(types.valueToNode(value));
    },
}


//删除重复定义且未被改变初始值的变量
const deleteRepeatDefine = {
	"VariableDeclarator|FunctionDeclaration"(path)
	{
		let {node,scope,parentPath} = path;
		
		if (path.isFunctionDeclaration())
		{
			scope = parentPath.scope;
		}
		let name = node.id.name;
		const binding = scope.getBinding(name);
		if (path.isFunctionDeclaration())
		{
			if(!binding || binding.constantViolations.length > 1)
			{
				return;
			}
		}
    else
    {
    	if(!binding || !binding.constant) return;
    }
    
    scope.traverse(scope.block,{
    	VariableDeclarator(path)
    	{
    		let {node,scope} = path;
    		let {id,init} = node;
    		if (!types.isIdentifier(init,{name:name})) return;
    		
    		const binding = scope.getBinding(id.name);
    		
    		if (!binding || !binding.constant) return;
    	
    		scope.rename(id.name,name);
    		path.remove();
    	},
    })
    
    scope.crawl();     
	},
	 
}


const keyToLiteral = {
	MemberExpression:
	{
		exit({node})
		{
			const prop = node.property;
			if (!node.computed && types.isIdentifier(prop))
			{
				node.property = types.StringLiteral(prop.name);
				node.computed = true;
			}
    }
  },	
  ObjectProperty: 
  {
		exit({node})
		{
			const key = node.key;
			if (!node.computed && types.isIdentifier(key))
			{
				node.key = types.StringLiteral(key.name);
			}
		}
	},  
}

const preDecodeObject = {
	VariableDeclarator({node,parentPath,scope})
	{
		const {id,init} = node;
		if (!types.isObjectExpression(init)) return;
		let name = id.name;
		
		let properties = init.properties;
		let allNextSiblings = parentPath.getAllNextSiblings();
		for (let nextSibling of allNextSiblings)
		{
			if (!nextSibling.isExpressionStatement())  break;
			
			let expression = nextSibling.get('expression');
			if (!expression.isAssignmentExpression({operator:"="})) break;

			let {left,right} = expression.node;
			if (!types.isMemberExpression(left)) break;
			
			let {object,property} = left;
			if (!types.isIdentifier(object,{name:name}) ||
			    !types.isStringLiteral(property)) 
		  {
		  	break;
		  }
		  
			properties.push(types.ObjectProperty(property,right));
			nextSibling.remove();
		}	
		scope.crawl();	
	},
}

const SimplifyIfStatement = {
	"IfStatement"(path)
	{
		const consequent = path.get("consequent");
    const alternate = path.get("alternate");
    const test = path.get("test");
    const evaluateTest = test.evaluateTruthy();
    
    if (!consequent.isBlockStatement())
    {
    	consequent.replaceWith(types.BlockStatement([consequent.node]));
    }
		if (alternate.node !== null && !alternate.isBlockStatement())
		{
			alternate.replaceWith(types.BlockStatement([alternate.node]));
		}
		
		if (consequent.node.body.length == 0)
		{
			if (alternate.node == null)
			{
				path.replaceWith(test.node);
			}
			else
			{
				consequent.replaceWith(alternate.node);
				alternate.remove();
				path.node.alternate = null;
        test.replaceWith(types.unaryExpression("!", test.node, true));
			}
		}

		if (alternate.isBlockStatement() && alternate.node.body.length == 0)
		{
			alternate.remove();
			path.node.alternate = null;
		}
		
		if (evaluateTest === true)
		{
			path.replaceWithMultiple(consequent.node.body);
		} 
		else if (evaluateTest === false)
		{ 
			alternate.node === null? path.remove():path.replaceWithMultiple(alternate.node.body);
		}
  },
}

const removeDeadCode = {
	"IfStatement|ConditionalExpression"(path)
	{
		let {consequent,alternate} = path.node;
		let testPath = path.get('test');
		const evaluateTest = testPath.evaluateTruthy();
		if (evaluateTest === true)
		{
			if (types.isBlockStatement(consequent))
			{
				consequent = consequent.body;
			}
			path.replaceWithMultiple(consequent);
		}
		else if (evaluateTest === false)
		{
			if (alternate != null)
			{
				if (types.isBlockStatement(alternate))
			  {
			  	alternate = alternate.body;
			  }
				path.replaceWithMultiple(alternate);
			}
			else
			{
				path.remove();
			}
		}  		
	},
  EmptyStatement(path)
  {
  	path.remove();
  },  
  "VariableDeclarator"(path)
	{
		let {node,scope,parentPath} = path;
		let binding =  scope.getBinding(node.id.name);	
		if (binding && !binding.referenced && binding.constant)
		{//没有被引用，也没有被改变
			path.remove();
		}
	},
	
}

global.types              = types;
global.parser             = parser;
global.traverse           = traverse;
global.generator           = generator;
global.isBaseLiteral      = isBaseLiteral;
global.constantFold       = constantFold;
global.keyToLiteral       = keyToLiteral;
global.standardLoop       = standardLoop;
global.removeDeadCode     = removeDeadCode;
global.preDecodeObject    = preDecodeObject;
global.simplifyLiteral    = simplifyLiteral;
global.resolveSequence    = resolveSequence;
global.isElementsLiteral  = isElementsLiteral;
global.deleteRepeatDefine = deleteRepeatDefine;
global.SimplifyIfStatement = SimplifyIfStatement;

