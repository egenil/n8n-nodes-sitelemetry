// ESLint flat config for an n8n community node package.
//
// This mirrors buildScanConfig() in @n8n/scan-community-package, the gate n8n
// runs for verification (`npx @n8n/scan-community-package <package>`), so a
// green `npm run lint` means the same rules the scan applies have passed:
//   - @n8n/eslint-plugin-community-nodes configs.recommended, plus no-console,
//   - the three eslint-plugin-n8n-nodes-base rule sets, with the same rules
//     turned off that the scanner turns off (the community-nodes plugin
//     replaces them with stricter equivalents).
// Keep this file in step with that function when the scanner is upgraded.
import { n8nCommunityNodesPlugin } from '@n8n/eslint-plugin-community-nodes';
import tsParser from '@typescript-eslint/parser';
import { defineConfig } from 'eslint/config';
import n8nNodesBase from 'eslint-plugin-n8n-nodes-base';

export default defineConfig(
	{
		ignores: ['dist/**', 'node_modules/**', 'test/**', 'scripts/**', 'examples/**'],
	},
	n8nCommunityNodesPlugin.configs.recommended,
	{
		rules: { 'no-console': 'error' },
	},
	{ plugins: { 'n8n-nodes-base': n8nNodesBase } },
	{
		files: ['package.json'],
		rules: {
			...n8nNodesBase.configs.community.rules,
			'n8n-nodes-base/community-package-json-name-still-default': 'off',
		},
	},
	{
		files: ['**/credentials/**/*.ts'],
		rules: {
			...n8nNodesBase.configs.credentials.rules,
			// Not valid for community nodes.
			'n8n-nodes-base/cred-class-field-documentation-url-miscased': 'off',
			// @n8n/community-nodes/credential-password-field is more accurate.
			'n8n-nodes-base/cred-class-field-type-options-password-missing': 'off',
		},
	},
	{
		files: ['**/nodes/**/*.ts'],
		rules: {
			...n8nNodesBase.configs.nodes.rules,
			// Inputs and outputs are the NodeConnectionTypes enum, not "main".
			'n8n-nodes-base/node-class-description-inputs-wrong-regular-node': 'off',
			'n8n-nodes-base/node-class-description-outputs-wrong': 'off',
			// A third-party API can have a real maximum, so maxValue is valid.
			'n8n-nodes-base/node-param-type-options-max-value-present': 'off',
		},
	},
	// package.json and the codex file are object literals; the TypeScript parser
	// produces the TSESTree AST the package.json rules walk.
	{
		files: ['**/*.json'],
		languageOptions: { parser: tsParser },
	},
	{
		files: ['**/*.ts'],
		languageOptions: { parser: tsParser },
	},
);
