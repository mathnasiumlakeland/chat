export interface ProcessingStateOwner {
	conversationId: string | null;
	messageId: string | null;
}

export interface ProcessingStateScope {
	conversationId?: string | null;
	messageId?: string | null;
}

export function matchesProcessingStateOwner(
	owner: ProcessingStateOwner | null | undefined,
	scope?: ProcessingStateScope
): boolean {
	if (!scope) {
		return true;
	}

	if (scope.conversationId != null && owner?.conversationId !== scope.conversationId) {
		return false;
	}

	if (scope.messageId != null && owner?.messageId !== scope.messageId) {
		return false;
	}

	return true;
}

export function getProcessingStateScopeKey(scope?: ProcessingStateScope): string {
	return `${scope?.conversationId ?? '*'}::${scope?.messageId ?? '*'}`;
}
