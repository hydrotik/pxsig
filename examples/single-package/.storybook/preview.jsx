import React from 'react';
// A `theme` global the stories read, so pxsig can check each story in a light and a dark mode.
export default {
  globalTypes: {
    theme: { description: 'Theme', toolbar: { items: ['light', 'dark'] } },
  },
  initialGlobals: { theme: 'light' },
  decorators: [
    (Story, ctx) => (
      <div
        data-theme={ctx.globals.theme}
        style={{
          padding: 16,
          background: ctx.globals.theme === 'dark' ? '#16181d' : '#ffffff',
          color: ctx.globals.theme === 'dark' ? '#f2f3f5' : '#16181d',
        }}
      >
        <Story />
      </div>
    ),
  ],
};
