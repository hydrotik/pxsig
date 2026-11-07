//! The analysis options as pxsig passes them to the Babel worker (`compilationMode`, `target`,
//! `environment`, `lint`), turned into `oxc_react_compiler`'s `PluginOptions`.
//!
//! `EnvironmentConfig` is a plain struct with no JSON form, so each `environment` key is mapped by
//! name: the boolean flags and the two name lists. A key the built-in compiler has no field for is
//! left out with a warning, never an error, as the Babel plugin's own unknown keys would be.

use oxc_react_compiler::{CompilationMode, CompilerTarget, EnvironmentConfig, PluginOptions};
use serde_json::{Map, Value};

/// The options for one run, and what was left out of `environment`.
pub struct Options {
    pub plugin: PluginOptions,
    pub lint: bool,
    pub warnings: Vec<String>,
}

type Flag = fn(&mut EnvironmentConfig) -> &mut bool;

/// The boolean `environment` keys, by the name the Babel plugin gives them.
const FLAGS: &[(&str, Flag)] = &[
    ("enablePreserveExistingMemoizationGuarantees", |e| {
        &mut e.enable_preserve_existing_memoization_guarantees
    }),
    ("validatePreserveExistingMemoizationGuarantees", |e| {
        &mut e.validate_preserve_existing_memoization_guarantees
    }),
    ("validateExhaustiveMemoizationDependencies", |e| {
        &mut e.validate_exhaustive_memoization_dependencies
    }),
    ("enableOptionalDependencies", |e| {
        &mut e.enable_optional_dependencies
    }),
    ("enableNameAnonymousFunctions", |e| {
        &mut e.enable_name_anonymous_functions
    }),
    ("validateHooksUsage", |e| &mut e.validate_hooks_usage),
    ("validateRefAccessDuringRender", |e| {
        &mut e.validate_ref_access_during_render
    }),
    ("validateNoSetStateInRender", |e| {
        &mut e.validate_no_set_state_in_render
    }),
    ("enableUseKeyedState", |e| &mut e.enable_use_keyed_state),
    ("validateNoSetStateInEffects", |e| {
        &mut e.validate_no_set_state_in_effects
    }),
    ("validateNoDerivedComputationsInEffects", |e| {
        &mut e.validate_no_derived_computations_in_effects
    }),
    ("validateNoDerivedComputationsInEffects_exp", |e| {
        &mut e.validate_no_derived_computations_in_effects_exp
    }),
    ("validateNoJSXInTryStatements", |e| {
        &mut e.validate_no_jsx_in_try_statements
    }),
    ("validateStaticComponents", |e| {
        &mut e.validate_static_components
    }),
    ("validateSourceLocations", |e| {
        &mut e.validate_source_locations
    }),
    ("validateNoImpureFunctionsInRender", |e| {
        &mut e.validate_no_impure_functions_in_render
    }),
    ("validateNoFreezingKnownMutableFunctions", |e| {
        &mut e.validate_no_freezing_known_mutable_functions
    }),
    ("enableAssumeHooksFollowRulesOfReact", |e| {
        &mut e.enable_assume_hooks_follow_rules_of_react
    }),
    ("enableTransitivelyFreezeFunctionExpressions", |e| {
        &mut e.enable_transitively_freeze_function_expressions
    }),
    ("enableFunctionOutlining", |e| {
        &mut e.enable_function_outlining
    }),
    ("enableJsxOutlining", |e| &mut e.enable_jsx_outlining),
    ("enableCustomTypeDefinitionForReanimated", |e| {
        &mut e.enable_custom_type_definition_for_reanimated
    }),
    ("enableTreatRefLikeIdentifiersAsRefs", |e| {
        &mut e.enable_treat_ref_like_identifiers_as_refs
    }),
    ("enableTreatSetIdentifiersAsStateSetters", |e| {
        &mut e.enable_treat_set_identifiers_as_state_setters
    }),
    ("validateNoVoidUseMemo", |e| {
        &mut e.validate_no_void_use_memo
    }),
    ("enableAllowSetStateFromRefsInEffects", |e| {
        &mut e.enable_allow_set_state_from_refs_in_effects
    }),
    ("enableVerboseNoSetStateInEffect", |e| {
        &mut e.enable_verbose_no_set_state_in_effect
    }),
];

/// The validations the lint pass turns on: lib/react/worker.mjs's `LINT`, the ones
/// eslint-plugin-react-hooks runs.
pub const LINT: &[&str] = &[
    "validateRefAccessDuringRender",
    "validateNoSetStateInRender",
    "validateNoSetStateInEffects",
    "validateNoJSXInTryStatements",
    "validateNoImpureFunctionsInRender",
    "validateStaticComponents",
    "validateNoFreezingKnownMutableFunctions",
    "validateNoVoidUseMemo",
    "validateHooksUsage",
    "validateNoDerivedComputationsInEffects",
];

fn flag(name: &str) -> Option<Flag> {
    FLAGS.iter().find(|(n, _)| *n == name).map(|(_, f)| *f)
}

/// Turn a validation on by name; false when the compiler has no such flag.
pub fn set_flag(env: &mut EnvironmentConfig, name: &str, on: bool) -> bool {
    flag(name).map(|f| *f(env) = on).is_some()
}

fn names(v: &Value) -> Option<Vec<String>> {
    v.as_array()?
        .iter()
        .map(|x| x.as_str().map(str::to_string))
        .collect()
}

/// `{ compilationMode?, target?, environment?, lint? }`. A bad `compilationMode` or `target` is an
/// error (the Babel plugin refuses them too); a bad `environment` key is a warning.
pub fn from_json(v: &Value) -> Result<Options, String> {
    let empty = Map::new();
    let o = v.as_object().unwrap_or(&empty);
    let mut plugin = PluginOptions::default();
    if let Some(m) = o.get("compilationMode") {
        let s = m.as_str().unwrap_or("");
        plugin.compilation_mode = s.parse::<CompilationMode>().map_err(|()| {
            format!("compilationMode must be infer, syntax, annotation or all; got {m}")
        })?;
    }
    if let Some(t) = o.get("target") {
        match t.as_str() {
            Some(s @ ("17" | "18" | "19")) => {
                plugin.target = CompilerTarget::Version(s.to_string())
            }
            _ => return Err(format!("target must be \"17\", \"18\" or \"19\"; got {t}")),
        }
    }
    let mut warnings = Vec::new();
    if let Some(env) = o.get("environment").and_then(Value::as_object) {
        for (k, val) in env {
            let e = &mut plugin.environment;
            let ok = match (k.as_str(), val) {
                (_, Value::Bool(b)) if flag(k).is_some() => set_flag(e, k, *b),
                ("validateNoCapitalizedCalls", _) => names(val)
                    .map(|n| e.validate_no_capitalized_calls = Some(n))
                    .is_some(),
                ("validateBlocklistedImports", _) => names(val)
                    .map(|n| e.validate_blocklisted_imports = Some(n))
                    .is_some(),
                _ => false,
            };
            if !ok {
                warnings.push(format!(
                    "environment.{k} is not supported by the built-in compiler: left out"
                ));
            }
        }
    }
    let lint = o.get("lint").and_then(Value::as_bool).unwrap_or(false);
    Ok(Options {
        plugin,
        lint,
        warnings,
    })
}
