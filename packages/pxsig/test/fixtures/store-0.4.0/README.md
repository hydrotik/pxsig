# A report as pxsig 0.4.0 wrote it

`check.json` from before the render environment (0.5): no top-level `envs`, and rows without
`env`, `baselineEnv`, `envMatch` or `envDiff`. The fixture's baselines (built by `fixture.mjs`) carry
no `env` either. `upgrade.test.mjs` lays it over a fixture project: every command that reads a
report takes it as it is, the environment reads as unknown, and nothing warns.
