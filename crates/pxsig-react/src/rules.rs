//! The React Compiler's error categories, each with its eslint-plugin-react-hooks rule name and the
//! severity the compiler shows it with: pxsig's own copy of the Babel plugin's `LintRules`, which
//! `oxc_react_compiler` does not export.
//!
//! The names and severities are babel-plugin-react-compiler 1.0.0's, plus the three categories
//! added after it (`VoidUseMemo`, `MemoDependencies`, `EffectExhaustiveDependencies`), as the
//! newest Babel build of the compiler names them. Every category `oxc_react_compiler` can report is
//! here; `tests.rs` pins that.

/// `(category, rule, severity)`.
pub const RULES: &[(&str, &str, &str)] = &[
    ("Hooks", "hooks", "Error"),
    ("CapitalizedCalls", "capitalized-calls", "Error"),
    ("StaticComponents", "static-components", "Error"),
    ("UseMemo", "use-memo", "Error"),
    ("VoidUseMemo", "void-use-memo", "Error"),
    ("Factories", "component-hook-factories", "Error"),
    ("PreserveManualMemo", "preserve-manual-memoization", "Error"),
    ("MemoDependencies", "memo-dependencies", "Error"),
    ("IncompatibleLibrary", "incompatible-library", "Warning"),
    ("Immutability", "immutability", "Error"),
    ("Globals", "globals", "Error"),
    ("Refs", "refs", "Error"),
    (
        "EffectDependencies",
        "memoized-effect-dependencies",
        "Error",
    ),
    (
        "EffectExhaustiveDependencies",
        "exhaustive-effect-dependencies",
        "Error",
    ),
    ("EffectSetState", "set-state-in-effect", "Error"),
    (
        "EffectDerivationsOfState",
        "no-deriving-state-in-effects",
        "Error",
    ),
    ("ErrorBoundaries", "error-boundaries", "Error"),
    ("Purity", "purity", "Error"),
    ("RenderSetState", "set-state-in-render", "Error"),
    ("Invariant", "invariant", "Error"),
    ("Todo", "todo", "Hint"),
    ("Syntax", "syntax", "Error"),
    ("UnsupportedSyntax", "unsupported-syntax", "Warning"),
    ("Config", "config", "Error"),
    ("Gating", "gating", "Error"),
    ("Suppression", "rule-suppression", "Error"),
    (
        "AutomaticEffectDependencies",
        "automatic-effect-dependencies",
        "Error",
    ),
    ("Fire", "fire", "Error"),
    ("FBT", "fbt", "Error"),
];

/// The rule name and severity of a category; `("", None)` for one the table does not have.
pub fn rule_of(category: &str) -> (&'static str, Option<&'static str>) {
    RULES
        .iter()
        .find(|(c, _, _)| *c == category)
        .map_or(("", None), |(_, r, s)| (*r, Some(*s)))
}
