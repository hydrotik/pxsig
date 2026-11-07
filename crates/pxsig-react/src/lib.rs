//! pxsig-react — the React Compiler analysis on `oxc_react_compiler`, the React Compiler's Rust
//! port: one file at a time, each component and hook compiled or skipped, and why.
//!
//! The answer has the shape of pxsig's Babel worker (packages/pxsig/src/lib/react/worker.mjs,
//! `CompileResult` in types/react.d.ts), so the engine's `react-diff` reads either:
//!
//! - **compiled**: the compiler rewrote the function; `memoSlots` is its cache size, and the
//!   diagnostics are findings (`stops: false`), with the lint pass's validations when `lint` is on;
//! - **bailout**: the compiler left it alone because of the diagnostics listed (`stops: true`);
//! - **opted-out**: it would compile, but its body says `"use no memo"` (the Babel plugin's
//!   `CompileSkip`);
//! - **compiler-error**: the compiler failed on it (a pipeline error).
//!
//! A file that does not parse is `{ error: "compiler-error" }`, as the Babel worker answers it.
//! Only functions the compiler reports are listed: the others are not components or hooks.

mod collect;
pub mod options;
pub mod rules;
#[cfg(test)]
mod tests;

use oxc_allocator::Allocator;
use oxc_ast::ast::Program;
use oxc_diagnostics::OxcDiagnostic;
use oxc_parser::Parser;
use oxc_react_compiler::{compile, lint, CompileResult, PluginOptions};
use oxc_semantic::SemanticBuilder;
use oxc_span::SourceType;
use serde::{Deserialize, Serialize};

use collect::{Fun, Rewrites};
pub use options::Options;

/// The compiler this crate is built on, as its answers name it.
pub const COMPILER: &str = "oxc_react_compiler";
/// Its version: Cargo.toml pins exactly this one.
pub const COMPILER_VERSION: &str = "0.143.0";

/// One file side to compile: the label the answers use, its text, and Babel's parser plugins for
/// it (`["jsx", "typescript"]` for .tsx, `["typescript"]`, `["jsx"]`: the engine's `react-plan`).
#[derive(Deserialize)]
pub struct File {
    pub path: String,
    pub text: String,
    #[serde(default)]
    pub parser: Vec<String>,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Diagnostic {
    /// The eslint-plugin-react-hooks rule name (rules.rs), else "".
    pub rule: &'static str,
    pub category: String,
    pub reason: String,
    pub line: Option<usize>,
    pub severity: Option<&'static str>,
    /// It made the compiler skip the function; false: a finding on a function that compiles.
    pub stops: bool,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Function {
    pub name: String,
    pub kind: &'static str,
    pub line: usize,
    #[serde(rename = "endLine")]
    pub end_line: usize,
    pub outcome: &'static str,
    #[serde(rename = "memoSlots", skip_serializing_if = "Option::is_none")]
    pub memo_slots: Option<u32>,
    pub diagnostics: Vec<Diagnostic>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(untagged)]
pub enum FileResult {
    Functions { functions: Vec<Function> },
    Error { error: &'static str },
}

const FAILED: FileResult = FileResult::Error {
    error: "compiler-error",
};

fn source_type(parser: &[String]) -> SourceType {
    let has = |p: &str| parser.iter().any(|x| x == p);
    let st = SourceType::mjs();
    let st = if has("typescript") {
        st.with_typescript(true)
    } else {
        st
    };
    st.with_jsx(has("jsx") || !has("typescript"))
}

fn line_of(text: &str, offset: u32) -> usize {
    let end = (offset as usize).min(text.len());
    text.as_bytes()[..end]
        .iter()
        .filter(|b| **b == b'\n')
        .count()
        + 1
}

/// The compiler's diagnostics: `[ReactCompiler] <Category>: <reason>`, at the first label.
struct Diag {
    category: String,
    reason: String,
    at: Option<u32>,
}

fn diags(ds: &[OxcDiagnostic]) -> Vec<Diag> {
    ds.iter()
        .map(|d| {
            let msg = d.message.as_ref();
            let rest = msg.strip_prefix("[ReactCompiler] ").unwrap_or(msg);
            let (category, reason) = rest.split_once(": ").unwrap_or(("", rest));
            Diag {
                category: category.to_string(),
                reason: reason.to_string(),
                at: d.labels.first().map(|l| l.offset()),
            }
        })
        .collect()
}

/// One pass over a fresh parse: the compiled functions (with emit), and the diagnostics.
fn pass(
    text: &str,
    st: SourceType,
    options: PluginOptions,
    emit: bool,
) -> Option<(Rewrites, Vec<Diag>)> {
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, text, st).parse();
    let mut program: Program = parsed.program;
    let result = {
        let semantic = SemanticBuilder::new()
            .with_build_nodes(true)
            .build(&program)
            .semantic;
        if !emit {
            return Some((
                Rewrites::default(),
                diags(&lint(&program, &semantic, &allocator, options).diagnostics),
            ));
        }
        compile(&program, &semantic, &allocator, options)
    };
    match result {
        CompileResult::Success {
            output,
            diagnostics,
        } => {
            if let Some(out) = output {
                out.transform(&mut program);
            }
            Some((Rewrites::of(&program), diags(&diagnostics)))
        }
        CompileResult::Fatal { .. } => None,
    }
}

/// The reported function holding a diagnostic: the top-level one around its label.
fn owner(funs: &[Fun], at: Option<u32>) -> Option<usize> {
    let at = at?;
    funs.iter()
        .position(|f| f.top && f.span.start <= at && at < f.span.end)
}

/// Compile one file side.
pub fn compile_file(file: &File, options: &Options) -> FileResult {
    let st = source_type(&file.parser);
    let text = file.text.as_str();
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, text, st).parse();
    if parsed.panicked || !parsed.diagnostics.is_empty() {
        return FAILED;
    }
    let semantic = SemanticBuilder::new()
        .with_build_nodes(true)
        .build(&parsed.program)
        .semantic;
    let funs = collect::functions(&semantic);
    let Some((built, build_diags)) = pass(text, st, options.plugin.clone(), true) else {
        return FAILED;
    };
    // An opted-out function the compiler would have compiled: what `ignore_use_no_forget` compiles.
    let opted = if funs.iter().any(|f| f.top && f.opt_out) {
        let mut o = options.plugin.clone();
        o.ignore_use_no_forget = true;
        pass(text, st, o, true).map(|(r, _)| r)
    } else {
        None
    };
    let lint_diags = if options.lint {
        let mut o = options.plugin.clone();
        for name in options::LINT {
            options::set_flag(&mut o.environment, name, true);
        }
        pass(text, st, o, false).map_or(Vec::new(), |(_, d)| d)
    } else {
        Vec::new()
    };
    let functions = assemble(
        text,
        &funs,
        &built,
        opted.as_ref(),
        &build_diags,
        options.lint.then_some(&lint_diags[..]),
    );
    FileResult::Functions { functions }
}

fn diagnostic(text: &str, d: &Diag, stops: bool) -> Diagnostic {
    let (rule, severity) = rules::rule_of(&d.category);
    Diagnostic {
        rule,
        category: d.category.clone(),
        reason: d.reason.clone(),
        line: d.at.map(|a| line_of(text, a)),
        severity,
        stops,
    }
}

/// The reported functions. `lint`: the lint pass's diagnostics when it ran; a compiled function's
/// findings are listed only then, as worker.mjs lists them.
fn assemble(
    text: &str,
    funs: &[Fun],
    built: &Rewrites,
    opted: Option<&Rewrites>,
    build: &[Diag],
    lint: Option<&[Diag]>,
) -> Vec<Function> {
    let mut out = Vec::new();
    let mut anonymous = 0;
    for (i, f) in funs.iter().enumerate().filter(|(_, f)| f.top) {
        let mine = |ds: &'_ [Diag]| -> Vec<usize> {
            (0..ds.len())
                .filter(|&k| owner(funs, ds[k].at) == Some(i))
                .collect()
        };
        let stops = mine(build);
        let pipeline = stops.iter().any(|&k| build[k].category == "Pipeline error");
        let rw = built.get(f.span);
        let (outcome, diagnostics) = if pipeline {
            let ds = stops
                .iter()
                .filter(|&&k| build[k].category != "Pipeline error");
            (
                "compiler-error",
                ds.map(|&k| diagnostic(text, &build[k], true)).collect(),
            )
        } else if rw.compiled {
            let found: Vec<Diagnostic> = match lint {
                Some(l) => stops
                    .iter()
                    .map(|&k| &build[k])
                    .chain(mine(l).into_iter().map(|k| &l[k]))
                    .map(|d| diagnostic(text, d, false))
                    .collect(),
                None => Vec::new(),
            };
            ("compiled", found)
        } else if !stops.is_empty() {
            (
                "bailout",
                stops
                    .iter()
                    .map(|&k| diagnostic(text, &build[k], true))
                    .collect(),
            )
        } else if f.opt_out && opted.is_some_and(|o| o.get(f.span).compiled) {
            ("opted-out", Vec::new())
        } else {
            continue;
        };
        let mut unique: Vec<Diagnostic> = Vec::new();
        for d in diagnostics {
            if !unique
                .iter()
                .any(|x| x.rule == d.rule && x.reason == d.reason && x.line == d.line)
            {
                unique.push(d);
            }
        }
        let name = f.name.clone().unwrap_or_else(|| {
            anonymous += 1;
            format!("anonymous-{anonymous}")
        });
        out.push(Function {
            kind: if is_hook(&name) { "hook" } else { "component" },
            name,
            line: line_of(text, f.span.start),
            end_line: line_of(text, f.span.end),
            outcome,
            memo_slots: (outcome == "compiled").then_some(rw.memo_slots),
            diagnostics: unique,
        });
    }
    out
}

/// `use` followed by a capital or a digit, as worker.mjs decides `kind`.
fn is_hook(name: &str) -> bool {
    name.strip_prefix("use")
        .and_then(|r| r.chars().next())
        .is_some_and(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
}
