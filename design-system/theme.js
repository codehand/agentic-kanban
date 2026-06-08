/* Agentic Kanban - shared Tailwind (Play CDN) theme. Loaded after cdn.tailwindcss.com. */
tailwind.config = {
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        bg:       '#0E0F13',
        panel:    '#15171D',
        panel2:   '#1B1E26',
        border:   '#262932',
        borderlt: '#30343F',
        text:     '#E6E8EC',
        muted:    '#8A8F98',
        accent:   '#5B7CFA',
        // semantic workflow-state hues (one hue per state, used everywhere)
        st_todo:     '#8A8F98',
        st_prog:     '#4D8DF0',
        st_impl:     '#7C83FA',
        st_self:     '#2DD4BF',
        st_selffail: '#F5A524',
        st_human:    '#A877F5',
        st_reject:   '#F2683C',
        st_done:     '#34D399',
        // evidence semantics
        ev_pass: '#34D399',
        ev_fail: '#F4564E',
        ev_warn: '#F5A524',
      },
    },
  },
};
