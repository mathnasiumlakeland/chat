import type { OpenAIToolDefinition, ToolExecutionResult } from '$lib/types';

export type MCPAgenticDecision =
	| {
			mode: 'answer';
			answer: string;
	  }
	| {
			mode: 'tool';
			name: string;
			arguments: Record<string, unknown>;
	  };

const TOOL_CALL_TAG_REGEX = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/i;
const JSON_FENCE_REGEX = /```(?:json)?\s*([\s\S]*?)\s*```/i;

function formatToolDefinitions(toolDefinitions: OpenAIToolDefinition[]): string {
	return toolDefinitions
		.map((tool) =>
			JSON.stringify(
				{
					name: tool.function.name,
					description: tool.function.description ?? '',
					parameters: tool.function.parameters
				},
				null,
				2
			)
		)
		.join('\n\n');
}

function extractBalancedJson(text: string): string | null {
	let depth = 0;
	let start = -1;
	let inString = false;
	let escaped = false;

	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];

		if (inString) {
			if (escaped) {
				escaped = false;
				continue;
			}

			if (char === '\\') {
				escaped = true;
				continue;
			}

			if (char === '"') {
				inString = false;
			}

			continue;
		}

		if (char === '"') {
			inString = true;
			continue;
		}

		if (char === '{') {
			if (depth === 0) {
				start = index;
			}
			depth += 1;
			continue;
		}

		if (char === '}') {
			if (depth === 0) {
				continue;
			}

			depth -= 1;
			if (depth === 0 && start !== -1) {
				return text.slice(start, index + 1);
			}
		}
	}

	return null;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
	try {
		const parsed = JSON.parse(text);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return null;
		}

		return parsed as Record<string, unknown>;
	} catch {
		return null;
	}
}

function normalizeDecision(parsed: Record<string, unknown>): MCPAgenticDecision | null {
	const mode = typeof parsed.mode === 'string' ? parsed.mode.toLowerCase() : null;
	const toolName =
		typeof parsed.name === 'string'
			? parsed.name
			: typeof parsed.tool_name === 'string'
				? parsed.tool_name
				: null;
	const toolArguments =
		parsed.arguments && typeof parsed.arguments === 'object' && !Array.isArray(parsed.arguments)
			? (parsed.arguments as Record<string, unknown>)
			: {};

	if ((mode === 'tool' || (!mode && toolName)) && toolName) {
		return {
			mode: 'tool',
			name: toolName,
			arguments: toolArguments
		};
	}

	const answer =
		typeof parsed.answer === 'string'
			? parsed.answer
			: typeof parsed.content === 'string'
				? parsed.content
				: null;

	if (mode === 'answer' && answer) {
		return {
			mode: 'answer',
			answer
		};
	}

	return null;
}

export function parseMcpAgenticJsonObject(response: string): Record<string, unknown> | null {
	const taggedToolCall = response.match(TOOL_CALL_TAG_REGEX)?.[1];
	if (taggedToolCall) {
		const taggedParsed = parseJsonObject(taggedToolCall.trim());
		if (taggedParsed) {
			return taggedParsed;
		}
	}

	const fencedJson = response.match(JSON_FENCE_REGEX)?.[1];
	if (fencedJson) {
		const fencedParsed = parseJsonObject(fencedJson.trim());
		if (fencedParsed) {
			return fencedParsed;
		}
	}

	const balancedJson = extractBalancedJson(response);
	if (!balancedJson) {
		return null;
	}

	return parseJsonObject(balancedJson);
}

export function buildMcpAgenticSystemPrompt(
	toolDefinitions: OpenAIToolDefinition[],
	serverInstructions: string[]
): string {
	const instructionsBlock =
		serverInstructions.length > 0
			? `Server instructions:\n${serverInstructions.map((instruction) => `- ${instruction}`).join('\n')}\n\n`
			: '';

	return [
		'You can use connected MCP tools to answer the user.',
		'Never claim you do not have database, file, or external access when a relevant tool is available.',
		'Use at most one tool per response. If a tool is needed, call it before answering.',
		'For live database questions about counts, totals, averages, latest values, rankings, or filtered record sets, you must use a database query tool before answering.',
		'Schema-only tools are not enough for live database counts or totals.',
		'Respond with exactly one JSON object and no surrounding prose.',
		'Use one of these shapes:',
		'{"mode":"tool","name":"tool_name","arguments":{...}}',
		'{"mode":"answer","answer":"final response for the user"}',
		'After you receive a later message that starts with "[Tool result:", use that result to decide the next step.',
		instructionsBlock.trimEnd(),
		'Available tools:',
		formatToolDefinitions(toolDefinitions)
	]
		.filter(Boolean)
		.join('\n\n');
}

export function parseMcpAgenticDecision(response: string): MCPAgenticDecision | null {
	const parsed = parseMcpAgenticJsonObject(response);
	if (!parsed) {
		return null;
	}

	return normalizeDecision(parsed);
}

export function buildToolResultContext(toolName: string, result: ToolExecutionResult): string {
	return [
		`[Tool result: ${toolName}]`,
		`status: ${result.isError ? 'error' : 'success'}`,
		result.content.trim()
	]
		.filter(Boolean)
		.join('\n');
}
