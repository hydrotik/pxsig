// lint-staged (the pre-commit hook, .husky/pre-commit): oxlint on the staged sources. oxfmt joins
// it with the one-time reformat, so that a commit never reformats a file it did not mean to.
const quote = (f) => `"${f.replace(/\\/g, '/')}"`;

export default {
  '*.{ts,tsx,js,mjs,cjs}': (files) => [`pnpm exec oxlint ${files.map(quote).join(' ')}`],
};
