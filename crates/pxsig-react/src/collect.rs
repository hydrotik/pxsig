//! The functions of a file, and which of them the compiler rewrote.
//!
//! `oxc_react_compiler` 0.143.0 returns no per-function result (no logger, and `CompileOutput`'s
//! list is private). What it does do, exactly: applying the output keeps each compiled function's
//! own node and span and gives it a body built afresh, whose span is empty (codegen builds every
//! new node at `SPAN`). So a function whose body span is 0..0 after `transform` was compiled, and
//! the `_c(N)` call at the top of that body is its memo cache. This is the crate's implementation,
//! not its API: tests.rs pins it, so a crate bump that changes it fails there first.

use oxc_ast::ast::{ArrowFunctionBody, Directive, Expression, Function, FunctionBody, Program};
use oxc_ast::AstKind;
use oxc_ast_visit::{walk, Visit};
use oxc_semantic::Semantic;
use oxc_span::Span;
use oxc_syntax::scope::ScopeFlags;

/// One function as the source has it.
pub struct Fun {
    pub span: Span,
    /// Named as lib/react/worker.mjs `nameOf` names it.
    pub name: Option<String>,
    /// Not inside another function: what the compiler considers on its own.
    pub top: bool,
    /// A `"use no memo"` / `"use no forget"` directive in its body.
    pub opt_out: bool,
}

const OPT_OUT: [&str; 2] = ["use no memo", "use no forget"];

fn opts_out(directives: &[Directive]) -> bool {
    directives
        .iter()
        .any(|d| OPT_OUT.contains(&d.expression.value.as_str()))
}

/// A function's name from its declaration, its variable (through any call, as `memo(…)`), its
/// object or class key, its assignment, or `default` for an anonymous default export.
fn name_of(semantic: &Semantic, id: oxc_semantic::NodeId, own: Option<&str>) -> Option<String> {
    if let Some(n) = own {
        return Some(n.to_string());
    }
    let nodes = semantic.nodes();
    for kind in nodes.ancestor_kinds(id) {
        match kind {
            AstKind::CallExpression(_) | AstKind::ParenthesizedExpression(_) => continue,
            AstKind::VariableDeclarator(d) => {
                return d.id.get_binding_identifier().map(|b| b.name.to_string())
            }
            AstKind::ObjectProperty(p) => return p.key.static_name().map(|s| s.to_string()),
            AstKind::PropertyDefinition(p) => return p.key.static_name().map(|s| s.to_string()),
            AstKind::MethodDefinition(m) => return m.key.static_name().map(|s| s.to_string()),
            AstKind::AssignmentExpression(a) => {
                return a.left.get_identifier_name().map(|s| s.to_string())
            }
            AstKind::ExportDefaultDeclaration(_) => return Some("default".into()),
            _ => return None,
        }
    }
    None
}

/// Every function and arrow function in source order.
pub fn functions(semantic: &Semantic) -> Vec<Fun> {
    let nodes = semantic.nodes();
    let mut out = Vec::new();
    for node in nodes.iter() {
        let (span, own, body): (Span, Option<&str>, Option<&FunctionBody>) = match node.kind() {
            AstKind::Function(f) => (
                f.span,
                f.id.as_ref().map(|i| i.name.as_str()),
                f.body.as_deref(),
            ),
            AstKind::ArrowFunctionExpression(a) => (
                a.span,
                None,
                match &a.body {
                    ArrowFunctionBody::FunctionBody(b) => Some(&**b),
                    _ => None,
                },
            ),
            _ => continue,
        };
        let top = !nodes.ancestor_kinds(node.id()).any(|k| {
            matches!(
                k,
                AstKind::Function(_) | AstKind::ArrowFunctionExpression(_)
            )
        });
        out.push(Fun {
            span,
            name: name_of(semantic, node.id(), own),
            top,
            opt_out: body.is_some_and(|b| opts_out(&b.directives)),
        });
    }
    out.sort_by_key(|f| (f.span.start, std::cmp::Reverse(f.span.end)));
    out
}

/// What the compiled program says about one function: rebuilt, and its memo slots.
#[derive(Clone, Copy, Default)]
pub struct Rewrite {
    pub compiled: bool,
    pub memo_slots: u32,
}

/// The rewritten functions of a program after `CompileOutput::transform`, by original span.
#[derive(Default)]
pub struct Rewrites {
    found: Vec<(Span, Rewrite)>,
    /// The innermost rebuilt function being walked (memo caches belong to it).
    stack: Vec<usize>,
    /// The local name of the memo cache function the compiler imported (`c as _c`).
    cache: Option<String>,
}

/// The local name of `c` imported from the compiler runtime (`react/compiler-runtime`, or
/// `react-compiler-runtime` for React 17 and 18), if the compiler added that import.
fn cache_name(program: &Program) -> Option<String> {
    program.body.iter().find_map(|stmt| {
        let oxc_ast::ast::Statement::ImportDeclaration(d) = stmt else {
            return None;
        };
        if !d.source.value.ends_with("compiler-runtime") {
            return None;
        }
        d.specifiers.as_ref()?.iter().find_map(|sp| match sp {
            oxc_ast::ast::ImportDeclarationSpecifier::ImportSpecifier(s)
                if s.imported.name() == "c" =>
            {
                Some(s.local.name.to_string())
            }
            _ => None,
        })
    })
}

impl Rewrites {
    pub fn of(program: &Program) -> Self {
        let mut r = Self {
            cache: cache_name(program),
            ..Self::default()
        };
        r.visit_program(program);
        r
    }

    pub fn get(&self, span: Span) -> Rewrite {
        self.found
            .iter()
            .find(|(s, _)| *s == span)
            .map_or(Rewrite::default(), |(_, r)| *r)
    }

    fn enter(&mut self, span: Span, body: Option<&FunctionBody>) -> bool {
        let rebuilt = body.is_some_and(|b| b.span == Span::default());
        if rebuilt {
            self.found.push((
                span,
                Rewrite {
                    compiled: true,
                    memo_slots: 0,
                },
            ));
            self.stack.push(self.found.len() - 1);
        }
        rebuilt
    }
}

impl<'a> Visit<'a> for Rewrites {
    fn visit_function(&mut self, it: &Function<'a>, flags: ScopeFlags) {
        let pushed = self.enter(it.span, it.body.as_deref());
        walk::walk_function(self, it, flags);
        if pushed {
            self.stack.pop();
        }
    }

    fn visit_arrow_function_expression(&mut self, it: &oxc_ast::ast::ArrowFunctionExpression<'a>) {
        let body = match &it.body {
            ArrowFunctionBody::FunctionBody(b) => Some(&**b),
            _ => None,
        };
        let pushed = self.enter(it.span, body);
        walk::walk_arrow_function_expression(self, it);
        if pushed {
            self.stack.pop();
        }
    }

    fn visit_call_expression(&mut self, it: &oxc_ast::ast::CallExpression<'a>) {
        // `const $ = _c(N)`: the memo cache, by the name the compiler imported it under.
        if let (Expression::Identifier(callee), Some(&top)) = (&it.callee, self.stack.last()) {
            if self.cache.as_deref() == Some(callee.name.as_str()) {
                if let Some(Expression::NumericLiteral(n)) =
                    it.arguments.first().and_then(|a| a.as_expression())
                {
                    let r = &mut self.found[top].1;
                    if r.memo_slots == 0 {
                        r.memo_slots = n.value as u32;
                    }
                }
            }
        }
        walk::walk_call_expression(self, it);
    }
}
