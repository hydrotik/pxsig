/** One Storybook for every package: pxsig works out which project each story belongs to. */
/** @type { import('@storybook/react-vite').StorybookConfig } */
export default {
  stories: ['../../../packages/*/src/**/*.stories.@(js|jsx)'],
  addons: ['@pxsig/storybook-addon'],
  framework: { name: '@storybook/react-vite', options: {} },
};
