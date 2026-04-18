import { describe, expect, it } from 'vitest';
import { parseMcpAgenticDecision, parseMcpAgenticJsonObject } from './mcp-agentic';

describe('parseMcpAgenticDecision', () => {
	it('parses an answer decision from raw JSON', () => {
		const decision = parseMcpAgenticDecision(
			'{"mode":"answer","answer":"There are 42 students."}'
		);

		expect(decision).toEqual({
			mode: 'answer',
			answer: 'There are 42 students.'
		});
	});

	it('parses a tool decision from fenced JSON', () => {
		const decision = parseMcpAgenticDecision(
			'```json\n{"mode":"tool","name":"sql_query","arguments":{"sql":"SELECT COUNT(*) FROM student"}}\n```'
		);

		expect(decision).toEqual({
			mode: 'tool',
			name: 'sql_query',
			arguments: {
				sql: 'SELECT COUNT(*) FROM student'
			}
		});
	});

	it('extracts a generic JSON object for SQL planning fallback prompts', () => {
		const parsed = parseMcpAgenticJsonObject(
			'```json\n{"sql":"SELECT COUNT(*) AS student_count FROM student;","max_rows":1}\n```'
		);

		expect(parsed).toEqual({
			sql: 'SELECT COUNT(*) AS student_count FROM student;',
			max_rows: 1
		});
	});
});
