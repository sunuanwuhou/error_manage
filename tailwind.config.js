/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // 状态颜色（对应四状态机）
        stockified: '#16a34a',        // 已稳固 绿
        increment:  '#ea580c',        // 冲刺目标 橙
        building:   '#2563eb',        // 攻坚中 蓝
        skipped:    '#9ca3af',        // 本次跳过 灰
      },
    },
  },
  plugins: [],
}
