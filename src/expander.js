/*
  Copyright (C) 2012 Tim Disney <tim@disnet.me>

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
  ARE DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
  DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
  (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
  LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
  ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
  THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/


(function (root, factory) {
    if (typeof exports === 'object') {
        // CommonJS
        factory(exports, require('underscore'), require('./parser'), require('./syntax'), require("es6-collections"), require('escodegen'), require('contracts-js'));
    } else if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define(['exports', 'underscore', 'parser', 'syntax', 'es6-collections', 'escodegen', 'contracts-js'], factory);
    }
}(this, function(exports, _, parser, syntax, es6, codegen, contracts) {
    'use strict';

    macro _get_vars {
	    rule { $val { } } => { }
	    rule {
		    $val {
			    $proto($field (,) ...) => { $body ... }
			    $rest ...
		    }
	    } => {
		    $(var $field = $val.$field;) ...
		        _get_vars $val { $rest ... }
	    }
	    rule {
		    $val {
			    $proto($field (,) ...) | $guard:expr => { $body ... }
			    $rest ...
		    }
	    } => {
		    $(var $field = $val.$field;) ...
		        _get_vars $val { $rest ... }
	    }
    }

    macro _case {
	    rule { $val else {} } => {}
	    
	    rule {
		    $val else {
			default => { $body ... }
		    }
	    } => {
		    else {
			    $body ...
		    }
	    }
	    
	    rule {
		    $val else {
			    $proto($field (,) ...) => { $body ... }
			    $rest ...
		    }
	    } => {
		    else if($val.hasPrototype($proto)) {
			    $body ...
		    }
		    _case $val else { $rest ... }
	    }
	    
	    rule {
		    $val else {
			    $proto($field (,) ...) | $guard:expr => { $body ... }
			    $rest ...
		    }
	    } => {
		    else if($val.hasPrototype($proto) && $guard) {
			    $body ...
		    }
		    _case $val else { $rest ... }
	    }
	    
	    rule {
		    $val {
			    $proto($field ...) => { $body ... }
			    $rest ...
		    }
	    } => {
		    if ($val.hasPrototype($proto)) {
			    $body ...
		    }
		    _case $val else { $rest ... }
	    }
	    
	    rule {
		    $val {
			    $proto($field ...) | $guard:expr => { $body ... }
			    $rest ...
		    }
	    } => {
		    if($val.hasPrototype($proto) && $guard) {
			    $body ...
		    }
		    _case $val else { $rest ... }
	    }
    }

    macro case {
	    rule {
		    $val {
			    $proto($field (,) ...) => { $body ... }
			    $rest ...
		    }
	    } => {
		    _get_vars $val { $proto($field ...) => { $body ... } $rest ... }
		    _case $val { $proto($field (,) ...) => { $body ... } $rest ... }
	    }
	    
	    rule {
		    $val {
			    $proto($field (,) ...) | $guard:expr => { $body ... }
			    $rest ...
		    }
	    } => {
		    _get_vars $val { $proto($field ...) | $guard => { $body ... } $rest ... }
		    _case $val { $proto($field (,) ...) | $guard => { $body ... } $rest ... }
	    }
    }

    
    setupContracts(contracts);
    // used to export "private" methods for unit testing
    exports._test = {};

    // some convenience monkey patching
    Object.prototype.create = function() {
        var o = Object.create(this);
        if (typeof o.construct === "function") {
            o.construct.apply(o, arguments);
        }
        return o;
    };

    Object.prototype.extend = function(properties) {
        var result = Object.create(this);
        for (var prop in properties) {
            if (properties.hasOwnProperty(prop)) {
                result[prop] = properties[prop];
            }
        }
        return result;
    };

    Object.prototype.hasPrototype = function(proto) {
        function F() {}
        F.prototype = proto;
        return this instanceof F;
    };

    // todo: add more message information
    function throwError(msg) {
        throw new Error(msg);
    }


    mkContract (CToken, {
        type: ?Num
        value: ?(Num or Str)
    });

    mkContract (CContext, {
        name: ?Num,
        dummy_name: ?Num,
        context: Self
    });

    mkContract (CSyntax, {
        token: CToken,
        context: Null or CContext
    });



    var Rename = syntax.Rename;
    var Mark = syntax.Mark;
    var Var = syntax.Var;
    var Def = syntax.Def;
    var isDef = syntax.isDef;
    var isMark = syntax.isMark;
    var isRename = syntax.isRename;

    var syntaxFromToken = syntax.syntaxFromToken;
    var mkSyntax = syntax.mkSyntax;


    function remdup(mark, mlist) {
        if (mark === _.first(mlist)) {
            return _.rest(mlist, 1);
        }
        return [mark].concat(mlist);
    }

    // (CSyntax) -> [...Num]
    function marksof(ctx, stopName, originalName) {
        var mark, submarks;

        if (isMark(ctx)) {
            mark = ctx.mark;
            submarks = marksof(ctx.context, stopName, originalName);
            return remdup(mark, submarks);
        }
        if(isDef(ctx)) {
            return marksof(ctx.context, stopName, originalName);
        }
        if (isRename(ctx)) {
            if(stopName === originalName + "$" + ctx.name) {
                return [];
            }
            return marksof(ctx.context, stopName, originalName);
        }
        return [];
    }

    function resolve(stx) {
        return resolveCtx(stx.token.value, stx.context, [], []);
    }


    function arraysEqual(a, b) {
        if(a.length !== b.length) {
            return false;
        }
        for(var i = 0; i < a.length; i++) {
            if(a[i] !== b[i]) {
                return false;
            }
        }
        return true;
    }

    function renames(defctx, oldctx, originalName) {
        var acc = oldctx;
        defctx.forEach(function(def) {
            if(def.id.token.value === originalName) {
                acc = Rename(def.id, def.name, acc, defctx);
            }
        });
        return acc;
    }

    // (Syntax) -> String
    function resolveCtx(originalName, ctx, stop_spine, stop_branch) {
        if (isMark(ctx)) {
            return resolveCtx(originalName, ctx.context, stop_spine, stop_branch);
        }
        if (isDef(ctx)) {
            if (_.contains(stop_spine, ctx.defctx)) {
                return resolveCtx(originalName, ctx.context, stop_spine, stop_branch);   
            } else {
                return resolveCtx(originalName, 
                    renames(ctx.defctx, ctx.context, originalName), 
                    stop_spine,
                    _.union(stop_branch, [ctx.defctx]));
            }
        }
        if (isRename(ctx)) {
            var idName = resolveCtx(ctx.id.token.value, 
                ctx.id.context, 
                stop_branch,
                stop_branch);
            var subName = resolveCtx(originalName, 
                ctx.context,
                _.union(stop_spine,[ctx.def]),
                stop_branch);

            if(idName === subName) {
                var idMarks = marksof(ctx.id.context, originalName + "$" + ctx.name, originalName);
                var subMarks = marksof(ctx.context, originalName + "$" + ctx.name, originalName);
                if(arraysEqual(idMarks, subMarks)) {
                    return originalName + "$" + ctx.name;
                }
            }
            return resolveCtx(originalName, ctx.context, _.union(stop_spine,[ctx.def]), stop_branch);
        }
        return originalName;
    }

    var nextFresh = 0;

    // fun () -> Num
    function fresh() { return nextFresh++; };


    // ([...CSyntax]) -> [...CToken]
    function syntaxToTokens(syntax) {
        return _.map(syntax, function(stx) {
            if (stx.token.inner) {
                stx.token.inner = syntaxToTokens(stx.token.inner);
            }
            return stx.token;
        });
    }


    // CToken -> Bool
    // fun (CToken) -> Bool
    function isPatternVar(token) {
        return token.type === parser.Token.Identifier &&
                token.value[0] === "$" &&   // starts with $
                token.value !== "$";        // but isn't $
    }


    var containsPatternVar = function(patterns) {
        return _.any(patterns, function(pat) {
            if (pat.token.type === parser.Token.Delimiter) {
                return containsPatternVar(pat.token.inner);
            }
            return isPatternVar(pat);
        });
    };

    // ([...CSyntax]) -> [...CPattern]
    function loadPattern(patterns) {

        return _.chain(patterns)
            // first pass to merge the pattern variables together
            .reduce(function(acc, patStx, idx) {
                var last = patterns[idx-1];
                var lastLast = patterns[idx-2];
                var next = patterns[idx+1];
                var nextNext = patterns[idx+2];

                // skip over the `:lit` part of `$x:lit`
                if (patStx.token.value === ":") {
                    if(last && isPatternVar(last.token)) {
                        return acc;
                    }
                }
                if (last && last.token.value === ":") {
                    if (lastLast && isPatternVar(lastLast.token)) {
                        return acc;
                    }
                }
                // skip over $
                if (patStx.token.value === "$" && next && next.token.type === parser.Token.Delimiter) {
                    return acc;
                }

                if (isPatternVar(patStx.token)) {
                    if (next && next.token.value === ":" ) {
                        parser.assert(typeof nextNext !== 'undefined', "expecting a pattern class");
                        patStx.class = nextNext.token.value;
                    } else {
                        patStx.class = "token";
                    }
                } else if (patStx.token.type === parser.Token.Delimiter) {
                    if (last && last.token.value === "$") {
                        patStx.class = "pattern_group";
                    }
                    patStx.token.inner = loadPattern(patStx.token.inner);
                } else {
                    patStx.class = "pattern_literal";
                }
                return acc.concat(patStx);
            // then second pass to mark repeat and separator
            }, []).reduce(function(acc, patStx, idx, patterns) {
                var separator = " ";
                var repeat = false;
                var next = patterns[idx+1];
                var nextNext = patterns[idx+2];

                if (next && next.token.value === "...") {
                    repeat = true;
                    separator = " ";
                } else if (delimIsSeparator(next) && nextNext && nextNext.token.value === "...") {
                    repeat = true;
                    parser.assert(next.token.inner.length === 1, "currently assuming all separators are a single token");
                    separator = next.token.inner[0].token.value;
                }

                // skip over ... and (,)
                if (patStx.token.value === "..."||
                        (delimIsSeparator(patStx) && next && next.token.value === "...")) {
                    return acc;
                }
                patStx.repeat = repeat;
                patStx.separator = separator;
                return acc.concat(patStx);
            }, []).value();
    }


    // take the line context (not lexical...um should clarify this a bit)
    // (CSyntax, [...CSyntax]) -> [...CSyntax]
    function takeLineContext(from, to) {
        // todo could be nicer about the line numbers...currently just
        // taking from the macro name but could also do offset
        return _.map(to, function(stx) {
            if (stx.token.type === parser.Token.Delimiter) {
                return syntaxFromToken({
                    type: parser.Token.Delimiter,
                    value: stx.token.value,
                    inner: stx.token.inner,
                    startRange: from.range,
                    endRange: from.range,
                    startLineNumber: from.token.lineNumber,
                    startLineStart: from.token.lineStart,
                    endLineNumber: from.token.lineNumber,
                    endLineStart: from.token.lineStart
                }, stx.context);
            }
            return syntaxFromToken({
                    value: stx.token.value,
                    type: stx.token.type,
                    lineNumber: from.token.lineNumber,
                    lineStart: from.token.lineStart,
                    range: from.token.range
                }, stx.context);
        });
    }

    // ([...{level: Num, match: [...CSyntax]}], Str) -> [...CSyntax]
    function joinRepeatedMatch(tojoin, punc) {
        return _.reduce(_.rest(tojoin, 1), function(acc, join) {
            if (punc === " ") {
                return acc.concat(join.match);
            }
            return acc.concat(mkSyntax(punc, parser.Token.Punctuator, _.first(join.match)), join.match);
        }, _.first(tojoin).match);
    }
    // ([...CSyntax], Str) -> [...CSyntax])
    function joinSyntax(tojoin, punc) {
        if (tojoin.length === 0) { return []; }
        if (punc === " ") { return tojoin; }

        return _.reduce(_.rest(tojoin, 1), function (acc, join) {
            return acc.concat(mkSyntax(punc, parser.Token.Punctuator, join), join);
        }, [_.first(tojoin)]);
    }

    // ([...[...CSyntax]], Str) -> [...CSyntax]
    function joinSyntaxArr(tojoin, punc) {
        if (tojoin.length === 0) { return []; }
        if (punc === " ") {
            return _.flatten(tojoin, true);
        }

        return _.reduce(_.rest(tojoin, 1), function (acc, join){
            return acc.concat(mkSyntax(punc, parser.Token.Punctuator, _.first(join)), join);
        }, _.first(tojoin));
    }

    // (CSyntax) -> Bool
    function delimIsSeparator(delim) {
        return (delim && delim.token.type === parser.Token.Delimiter &&
                delim.token.value === "()"&&
                delim.token.inner.length === 1 &&
                delim.token.inner[0].token.type !== parser.Token.Delimiter &&
                !containsPatternVar(delim.token.inner));
    }

    // ([...CSyntax]) -> [...Str]
    function freeVarsInPattern(pattern) {
        var fv = [];

        _.each(pattern, function (pat) {
            if (isPatternVar(pat.token)) {
                fv.push(pat.token.value);
            } else if (pat.token.type === parser.Token.Delimiter) {
                fv = fv.concat(freeVarsInPattern(pat.token.inner));
            }
        });

        return fv;
    }

    // ([...CSyntax]) -> Num
    function patternLength (patterns) {
        return _.reduce(patterns, function(acc, pat) {
            if (pat.token.type === parser.Token.Delimiter) {
                // the one is to include the delimiter itself in the count
                return acc + 1 + patternLength(pat.token.inner);
            }
            return acc + 1;
        }, 0);
    }

    // wraps the array of syntax objects in the delimiters given by the second argument
    // ([...CSyntax], CSyntax) -> [...CSyntax]
    function wrapDelim(towrap, delimSyntax) {
        parser.assert(delimSyntax.token.type === parser.Token.Delimiter, "expecting a delimiter token");

        return syntaxFromToken({
            type: parser.Token.Delimiter,
            value: delimSyntax.token.value,
            inner: towrap,
            range: delimSyntax.token.range,
            startLineNumber: delimSyntax.token.startLineNumber,
            lineStart: delimSyntax.token.lineStart
        }, delimSyntax.context);
    }

    // (CSyntax) -> [...CSyntax]
    function getParamIdentifiers(argSyntax) {
        parser.assert(argSyntax.token.type === parser.Token.Delimiter,
            "expecting delimiter for function params");
        return _.filter(argSyntax.token.inner, function(stx) {
            return stx.token.value !== ",";
        });
    }



    // A TermTree is the core data structure for the macro expansion process.
    // It acts as a semi-structured representation of the syntax.
    var TermTree = {

        // Go back to the flat syntax representation. Uses the ordered list
        // of properties that each subclass sets to determine the order that multiple
        // children are destructed.
        // The breakDelim param is used to determine if we just want to
        // unwrap to the ReadTree level or actually flatten the
        // delimiters too.
        // (Bool?) -> [...Syntax]
        destruct: function(breakDelim) {
            return _.reduce(this.properties, _.bind(function(acc, prop) {
                if (this[prop] && this[prop].hasPrototype(TermTree)) {
                    return acc.concat(this[prop].destruct(breakDelim));
                } else if (this[prop]) {
                    return acc.concat(this[prop]);
                } else {
                    return acc;
                }
            }, this), []);
        }
    };

    var EOF = TermTree.extend({
        properties: ["eof"],

        construct: function(e) { this.eof = e; }
    });


    var Statement = TermTree.extend({ construct: function() {} });

    var Expr = TermTree.extend({ construct: function() {} });
    var PrimaryExpression = Expr.extend({ construct: function() {} });

    var ThisExpression = PrimaryExpression.extend({
        properties: ["this"],

        construct: function(that) { this.this = that; }
    });

    var Lit = PrimaryExpression.extend({
        properties: ["lit"],

        construct: function(l) { this.lit = l; }
    });

    exports._test.PropertyAssignment = PropertyAssignment;
    var PropertyAssignment = TermTree.extend({
        properties: ["propName", "assignment"],

        construct: function(propName, assignment) {
            this.propName = propName;
            this.assignment = assignment;
        }
    });

    var Block = PrimaryExpression.extend({
        properties: ["body"],
        construct: function(body) { this.body = body; }
    });

    var ArrayLiteral = PrimaryExpression.extend({
        properties: ["array"],

        construct: function(ar) { this.array = ar; }
    });

    var ParenExpression = PrimaryExpression.extend({
        properties: ["expr"],
        construct: function(expr) { this.expr = expr; }
    });

    var UnaryOp = Expr.extend({
        properties: ["op", "expr"],

        construct: function(op, expr) {
            this.op = op;
            this.expr = expr;
        }
    });

    var PostfixOp = Expr.extend({
        properties: ["expr", "op"],

        construct: function(expr, op) {
            this.expr = expr;
            this.op = op;
        }
    });

    var BinOp = Expr.extend({
        properties: ["left", "op", "right"],

        construct: function(op, left, right) {
            this.op = op;
            this.left = left;
            this.right = right;
        }
    });

    var ConditionalExpression = Expr.extend({
        properties: ["cond", "question", "tru", "colon", "fls"],
        construct: function(cond, question, tru, colon, fls) {
            this.cond = cond;
            this.question = question;
            this.tru = tru;
            this.colon = colon;
            this.fls = fls;
        }
    });


    var Keyword = TermTree.extend({
        properties: ["keyword"],

        construct: function(k) { this.keyword = k; }
    });

    var Punc = TermTree.extend({
        properties: ["punc"],

        construct: function(p) { this.punc = p; }
    });

    var Delimiter = TermTree.extend({
        properties: ["delim"],

        // do a special kind of destruct that creates
        // the individual begin and end delimiters
        destruct: function(breakDelim) {
            parser.assert(this.delim, "expecting delim to be defined");

            var innerStx = _.reduce(this.delim.token.inner, function(acc, term) {
                if (term.hasPrototype(TermTree)){
                    return acc.concat(term.destruct(breakDelim));
                } else {
                    return acc.concat(term);
                }
            }, []);

            if(breakDelim) {
                var openParen = syntaxFromToken({
                    type: parser.Token.Punctuator,
                    value: this.delim.token.value[0],
                    range: this.delim.token.startRange,
                    lineNumber: this.delim.token.startLineNumber,
                    lineStart: this.delim.token.startLineStart
                });
                var closeParen = syntaxFromToken({
                    type: parser.Token.Punctuator,
                    value: this.delim.token.value[1],
                    range: this.delim.token.endRange,
                    lineNumber: this.delim.token.endLineNumber,
                    lineStart: this.delim.token.endLineStart
                });

                return [openParen]
                    .concat(innerStx)
                    .concat(closeParen);
            } else {
                return this.delim;
            }
        },

        construct: function(d) { this.delim = d; }
    });

    var Id = PrimaryExpression.extend({
        properties: ["id"],

        construct: function(id) { this.id = id; }
    });

    var NamedFun = Expr.extend({
        properties: ["keyword", "name", "params", "body"],

        construct: function(keyword, name, params, body) {
            this.keyword = keyword;
            this.name = name;
            this.params = params;
            this.body = body;
        }
    });

    var AnonFun = Expr.extend({
        properties: ["keyword", "params", "body"],

        construct: function(keyword, params, body) {
            this.keyword = keyword;
            this.params = params;
            this.body = body;
        }
    });

    var Macro = TermTree.extend({
        properties: ["name", "body"],

        construct: function(name, body) {
            this.name = name;
            this.body = body;
        }
    });

    var Const = Expr.extend({
        properties: ["newterm", "call"],
        construct: function(newterm, call){
            this.newterm = newterm;
            this.call = call;
        }
    });

    var Call = Expr.extend({
        properties: ["fun", "args", "delim", "commas"],

        destruct: function(breakDelim) {
            parser.assert(this.fun.hasPrototype(TermTree),
                "expecting a term tree in destruct of call");
            var that = this;
            this.delim = syntaxFromToken(_.clone(this.delim.token), this.delim.context);
            this.delim.token.inner = _.reduce(this.args, function(acc, term) {
                parser.assert(term && term.hasPrototype(TermTree),
                              "expecting term trees in destruct of Call");
                var dst = acc.concat(term.destruct(breakDelim));
                // add all commas except for the last one
                if (that.commas.length > 0) {
                    dst = dst.concat(that.commas.shift());
                }
                return dst;
            }, []);

            return this.fun.destruct(breakDelim).concat(Delimiter.create(this.delim).destruct(breakDelim));
        },

        construct: function(funn, args, delim, commas) {
            parser.assert(Array.isArray(args), "requires an array of arguments terms");
            this.fun = funn;
            this.args = args;
            this.delim = delim;
            // an ugly little hack to keep the same syntax objects (with associated line numbers
            // etc.) for all the commas separating the arguments
            this.commas = commas;
        }
    });


    var ObjDotGet = Expr.extend({
        properties: ["left", "dot", "right"],

        construct: function (left, dot, right) {
            this.left = left;
            this.dot = dot;
            this.right = right;
        }
    });

    var ObjGet = Expr.extend({
        properties: ["left", "right"],

        construct: function(left, right) {
            this.left = left;
            this.right = right;
        }
    });

    var VariableDeclaration = TermTree.extend({
        properties: ["ident", "eqstx", "init", "comma"],

        construct: function(ident, eqstx, init, comma) {
            this.ident = ident;
            this.eqstx = eqstx;
            this.init = init;
            this.comma = comma;
        }
    });

    var VariableStatement = Statement.extend({
        properties: ["varkw", "decls"],

        destruct: function(breakDelim) {
            return this.varkw.destruct(breakDelim).concat(_.reduce(this.decls, function(acc, decl) {
                return acc.concat(decl.destruct(breakDelim));
            }, []));
        },

        construct: function(varkw, decls) {
            parser.assert(Array.isArray(decls), "decls must be an array");
            this.varkw = varkw;
            this.decls = decls;
        }
    });

    var CatchClause = TermTree.extend({
        properties: ["catchkw", "params", "body"],

        construct: function(catchkw, params, body) {
            this.catchkw = catchkw;
            this.params = params;
            this.body = body;
        }
    });

    var Empty = TermTree.extend({
        properties: [],
        construct: function() {}
    });

    function stxIsUnaryOp (stx) {
        var staticOperators = ["+", "-", "~", "!",
                                "delete", "void", "typeof",
                                "++", "--"];
        return _.contains(staticOperators, stx.token.value);
    }

    function stxIsBinOp (stx) {
        var staticOperators = ["+", "-", "*", "/", "%", "||", "&&", "|", "&", "^",
                                "==", "!=", "===", "!==",
                                "<", ">", "<=", ">=", "in", "instanceof",
                                "<<", ">>", ">>>"];
        return _.contains(staticOperators, stx.token.value);
    }

    // ([Syntax], Map) -> {result: [VariableDeclaration], rest: [Syntax]}
    // assumes stx starts at the identifier. ie:
    // var x = ...
    //     ^
    function enforestVarStatement (stx, env) {
        parser.assert(stx[0] && stx[0].token.type === parser.Token.Identifier,
            "must start at the identifier");
        var decls = [], rest = stx, initRes, subRes;

        if (stx[1] && stx[1].token.type === parser.Token.Punctuator &&
            stx[1].token.value === "=") {
            initRes = enforest(stx.slice(2), env);
            if (initRes.result.hasPrototype(Expr)) {
                rest = initRes.rest;

                if (initRes.rest[0].token.type === parser.Token.Punctuator &&
                    initRes.rest[0].token.value === "," &&
                    initRes.rest[1] && initRes.rest[1].token.type === parser.Token.Identifier) {
                    decls.push(VariableDeclaration.create(stx[0],
                                                          stx[1],
                                                          initRes.result,
                                                          initRes.rest[0]));

                    subRes = enforestVarStatement(initRes.rest.slice(1), env);

                    decls = decls.concat(subRes.result);
                    rest = subRes.rest;
                } else {
                    decls.push(VariableDeclaration.create(stx[0], stx[1], initRes.result));
                }
            } else {
                parser.assert(false, "parse error, expecting an expr in variable initialization");
            }
        } else if (stx[1] && stx[1].token.type === parser.Token.Punctuator &&
                    stx[1].token.value === ",") {
            decls.push(VariableDeclaration.create(stx[0], null, null, stx[1]));
            subRes = enforestVarStatement(stx.slice(2), env);

            decls = decls.concat(subRes.result);
            rest = subRes.rest;
        } else {
            decls.push(VariableDeclaration.create(stx[0]));
            rest = stx.slice(1)
        }
        
        return {
            result: decls,
            rest: rest
        };
    }


    function stxToToken(stx){
        var tok = _.clone(stx.token);
        if (stx.token.type === parser.Token.Delimiter) {
            tok.inner = _.map(tok.inner, function(stx) {
                return stxToToken(stx);
            });
        }
        return tok;
    }


    // enforest the tokens, returns an object with the `result` TermTree and
    // the uninterpreted `rest` of the syntax
    function enforest(toks, env, stxStore) {
        env = env || new Map();

        parser.assert(toks.length > 0, "enforest assumes there are tokens to work with");

        function step(head, rest) {
            var innerTokens;
            parser.assert(Array.isArray(rest), "result must at least be an empty array");
            if (head.hasPrototype(TermTree)) {

                // function call
                case head {

                    // Call
                    Expr(emp) | (rest[0] && 
                                rest[0].token.type === parser.Token.Delimiter &&
                                rest[0].token.value === "()") => {
                        var argRes, enforestedArgs = [], commas = [];

                        innerTokens = rest[0].token.inner;
                        while (innerTokens.length > 0) {
                            argRes = enforest(innerTokens, env, stxStore);
                            enforestedArgs.push(argRes.result);
                            innerTokens = argRes.rest;
                            if (innerTokens[0] && innerTokens[0].token.value === ",") {
                                // record the comma for later
                                commas.push(innerTokens[0]);
                                // but dump it for the next loop turn
                                innerTokens = innerTokens.slice(1);
                            } else {
                                // either there are no more tokens or they aren't a comma, either
                                // way we are done with the loop
                                break;
                            }
                        }
                        var argsAreExprs = _.all(enforestedArgs, function(argTerm) {
                            return argTerm.hasPrototype(Expr)
                        });

                        // only a call if we can completely enforest each argument and
                        // each argument is an expression
                        if (innerTokens.length === 0 && argsAreExprs) {
                            return step(Call.create(head, enforestedArgs, rest[0], commas),
                                        rest.slice(1));
                        }
                    }

                    // Conditional ( x ? true : false)
                    Expr(emp) | (rest[0] && rest[0].token.value === "?") => {
                        var question = rest[0];
                        var condRes = enforest(rest.slice(1), env, stxStore);
                        var truExpr = condRes.result;
                        var right = condRes.rest;
                        if(truExpr.hasPrototype(Expr) && right[0] && right[0].token.value === ":") {
                            var colon = right[0];
                            var flsRes = enforest(right.slice(1), env, stxStore);
                            var flsExpr = flsRes.result;
                            if(flsExpr.hasPrototype(Expr)) {
                                return step(ConditionalExpression.create(head, question, truExpr, colon, flsExpr),
                                            flsRes.rest);
                            }
                        }
                    }

                    // Constructor
                    Keyword(keyword) | (keyword.token.value === "new" && rest[0]) => {
                        var newCallRes = enforest(rest, env, stxStore);
                        if(newCallRes.result.hasPrototype(Call)) {
                            return step(Const.create(head, newCallRes.result), newCallRes.rest);
                        }
                    }

                    // ParenExpr
                    Delimiter(delim) | delim.token.value === "()" => {
                        innerTokens = delim.token.inner;
                        // empty parens are acceptable but enforest doesn't accept empty arrays
                        // so short circuit here
                        if (innerTokens.length === 0) {
                            return step(ParenExpression.create(head), rest);
                        } else {
                            var innerTerm = get_expression(innerTokens, env, stxStore);
                            if (innerTerm.result && innerTerm.result.hasPrototype(Expr)) {
                                return step(ParenExpression.create(head), rest);
                            }
                            // if the tokens inside the paren aren't an expression
                            // we just leave it as a delimiter
                        }
                    }

                    // BinOp
                    TermTree(emp) | (rest[0] && rest[1] && stxIsBinOp(rest[0])) => {
                        var op = rest[0];
                        var left = head;
                        var bopRes = enforest(rest.slice(1), env, stxStore);
                        var right = bopRes.result;
                        // only a binop if the right is a real expression
                        // so 2+2++ will only match 2+2
                        if (right.hasPrototype(Expr)) {
                            return step(BinOp.create(op, left, right), bopRes.rest);
                        }
                    }

                    // UnaryOp (via punctuation)
                    Punc(punc) | stxIsUnaryOp(punc) => {
                        var unopRes = enforest(rest, env, stxStore);
                        if (unopRes.result.hasPrototype(Expr)) {
                            return step(UnaryOp.create(punc, unopRes.result), unopRes.rest);
                        }
                    }

                    // UnaryOp (via keyword)
                    Keyword(keyword) | stxIsUnaryOp(keyword) => {
                        var unopRes = enforest(rest, env, stxStore);
                        if (unopRes.result.hasPrototype(Expr)) {
                            return step(UnaryOp.create(keyword, unopRes.result), unopRes.rest);
                        }
                    }

                    // Postfix
                    Expr(emp) | (rest[0] && (rest[0].token.value === "++" || 
                                            rest[0].token.value === "--")) => {
                        return step(PostfixOp.create(head, rest[0]), rest.slice(1));
                    }

                    // ObjectGet (computed)
                    Expr(emp) | (rest[0] && rest[0].token.value === "[]") => {
                        var getRes = enforest(rest[0].token.inner, env, stxStore);
                        var resStx = mkSyntax("[]", parser.Token.Delimiter, rest[0]);
                        resStx.token.inner = [getRes.result];
                        if(getRes.rest.length > 0) {
                            return step(ObjGet.create(head, Delimiter.create(resStx)), rest.slice(1));
                        }
                    }

                    // ObjectGet
                    Expr(emp) | (rest[0] && rest[0].token.value === "." &&
                                rest[1] && rest[1].token.type === parser.Token.Identifier) => {
                        return step(ObjDotGet.create(head, rest[0], rest[1]), rest.slice(2));
                    }

                    // ArrayLiteral
                    Delimiter(delim) | delim.token.value === "[]" => {
                        return step(ArrayLiteral.create(head), rest);
                    }

                    // Block
                    Delimiter(delim) | head.delim.token.value === "{}" => {
                        return step(Block.create(head), rest);
                    }

                    // VariableStatement
                    Keyword(keyword) | (keyword.token.value === "var" &&
                                        rest[0] && rest[0].token.type === parser.Token.Identifier) => {
                        var vsRes = enforestVarStatement(rest, env);
                        if (vsRes) {
                            return step(VariableStatement.create(head, vsRes.result), vsRes.rest);
                        }
                    }
                }
            } else {
                parser.assert(head && head.token, "assuming head is a syntax object");

                // macro invocation
                if ((head.token.type === parser.Token.Identifier ||
                    head.token.type === parser.Token.Keyword) &&
                    env.has(head.token.value)) {

                    // pull the macro transformer out the environment
                    var transformer = env.get(head.token.value);
                    // apply the transformer
                    var rt = transformer(rest, head, env, stxStore);
                    if(!Array.isArray(rt.result)) {
                        throwError("Macro transformer must return a result array, not: " + rt.result);
                    }
                    if(rt.result.length > 0) {
                        return step(rt.result[0], rt.result.slice(1).concat(rt.rest));
                    } else {
                        return step(Empty.create(), rt.rest);
                    } 
                // macro definition
                } else if (head.token.type === parser.Token.Identifier &&
                    head.token.value === "macro" && rest[0] &&
                    (rest[0].token.type === parser.Token.Identifier ||
                        rest[0].token.type === parser.Token.Keyword) &&
                    rest[1] && rest[1].token.type === parser.Token.Delimiter &&
                    rest[1].token.value === "{}") {

                    return step(Macro.create(rest[0], rest[1].token.inner), rest.slice(2));
                // function definition
                } else if (head.token.type === parser.Token.Keyword &&
                    head.token.value === "function" &&
                    rest[0] && rest[0].token.type === parser.Token.Identifier &&
                    rest[1] && rest[1].token.type === parser.Token.Delimiter &&
                    rest[1].token.value === "()" &&
                    rest[2] && rest[2].token.type === parser.Token.Delimiter &&
                    rest[2].token.value === "{}") {

                    return step(NamedFun.create(head, rest[0],
                                                rest[1],
                                                rest[2]),
                                rest.slice(3));
                // anonymous function definition
                } else if(head.token.type === parser.Token.Keyword &&
                    head.token.value === "function" &&
                    rest[0] && rest[0].token.type === parser.Token.Delimiter &&
                    rest[0].token.value === "()" &&
                    rest[1] && rest[1].token.type === parser.Token.Delimiter &&
                    rest[1].token.value === "{}") {

                    return step(AnonFun.create(head,
                                                rest[0],
                                                rest[1]),
                                rest.slice(2));
                // catch statement
                } else if (head.token.type === parser.Token.Keyword &&
                           head.token.value === "catch" &&
                           rest[0] && rest[0].token.type === parser.Token.Delimiter &&
                           rest[0].token.value === "()" &&
                           rest[1] && rest[1].token.type === parser.Token.Delimiter &&
                           rest[1].token.value === "{}") {
                    return step(CatchClause.create(head, rest[0], rest[1]),
                               rest.slice(2));
                // this expression
                } else if (head.token.type === parser.Token.Keyword &&
                    head.token.value === "this") {

                    return step(ThisExpression.create(head), rest);
                // literal
                } else if (head.token.type === parser.Token.NumericLiteral ||
                    head.token.type === parser.Token.StringLiteral ||
                    head.token.type === parser.Token.BooleanLiteral ||
                    head.token.type === parser.Token.RegexLiteral ||
                    head.token.type === parser.Token.NullLiteral) {

                    return step(Lit.create(head), rest);
                // identifier
                } else if (head.token.type === parser.Token.Identifier) {
                    return step(Id.create(head), rest);
                // punctuator
                } else if (head.token.type === parser.Token.Punctuator) {
                    return step(Punc.create(head), rest);
                } else if (head.token.type === parser.Token.Keyword &&
                            head.token.value === "with") {
                    throwError("with is not supported in sweet.js");
                // keyword
                } else if (head.token.type === parser.Token.Keyword) {
                    return step(Keyword.create(head), rest);
                // Delimiter
                } else if (head.token.type === parser.Token.Delimiter) {
                    return step(Delimiter.create(head), rest);
                // end of file
                } else if (head.token.type === parser.Token.EOF) {
                    parser.assert(rest.length === 0, "nothing should be after an EOF");
                    return step(EOF.create(head), []);
                } else {
                    // todo: are we missing cases?
                    parser.assert(false, "not implemented");
                }

            }

            // we're done stepping
            return {
                result: head,
                rest: rest
            };

        }

        return step(toks[0], toks.slice(1));
    }

    function get_expression(stx, env, stxStore) {
        var res = enforest(stx, env, stxStore);
        if (!res.result.hasPrototype(Expr)) {
            return {
                result: null,
                rest: stx
            };
        }
        return res;
    }

    function typeIsLiteral (type) {
        return type === parser.Token.NullLiteral ||
               type === parser.Token.NumericLiteral ||
               type === parser.Token.StringLiteral ||
               type === parser.Token.RegexLiteral ||
               type === parser.Token.BooleanLiteral;
    }

    exports._test.matchPatternClass = matchPatternClass;
    // (Str, [...CSyntax], MacroEnv) -> {result: null or [...CSyntax], rest: [...CSyntax]}
    function matchPatternClass (patternClass, stx, env, stxStore) {
        var result, rest;
        // pattern has no parse class
        if (patternClass === "token" && stx[0] && stx[0].token.type !== parser.Token.EOF) {
            result = [stx[0]];
            rest = stx.slice(1);
        } else if (patternClass === "lit" && stx[0] && typeIsLiteral(stx[0].token.type)) {
            result = [stx[0]];
            rest = stx.slice(1);
        } else if (patternClass === "ident" && stx[0] && stx[0].token.type === parser.Token.Identifier) {
            result = [stx[0]];
            rest = stx.slice(1);
        } else if (stx.length > 0 && patternClass === "VariableStatement") {
            var match = enforest(stx, env, stxStore);
            if (match.result && match.result.hasPrototype(VariableStatement)) {
                result = match.result.destruct(false);
                rest = match.rest;
            } else {
                result = null;
                rest = stx;
            }
        } else if (stx.length > 0 && patternClass === "expr") {
            var match = get_expression(stx, env, stxStore);
            if (match.result === null || (!match.result.hasPrototype(Expr))) {
                result = null;
                rest = stx;
            } else {
                result = match.result.destruct(false);
                rest = match.rest;
            }
        } else {
            result = null;
            rest = stx;
        }

        return {
            result: result,
            rest: rest
        };
    }

    /* the pattern environment will look something like:
    {
        "$x": {
            level: 2,
            match: [{
                level: 1,
                match: [{
                    level: 0,
                    match: [tok1, tok2, ...]
                }, {
                    level: 0,
                    match: [tok1, tok2, ...]
                }]
            }, {
                level: 1,
                match: [{
                    level: 0,
                    match: [tok1, tok2, ...]
                }]
            }]
        },
        "$y" : ...
    }
    */
    function matchPattern(pattern, stx, env, patternEnv, stxStore) {
        var subMatch;
        var match, matchEnv;
        var rest;
        var success;

        if (pattern.token.type === parser.Token.Delimiter) {
            if (pattern.class === "pattern_group") {
                // pattern groups don't match the delimiters
                subMatch = matchPatterns(pattern.token.inner, stx, env, false, stxStore);
                rest = subMatch.rest;
            } else if (stx[0] && stx[0].token.type === parser.Token.Delimiter &&
                       stx[0].token.value === pattern.token.value) {
                subMatch = matchPatterns(pattern.token.inner, stx[0].token.inner, env, false, stxStore);
                rest = stx.slice(1);
            } else {
                return {
                    success: false,
                    rest: stx,
                    patternEnv: patternEnv
                };
            }
            success = subMatch.success;

            // merge the subpattern matches with the current pattern environment
            _.keys(subMatch.patternEnv).forEach(function(patternKey) {
                if (pattern.repeat) {
                    // if this is a repeat pattern we need to bump the level
                    var nextLevel = subMatch.patternEnv[patternKey].level + 1;

                    if (patternEnv[patternKey]) {
                        patternEnv[patternKey].level = nextLevel;
                        patternEnv[patternKey].match.push(subMatch.patternEnv[patternKey]);
                    } else {
                        // initialize if we haven't done so already
                        patternEnv[patternKey] = {
                            level: nextLevel,
                            match: [subMatch.patternEnv[patternKey]]
                        };
                    }
                } else {
                    // otherwise accept the environment as-is
                    patternEnv[patternKey] = subMatch.patternEnv[patternKey];
                }
            });

        } else {
            if (pattern.class === "pattern_literal") {
                // match the literal but don't update the pattern environment
                if (stx[0] && pattern.token.value === stx[0].token.value) {
                    success = true;
                    rest = stx.slice(1);
                } else {
                    success = false;
                    rest = stx;
                }
            } else {
                match = matchPatternClass(pattern.class, stx, env, stxStore);

                success = match.result !== null;
                rest = match.rest;
                matchEnv = {
                    level: 0,
                    match: match.result
                };

                // push the match onto this value's slot in the environment
                if (pattern.repeat) {
                    if (patternEnv[pattern.token.value]) {
                        patternEnv[pattern.token.value].match.push(matchEnv);
                    } else {
                        // initialize if necessary
                        patternEnv[pattern.token.value] = {
                            level: 1,
                            match: [matchEnv]
                        };
                    }
                } else {
                    patternEnv[pattern.token.value] = matchEnv;
                }
            }
        }
        return {
            success: success,
            rest: rest,
            patternEnv: patternEnv
        };

    }


    // attempt to match patterns against stx
    // ([...Pattern], [...Syntax], Env) -> { result: [...Syntax], rest: [...Syntax], patternEnv: PatternEnv }
    function matchPatterns(patterns, stx, env, topLevel, stxStore) {
        // topLevel lets us know if the patterns are on the top level or nested inside
        // a delimiter:
        //     case $topLevel (,) ... => { }
        //     case ($nested (,) ...) => { }
        // This matters for how we deal with trailing unmatched syntax when the pattern
        // has an ellipses:
        //     m 1,2,3 foo
        // should match 1,2,3 and leave foo alone but:
        //     m (1,2,3 foo)
        // should fail to match entirely.
        topLevel = topLevel || false;
        // note that there are two environments floating around,
        // one is the mapping of identifiers to macro definitions (env)
        // and the other is the pattern environment (patternEnv) that maps
        // patterns in a macro case to syntax.
        var result = [];
        var patternEnv = {};

        var match;
        var pattern;
        var rest = stx;
        var success = true;

        for (var i = 0; i < patterns.length; i++) {
            pattern = patterns[i];
            do {
                match = matchPattern(pattern, rest, env, patternEnv, stxStore);
                if ((!match.success) && pattern.repeat) {
                    // a repeat can match zero tokens and still be a
                    // "success" so break out of the inner loop and
                    // try the next pattern
                    rest = match.rest;
                    patternEnv = match.patternEnv;
                    break;
                }
                if (!match.success) {
                    success = false;
                    break;
                }
                rest = match.rest;
                patternEnv = match.patternEnv;

                if (pattern.repeat && success) {
                    if (rest[0] && rest[0].token.value === pattern.separator) {
                        // more tokens and the next token matches the separator
                        rest = rest.slice(1);
                    } else if (pattern.separator === " ") {
                        // no separator specified (using the empty string for this)
                        // so keep going
                        continue;
                    } else if ((pattern.separator !== " ") &&
                                (rest.length > 0) &&
                                (i === patterns.length - 1) &&
                                topLevel === false) {
                        // separator is specified, there is a next token, the
                        // next token doesn't match the separator, there are
                        // no more patterns, and this is a top level pattern
                        // so the match has failed
                        success = false;
                        break;
                    } else {
                        break;
                    }
                }
            } while (pattern.repeat && match.success && rest.length > 0);
        }
        return {
            success: success,
            rest: rest,
            patternEnv: patternEnv
        };
    }

    // given the given the macroBody (list of Pattern syntax objects) and the
    // environment (a mapping of patterns to syntax) return the body with the
    // appropriate patterns replaces with their value in the environment
    function transcribe(macroBody, macroNameStx, env, macroType, stxStore) {

        return _.chain(macroBody)
            .reduce(function(acc, bodyStx, idx, original) {
                    // first find the ellipses and mark the syntax objects
                    // (note that this step does not eagerly go into delimiter bodies)
                    var last = original[idx-1];
                    var next = original[idx+1];
                    var nextNext = original[idx+2];

                   // drop `...`
                    if (bodyStx.token.value === "...") {
                        return acc;
                    }
                    // drop `(<separator)` when followed by an ellipse
                    if (delimIsSeparator(bodyStx) && next && next.token.value === "...") {
                        return acc;
                    }

                    // skip the $ in $(...)
                    if (bodyStx.token.value === "$" &&
                        next && next.token.type === parser.Token.Delimiter &&
                        next.token.value === "()") {

                        return acc;
                    }

                    // mark $[...] as a literal
                    if (bodyStx.token.value === "$" &&
                        next && next.token.type === parser.Token.Delimiter &&
                        next.token.value === "[]") {

                        next.literal = true;
                        return acc;
                    }

                    if (bodyStx.token.type === parser.Token.Delimiter &&
                        bodyStx.token.value === "()" &&
                        last && last.token.value === "$") {

                        bodyStx.group = true;
                    }

                    // literal [] delimiters have their bodies just directly passed along
                    if (bodyStx.literal === true) {
                        parser.assert(bodyStx.token.type === parser.Token.Delimiter,
                                        "expecting a literal to be surrounded by []");
                        return acc.concat(bodyStx.token.inner);
                    }

                    if (next && next.token.value === "...") {
                        bodyStx.repeat = true;
                        bodyStx.separator = " "; // default to space separated
                    } else if (delimIsSeparator(next) && nextNext && nextNext.token.value === "...") {
                        bodyStx.repeat = true;
                        bodyStx.separator = next.token.inner[0].token.value;
                    }

                    return acc.concat(bodyStx);
                }, []).reduce(function(acc, bodyStx, idx) {
                // then do the actual transcription
                if (bodyStx.repeat) {
                    if (bodyStx.token.type === parser.Token.Delimiter) {

                        var fv = _.filter(freeVarsInPattern(bodyStx.token.inner), function(pat) {
                            // ignore "patterns" that aren't in the environment
                            // (treat them like literals)
                            return env.hasOwnProperty(pat);
                        });
                        var restrictedEnv = [];
                        var nonScalar = _.find(fv, function(pat) {
                            return env[pat].level > 0;
                        });

                        parser.assert(typeof nonScalar !== 'undefined', "must have a least one non-scalar in repeat");

                        var repeatLength = env[nonScalar].match.length;
                        var sameLength = _.all(fv, function(pat) {
                            return (env[pat].level === 0) || (env[pat].match.length === repeatLength);
                        });
                        parser.assert(sameLength, "all non-scalars must have the same length");

                        // create a list of envs restricted to the free vars
                        restrictedEnv = _.map(_.range(repeatLength), function(idx) {
                            var renv = {};
                            _.each(fv, function(pat) {
                                if (env[pat].level === 0) {
                                    // copy scalars over
                                    renv[pat] = env[pat];
                                } else {
                                    // grab the match at this index
                                    renv[pat] = env[pat].match[idx];
                                }
                            });
                            return renv;
                        });

                        var transcribed = _.map(restrictedEnv, function(renv) {
                            if (bodyStx.group) {
                                return transcribe(bodyStx.token.inner, macroNameStx, renv, macroType, stxStore);
                            } else {
                                var newBody = syntaxFromToken(_.clone(bodyStx.token), bodyStx.context);
                                newBody.token.inner = transcribe(bodyStx.token.inner, macroNameStx, renv, macroType, stxStore);
                                return newBody;
                            }
                        });
                        var joined;
                        if (bodyStx.group) {
                            joined = joinSyntaxArr(transcribed, bodyStx.separator);
                        } else {
                            joined = joinSyntax(transcribed, bodyStx.separator);
                        }

                        return acc.concat(joined);
                    }
                    parser.assert(env[bodyStx.token.value].level === 1, "ellipses level does not match");
                    return acc.concat(joinRepeatedMatch(env[bodyStx.token.value].match, bodyStx.separator));
                } else {
                    if (bodyStx.token.type === parser.Token.Delimiter) {
                        var newBody = syntaxFromToken(_.clone(bodyStx.token), macroBody.context);
                        newBody.token.inner = transcribe(bodyStx.token.inner, macroNameStx, env, macroType, stxStore);
                        return acc.concat(takeLineContext(macroNameStx, [newBody]));
                    }
                    if (Object.prototype.hasOwnProperty.bind(env)(bodyStx.token.value)) {
                        parser.assert(env[bodyStx.token.value].level === 0,
                                      "match ellipses level does not match: " + bodyStx.token.value);
                        if(macroType === "case") {
                            return acc.concat(makeGetSyntax(env[bodyStx.token.value].match,
                                                            stxStore,
                                                            macroNameStx));
                        } else {
                            return acc.concat(takeLineContext(macroNameStx,
                                                              env[bodyStx.token.value].match));
                        }
                    }
                    return acc.concat(takeLineContext(macroNameStx, [bodyStx]));
                }
            }, []).value();
    }

    function makeGetSyntax(stx, stxStore, lineContext){
        var stxId = fresh();
        stxStore.set(stxId, stx);

        var fn = syntaxFromToken({
            value: "getSyntax",
            type: parser.Token.Identifier
        });
        var args = syntaxFromToken({
            value: "()",
            type: parser.Token.Delimiter,
            inner: [
                syntaxFromToken({
                    value: stxId,
                    type: parser.Token.NumericLiteral
                })
            ]
        });
        return takeLineContext(lineContext, [fn, args]);
    }


    // mark each syntax object in the pattern environment,
    // mutating the environment
    function applyMarkToPatternEnv (newMark, env) {
        /*
        Takes a `match` object:

            {
                level: <num>,
                match: [<match> or <syntax>]
            }

        where the match property is an array of syntax objects at the bottom (0) level.
        Does a depth-first search and applys the mark to each syntax object.
        */
        function dfs(match) {
            if (match.level === 0) {
                // replace the match property with the marked syntax
                match.match = _.map(match.match, function(stx) {
                    return stx.mark(newMark);
                });
            } else {
                _.each(match.match, function(match) {
                    dfs(match);
                });
            }
        }
        _.keys(env).forEach(function(key) {
            dfs(env[key]);
        });
    }

    // fun ([...Syntax]) -> [...Syntax]
    // fun ([CSyntax...]) -> [CSyntax ...]
    function evalMacroBody(body, stxStore) {
        var functionStub = parser.read("(function(makeSyntax, getSyntax, unwrapSyntax) { })");
        functionStub[0].token.inner[2].token.inner = body;
        var expanded = expandTopLevel(functionStub, stxStore);
        var bodyCode = codegen.generate(parser.parse(expanded));

        var macroFn = eval(bodyCode);

        function mSyntax(val, ctx) {
            if(Array.isArray(val)) {
                return syntaxFromToken({
                    value: "[]",
                    type: parser.Token.Delimiter,
                    inner: _.reduce(_.tail(val), function(acc, v) {
                        return acc.concat([syntaxFromToken({
                            value: ",",
                            type: parser.Token.Punctuator
                        }, null), mSyntax(v, ctx)]);
                    }, [mSyntax(_.head(val), ctx)])
                }, ctx);
            } else if (typeof val === "number") {
                return syntaxFromToken({
                    value: val,
                    type: parser.Token.NumericLiteral
                }, ctx)
            } else if (typeof val === "string") {
                return syntaxFromToken({
                    value: val,
                    type: parser.Token.StringLiteral
                }, ctx)
            } else {
                throwError("not implemented yet");
            }
            return syntaxFromToken(token, stxContext.context);
        }
        
        return macroFn(mSyntax, function(stxId) {
            return stxStore.get(stxId);
        }, function(stx) {
            return stx[0].token.value;
        });
    }

    // create a macro transformer - a function that given the syntax at the macro call
    // will do the syntax transformation
    function makeTransformer(cases, macroType) {
        // grab the patterns from each case and sort them by longest number of patterns
        var sortedCases = _.sortBy(cases, function(mcase) {
                            return patternLength(mcase.pattern);
                        }).reverse();


        return function transformer(stx, macroNameStx, env, stxStore) {
            var match;
            var casePattern, caseBody;
            var newMark;
            var macroResult;
            // try each case
            for (var i = 0; i < sortedCases.length; i++) {
                casePattern = sortedCases[i].pattern;
                caseBody = sortedCases[i].body;

                match = matchPatterns(casePattern, stx, env, true, stxStore);
                if (match.success) {
                    newMark = fresh();
                    applyMarkToPatternEnv(newMark, match.patternEnv);
                    macroResult = transcribe(caseBody, macroNameStx, match.patternEnv, macroType, stxStore);
                    if(macroType === "case") {
                        macroResult = evalMacroBody(macroResult, stxStore);
                    }
                    macroResult = _.map(macroResult, function(stx) { return stx.mark(newMark); });
                    return {
                        result: macroResult,
                        rest: match.rest
                    };
                }
            }
            throwError("Could not match any cases for macro: " + macroNameStx.token.value);
        };
    }

    // given the syntax for a macro, produce a macro transformer
    // (Macro) -> (([...CSyntax]) -> ReadTree)
    function loadMacroDef(mac, env, ctx, defscope, stxStore) {
        var body = mac.body;
        var caseOffset = 0;
        var arrowOffset = 0;
        var casePattern;
        var caseBody;
        var caseBodyIdx;
        var cases = [];
        var i = 0;

        var patOffset = 1;
        var bodyOffset = 4;

        var macroType;

        // raw function primitive form
        if(body[0] && body[0].token.type === parser.Token.Keyword &&
           body[0].token.value === "function") {
            // put the function into parens to force expression form
            var stub = parser.read("()");
            stub[0].token.inner = body;
            var expanded = flatten(expand(stub, env, ctx, defscope, stxStore));
            var bodyCode = codegen.generate(parser.parse(expanded));
            return eval(bodyCode);
        }

        
        if(body[0] && body[0].token.value === "rule" || body[0].token.value === "case") {
            macroType = body[0].token.value;
        } else {
            throwError("Macro definition must start with either 'rule' or 'case'");
        }

        // load each of the macro cases
        while (i < body.length && body[i].token.value === macroType) {
            if(!body[i + patOffset] ||
                body[i + patOffset].token.type !== parser.Token.Delimiter || 
                body[i + patOffset].token.value !== "{}") {
                throwError("Expecting a {} to surround the pattern in a macro definition");
            }
            if(!body[i + 2] || body[i + 2].token.value !== "=" ||
                !body[i + 3] || body[i + 3].token.value !== ">") {
                throwError("expecting a => following the pattern in a macro definition");
            }
            if(!body[i + bodyOffset] ||
                body[i + bodyOffset].token.type !== parser.Token.Delimiter || 
                body[i + bodyOffset].token.value !== "{}") {
                throwError("Expecting a {} to surround the body in a macro definition");
            }

            casePattern = body[i + patOffset].token.inner;
            caseBody = body[i + bodyOffset].token.inner;

            cases.push({
                pattern: loadPattern(casePattern, mac.name),
                body: caseBody
            });
            i += bodyOffset + 1;
        }
        return makeTransformer(cases, macroType);
    }

    // similar to `parse1` in the honu paper
    // ([Syntax], Map) -> {terms: [TermTree], env: Map}
    function expandToTermTree (stx, env, ctx, defscope, stxStore) {
        parser.assert(env, "environment map is required");

        // short circuit when syntax array is empty
        if (stx.length === 0) {
            return {
                terms: [],
                env: env
            };
        }

        parser.assert(stx[0].token, "expecting a syntax object");

        var f = enforest(stx, env, stxStore);
        // head :: TermTree
        var head = f.result;
        // rest :: [Syntax]
        var rest = f.rest;

        if (head.hasPrototype(Macro)) {
            // load the macro definition into the environment and continue expanding
            var macroDefinition = loadMacroDef(head, env, ctx, defscope, stxStore);
            env.set(head.name.token.value, macroDefinition);
            return expandToTermTree(rest, env, ctx, defscope, stxStore);
        }

        if (head.hasPrototype(VariableStatement)) {
            addVarsToDefinitionCtx(head, defscope);
        }

        if(head.hasPrototype(Block) && head.body.hasPrototype(Delimiter)) {
            head.body.delim.token.inner.forEach(function(term) {
                addVarsToDefinitionCtx(term, defscope);
            });

        } 

        if(head.hasPrototype(Delimiter)) {
            head.delim.token.inner.forEach(function(term) {
                addVarsToDefinitionCtx(term, defscope);
            });
        }

        var trees = expandToTermTree(rest, env, ctx, defscope, stxStore);
        return {
            terms: [head].concat(trees.terms),
            env: trees.env
        };
    }

    function addVarsToDefinitionCtx(term, defscope) {
        if(term.hasPrototype(VariableStatement)) {
            term.decls.forEach(function(decl) {
                var defctx = defscope;
                parser.assert(defctx, "no definition context found but there should always be one");

                var declRepeat = _.find(defctx, function(def) {
                    return def.id.token.value === decl.ident.token.value &&
                        arraysEqual(marksof(def.id.context), marksof(decl.ident.context));
                });
                /* 
                When var declarations repeat in the same function scope:
                    
                    var x = 24;
                    ...
                    var x = 42;

                we just need to use the first renaming and leave the definition context as is.
                */
                if (declRepeat !== null) {
                    var name = fresh();
                    defctx.push({
                        id: decl.ident,
                        name: name
                    });
                }
            });
        }
    }

    // finds all the identifiers being bound by var statements
    // in the array of syntax objects
    // (TermTree) -> [Syntax]
    function getVarDeclIdentifiers(term) {
        var toCheck;

        case term {
            Block(body) => {
                case body {
                    Delimiter(delim) => {
                        toCheck = body.delim.token.inner;
                    }
                }
            }
            Delimiter(delim) => {
                toCheck = delim.token.inner;
            }
            default => {
                parser.assert(false, "expecting a Block or a Delimiter");
            }
        }

        return _.reduce(toCheck, function(acc, curr, idx, list) {
            var prev = list[idx-1];
            if (curr.hasPrototype(VariableStatement)) {
                return _.reduce(curr.decls, function(acc, decl) {
                    return acc.concat(decl.ident);
                }, acc);
            } else if (prev && prev.hasPrototype(Keyword) && prev.keyword.token.value === "for" &&
                      curr.hasPrototype(Delimiter)) {
                return acc.concat(getVarDeclIdentifiers(curr));
            } else if (curr.hasPrototype(Block)) {
                return acc.concat(getVarDeclIdentifiers(curr));
            }
            return acc;
        }, []);
    }

    function replaceVarIdent(stx, orig, renamed) {
        if (stx === orig) {
            return renamed;
        }
        return stx;
    }

    // Takes a term tree and returns the syntax object that it wrapps.
    // Assumes that there is only a single token so throws error if
    // the term wrapps more than a single syntax object (eg: a
    // function definition isn't allowed)
    function getWrappedSyntax(term){
        case term {
            ArrayLiteral(array) => {
                return array.delim;
            }
            Block(body) => {
                return body.delim;
            }
            ParenExpression(expr) => {
                return expr.delim;
            }
            Delimiter(delim) => {
                return delim;
            }
            ThisExpression(emp) => {
                return term.this;
            }
            Lit(lit) => {
                return lit;
            }
            Id(id) => {
                return id;
            }
            default: => {
                throwError("make syntax only understands single tokens")
            }
        }
    }

    // similar to `parse2` in the honu paper except here we
    // don't generate an AST yet
    // (TermTree, Map, Map) -> TermTree
    function expandTermTreeToFinal (term, env, ctx, defscope, stxStore) {
        parser.assert(env, "environment map is required");
        parser.assert(ctx, "context map is required");


        if (term.hasPrototype(ArrayLiteral)) {
            term.array.delim.token.inner = expand(term.array.delim.token.inner, env, ctx, defscope, stxStore);
            return term;
        } else if (term.hasPrototype(Block)) {
            term.body.delim.token.inner = expand(term.body.delim.token.inner, env, ctx, defscope, stxStore);
            return term;
        } else if (term.hasPrototype(ParenExpression)) {
            term.expr.delim.token.inner = expand(term.expr.delim.token.inner, env, ctx, defscope, stxStore);
            return term;
        } else if (term.hasPrototype(Call)) {
            term.fun = expandTermTreeToFinal(term.fun, env, ctx, defscope, stxStore);
            term.args = _.map(term.args, function(arg) {
                return expandTermTreeToFinal(arg, env, ctx, defscope, stxStore);
            });
            return term;
        } else if (term.hasPrototype(UnaryOp)) {
            term.expr = expandTermTreeToFinal(term.expr, env, ctx, defscope, stxStore);
            return term;
        } else if (term.hasPrototype(BinOp)) {
            term.left = expandTermTreeToFinal(term.left, env, ctx, defscope, stxStore);
            term.right = expandTermTreeToFinal(term.right, env, ctx, defscope, stxStore);
            return term;
        } else if (term.hasPrototype(ObjDotGet)) {
            term.left = expandTermTreeToFinal(term.left, env, ctx, defscope, stxStore);
            term.right = expandTermTreeToFinal(term.right, env, ctx, defscope, stxStore);
            return term;
        } else if (term.hasPrototype(VariableDeclaration)) {
            if (term.init) {
                term.init = expandTermTreeToFinal(term.init, env, ctx, defscope, stxStore);
            }
            return term;
        } else if (term.hasPrototype(VariableStatement)) {
            term.decls = _.map(term.decls, function(decl) {
                return expandTermTreeToFinal(decl, env, ctx, defscope, stxStore);
            });
            return term;
        } else if (term.hasPrototype(Delimiter)) {
            // expand inside the delimiter and then continue on
            term.delim.token.inner = expand(term.delim.token.inner, env, ctx, defscope, stxStore);
            return term;
        } else if (term.hasPrototype(NamedFun) || term.hasPrototype(AnonFun) || term.hasPrototype(CatchClause)) {
            // function definitions need a bunch of hygiene logic
            // push down a fresh definition context
            var newDef = [];

            var params = term.params.addDefCtx(newDef);
            var bodies = term.body.addDefCtx(newDef);

            var paramNames = _.map(getParamIdentifiers(params), function(param) {
                var freshName = fresh();
                return {
                    freshName: freshName,
                    originalParam: param,
                    renamedParam: param.rename(param, freshName)
                };
            });

            // TODO: fix, ctx isn't being used
            var newCtx = ctx;

            var stxBody = bodies;

            // rename the function body for each of the parameters
            var renamedBody = _.reduce(paramNames, function (accBody, p) {
                return accBody.rename(p.originalParam, p.freshName)
            }, stxBody);

            var bodyTerms = expand([renamedBody], env, newCtx, newDef, stxStore);
            parser.assert(bodyTerms.length === 1 && bodyTerms[0].body,
                            "expecting a block in the bodyTerms");

            var flattenedBody = flatten(bodyTerms);

            var renamedParams = _.map(paramNames, function(p) { return p.renamedParam; });
            var flatArgs = wrapDelim(joinSyntax(renamedParams, ","), term.params);
            var expandedArgs = expand([flatArgs], env, ctx, newDef, stxStore);
            parser.assert(expandedArgs.length === 1, "should only get back one result");
            // stitch up the function with all the renamings
            term.params = expandedArgs[0];

            term.body = _.map(flattenedBody, function(stx) { 
                return _.reduce(newDef, function(acc, def) {
                    return acc.rename(def.id, def.name);
                }, stx)
            });

            // and continue expand the rest
            return term;
        }
        // the term is fine as is
        return term;
    }

    // similar to `parse` in the honu paper
    // ([Syntax], Map, Map) -> [TermTree]
    function expand(stx, env, ctx, defscope, stxStore) {
        env = env || new Map();
        ctx = ctx || new Map();
        stxStore = stxStore || new Map();

        var trees = expandToTermTree(stx, env, ctx, defscope, stxStore);
        return _.map(trees.terms, function(term) {
            return expandTermTreeToFinal(term, trees.env, ctx, defscope, stxStore);
        })
    }

    // a hack to make the top level hygiene work out
    function expandTopLevel (stx, stxStore) {
        var funn = syntaxFromToken({
            value: "function",
            type: parser.Token.Keyword
        });
        var name = syntaxFromToken({
            value: "$topLevel$",
            type: parser.Token.Identifier
        });
        var params = syntaxFromToken({
            value: "()",
            type: parser.Token.Delimiter,
            inner: []
        });
        var body = syntaxFromToken({
            value:  "{}",
            type: parser.Token.Delimiter,
            inner: stx
        });
        var res = expand([funn, name, params, body], undefined, undefined, undefined, stxStore);
        // drop the { and }
        return _.map(res[0].body.slice(1, res[0].body.length - 1), function(stx) {
            return stx;
        });
    }

    // take our semi-structured TermTree and flatten it back to just
    // syntax objects to be used by the esprima parser. eventually this will
    // be replaced with a method of moving directly from a TermTree to an AST but
    // until then we'll just defer to esprima.
    function flatten(terms) {
        return _.reduce(terms, function(acc, term) {
            return acc.concat(term.destruct(true));
        }, []);
    }

    exports.enforest = enforest;
    exports.expand = expandTopLevel;

    exports.resolve = resolve;

    exports.flatten = flatten;

    exports.tokensToSyntax = syntax.tokensToSyntax;
    exports.syntaxToTokens = syntaxToTokens;
}));
