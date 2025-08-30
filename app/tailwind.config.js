/** @type {import('tailwindcss').Config} */
module.exports = {
	darkMode: 'class',
	content: [
		'./index.html',
		'./src/**/*.{ts,tsx,html}',
	],
	theme: {
		extend: {
			fontFamily: {
				mono: [
					'JetBrains Mono',
					'ui-monospace',
					'SFMono-Regular',
					'Menlo',
					'Monaco',
					'Consolas',
					'Liberation Mono',
					'Courier New',
					'monospace',
				],
			},
			colors: {
				primary: {
					DEFAULT: '#3B82F6', // blue-500
					50: '#EFF6FF',
					100: '#DBEAFE',
					200: '#BFDBFE',
					300: '#93C5FD',
					400: '#60A5FA',
					500: '#3B82F6',
					600: '#2563EB',
					700: '#1D4ED8',
					800: '#1E40AF',
					900: '#1E3A8A',
				},
				accent: {
					DEFAULT: '#EC4899', // pink-500
					50: '#FDF2F8',
					100: '#FCE7F3',
					200: '#FBCFE8',
					300: '#F9A8D4',
					400: '#F472B6',
					500: '#EC4899',
					600: '#DB2777',
					700: '#BE185D',
					800: '#9D174D',
					900: '#831843',
				},
			},
		},
	},
	plugins: [],
};


