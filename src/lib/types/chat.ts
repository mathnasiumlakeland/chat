import type { RuntimeKind } from './runtime';
import type { ErrorDialogType } from '$lib/enums';

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';
export type ChatMessageType = 'root' | 'text' | 'system' | 'think';
export type ChatMessageStatus = 'idle' | 'streaming' | 'done' | 'error' | 'aborted';

export interface ConversationRecord {
	id: string;
	name: string;
	lastModified: number;
	currNode: string | null;
	modelId: string;
	runtimeKind: RuntimeKind;
	samplingPresetId: string;
	mcpServerOverrides?: McpServerOverride[];
	forkedFromConversationId?: string;
}

export interface MessageRecord {
	id: string;
	convId: string;
	type: ChatMessageType;
	timestamp: number;
	role: ChatRole;
	content: string;
	parent: string | null;
	children: string[];
	status?: ChatMessageStatus;
	error?: string;
	model?: string;
	thinking?: string;
	reasoningContent?: string;
	toolCalls?: string;
	toolCallId?: string;
	extra?: DatabaseMessageExtra[];
	timings?: ChatMessageTimings;
}

export interface ChatUploadedFile {
	id: string;
	name: string;
	size: number;
	type: string;
	file: File;
	preview?: string;
	textContent?: string;
	mcpPrompt?: {
		serverName: string;
		promptName: string;
		arguments?: Record<string, string>;
	};
	isLoading?: boolean;
	loadError?: string;
}

export interface ChatAttachmentDisplayItem {
	id: string;
	name: string;
	size?: number;
	preview?: string;
	isImage: boolean;
	isMcpPrompt?: boolean;
	isMcpResource?: boolean;
	isLoading?: boolean;
	loadError?: string;
	uploadedFile?: ChatUploadedFile;
	attachment?: DatabaseMessageExtra;
	attachmentIndex?: number;
	textContent?: string;
}

export interface ChatAttachmentPreviewItem {
	uploadedFile?: ChatUploadedFile;
	attachment?: DatabaseMessageExtra;
	preview?: string;
	name?: string;
	size?: number;
	textContent?: string;
}

export interface ChatMessageSiblingInfo {
	message: DatabaseMessage;
	siblingIds: string[];
	currentIndex: number;
	totalSiblings: number;
}

export interface ChatMessagePromptProgress {
	cache: number;
	processed: number;
	time_ms: number;
	total: number;
}

export interface ChatMessageToolCallTiming {
	name: string;
	duration_ms: number;
	success: boolean;
}

export interface ChatMessageAgenticTurnStats {
	turn: number;
	llm: {
		predicted_n: number;
		predicted_ms: number;
		prompt_n: number;
		prompt_ms: number;
	};
	toolCalls: ChatMessageToolCallTiming[];
	toolsMs: number;
}

export interface ChatMessageAgenticTimings {
	turns: number;
	toolCallsCount: number;
	toolsMs: number;
	toolCalls?: ChatMessageToolCallTiming[];
	perTurn?: ChatMessageAgenticTurnStats[];
	llm: {
		predicted_n: number;
		predicted_ms: number;
		prompt_n: number;
		prompt_ms: number;
	};
}

export interface ChatMessageTimings {
	cache_n?: number;
	predicted_ms?: number;
	predicted_n?: number;
	prompt_ms?: number;
	prompt_n?: number;
	agentic?: ChatMessageAgenticTimings;
}

export interface ChatStreamCallbacks {
	onChunk?: (chunk: string) => void;
	onReasoningChunk?: (chunk: string) => void;
	onAttachments?: (messageId: string, extras: DatabaseMessageExtra[]) => void;
	onModel?: (model: string) => void;
	onTimings?: (timings?: ChatMessageTimings, promptProgress?: ChatMessagePromptProgress) => void;
}

export interface ErrorDialogState {
	type: ErrorDialogType;
	message: string;
	contextInfo?: { n_prompt_tokens: number; n_ctx: number };
}

export interface LiveProcessingStats {
	tokensProcessed: number;
	totalTokens: number;
	timeMs: number;
	tokensPerSecond: number;
	etaSecs?: number;
}

export interface LiveGenerationStats {
	tokensGenerated: number;
	timeMs: number;
	tokensPerSecond: number;
}

export interface AttachmentDisplayItemsOptions {
	uploadedFiles?: ChatUploadedFile[];
	attachments?: DatabaseMessageExtra[];
}

export interface FileProcessingResult {
	extras: DatabaseMessageExtra[];
	emptyFiles: string[];
}

export interface McpServerOverride {
	serverId: string;
	enabled: boolean;
}

export interface DatabaseConversation extends ConversationRecord {
	mcpServerOverrides?: McpServerOverride[];
	forkedFromConversationId?: string;
}

export interface DatabaseMessageExtraAudioFile {
	type: 'AUDIO';
	name: string;
	base64Data: string;
	mimeType: string;
}

export interface DatabaseMessageExtraImageFile {
	type: 'IMAGE';
	name: string;
	base64Url: string;
}

export interface DatabaseMessageExtraLegacyContext {
	type: 'context';
	name: string;
	content: string;
}

export interface DatabaseMessageExtraPdfFile {
	type: 'PDF';
	base64Data: string;
	name: string;
	content: string;
	images?: string[];
	processedAsImages: boolean;
}

export interface DatabaseMessageExtraTextFile {
	type: 'TEXT';
	name: string;
	content: string;
}

export interface DatabaseMessageExtraMcpPrompt {
	type: 'MCP_PROMPT';
	name: string;
	serverName: string;
	promptName: string;
	content: string;
	arguments?: Record<string, string>;
}

export interface DatabaseMessageExtraMcpResource {
	type: 'MCP_RESOURCE';
	name: string;
	uri: string;
	serverName: string;
	content: string;
	mimeType?: string;
}

export type DatabaseMessageExtra =
	| DatabaseMessageExtraImageFile
	| DatabaseMessageExtraTextFile
	| DatabaseMessageExtraAudioFile
	| DatabaseMessageExtraPdfFile
	| DatabaseMessageExtraMcpPrompt
	| DatabaseMessageExtraMcpResource
	| DatabaseMessageExtraLegacyContext;

export interface DatabaseMessage extends MessageRecord {
	thinking?: string;
	reasoningContent?: string;
	toolCalls?: string;
	toolCallId?: string;
	extra?: DatabaseMessageExtra[];
	timings?: ChatMessageTimings;
}

export type ExportedConversation = {
	conv: DatabaseConversation;
	messages: DatabaseMessage[];
};

export type ExportedConversations = ExportedConversation | ExportedConversation[];
