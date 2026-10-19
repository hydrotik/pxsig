/** @type { import('@storybook/react-vite').StorybookConfig } */
export default {
  stories: ['../src/**/*.stories.@(js|jsx)'],
  addons: ['@pxsig/storybook-addon'],
  framework: { name: '@storybook/react-vite', options: {} },
};
